import { type Request, type Response } from "express";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, clientsTable, adminUsersTable, activityEventsTable, type Client, type AdminUserRow } from "@workspace/db";
import { currentSession } from "./auth";

export type Role = "super_admin" | "admin" | "viewer" | "client" | "none";

const LOGIN_THROTTLE_MS = 5 * 60 * 1000;

async function shouldRecordLogin(
  actorType: "admin" | "client",
  actorId: number,
): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_THROTTLE_MS);
  const [last] = await db
    .select({ id: activityEventsTable.id })
    .from(activityEventsTable)
    .where(
      and(
        eq(activityEventsTable.kind, "login"),
        eq(activityEventsTable.actorType, actorType),
        eq(activityEventsTable.actorId, actorId),
        gt(activityEventsTable.createdAt, since),
      ),
    )
    .orderBy(desc(activityEventsTable.createdAt))
    .limit(1);
  return !last;
}

export async function resolveRole(
  email: string | null | undefined,
  userId: string,
  reqContext?: { ip?: string | null; userAgent?: string | null },
): Promise<{ role: Role; client?: Client; admin?: AdminUserRow }> {
  if (!email) return { role: "none" };

  const [admin] = await db
    .select()
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, email.toLowerCase()));
  if (admin) {
    const recordLogin = await shouldRecordLogin("admin", admin.id);
    if (!admin.userId || recordLogin) {
      await db
        .update(adminUsersTable)
        .set({ userId: admin.userId ?? userId, lastLoginAt: recordLogin ? new Date() : admin.lastLoginAt })
        .where(eq(adminUsersTable.id, admin.id));
    }
    if (recordLogin) {
      try {
        await db.insert(activityEventsTable).values({
          kind: "login",
          message: `${admin.email} (admin) logged in`,
          actorType: "admin",
          actorId: admin.id,
          actorEmail: admin.email,
          ip: reqContext?.ip ?? null,
          userAgent: reqContext?.userAgent ?? null,
        });
      } catch {
        /* ignore */
      }
    }
    return { role: admin.role as Role, admin };
  }

  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.email, email.toLowerCase()));
  if (client) {
    const recordLogin = await shouldRecordLogin("client", client.id);
    if (!client.userId) {
      await db
        .update(clientsTable)
        .set({ userId, lastLoginAt: new Date(), status: "active" })
        .where(eq(clientsTable.id, client.id));
    } else if (recordLogin) {
      await db
        .update(clientsTable)
        .set({ lastLoginAt: new Date() })
        .where(eq(clientsTable.id, client.id));
    }
    if (recordLogin) {
      try {
        await db.insert(activityEventsTable).values({
          kind: "login",
          message: `${client.firstName} ${client.lastName} logged in`,
          clientId: client.id,
          actorType: "client",
          actorId: client.id,
          actorEmail: client.email,
          ip: reqContext?.ip ?? null,
          userAgent: reqContext?.userAgent ?? null,
        });
      } catch {
        /* ignore */
      }
    }
    return { role: "client", client };
  }

  return { role: "none" };
}

function reqContext(req: Request): { ip: string; userAgent: string } {
  const fwd = req.headers["x-forwarded-for"];
  const ip = typeof fwd === "string" && fwd.length > 0
    ? fwd.split(",")[0].trim()
    : req.ip || req.socket.remoteAddress || "";
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"]!.slice(0, 512) : "";
  return { ip, userAgent: ua };
}

export async function requireClient(
  req: Request,
  res: Response,
  opts: { allowImpersonation?: boolean; requireOnboarded?: boolean } = {},
): Promise<Client | null> {
  const { allowImpersonation = true, requireOnboarded = false } = opts;
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  // Impersonation: an admin with an active impersonateClientId in their
  // server-side session is treated as that client for READ-ONLY /me routes.
  if (allowImpersonation) {
    const cur = await currentSession(req);
    const impersonateId = cur?.data.impersonateClientId ?? null;
    if (impersonateId) {
      const { admin } = await resolveRole(req.user.email, req.user.id, reqContext(req));
      if (admin && (admin.role === "super_admin" || admin.role === "admin")) {
        const [target] = await db.select().from(clientsTable).where(eq(clientsTable.id, impersonateId));
        if (target) return target;
      }
    }
  } else {
    // Block write attempts while impersonating to avoid mutating client data as the admin.
    const cur = await currentSession(req);
    if (cur?.data.impersonateClientId) {
      res.status(403).json({ error: "Read-only while previewing as client. Exit preview to take this action." });
      return null;
    }
  }
  const { role, client } = await resolveRole(req.user.email, req.user.id, reqContext(req));
  if (role !== "client" || !client) {
    res.status(403).json({ error: "Client access required" });
    return null;
  }
  if (requireOnboarded && !client.acceptedTermsAt) {
    res.status(403).json({ error: "Onboarding incomplete. Please accept the terms first.", code: "onboarding_required" });
    return null;
  }
  return client;
}

export async function requireAdmin(
  req: Request,
  res: Response,
  allowedRoles: Role[] = ["super_admin", "admin", "viewer"],
): Promise<AdminUserRow | null> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const { role, admin } = await resolveRole(req.user.email, req.user.id, reqContext(req));
  if (!admin || !allowedRoles.includes(role)) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return admin;
}

export async function requireAdminWrite(
  req: Request,
  res: Response,
): Promise<AdminUserRow | null> {
  return requireAdmin(req, res, ["super_admin", "admin"]);
}

/**
 * Admin scope gate. Super admins always pass. An admin with an empty
 * `scopes` array (default) has full access. Otherwise the request scope
 * must appear in the admin's allowlist.
 */
export function adminHasScope(admin: AdminUserRow, scope: string): boolean {
  if (admin.role === "super_admin") return true;
  const scopes = (admin.scopes ?? []) as string[];
  if (scopes.length === 0) return true;
  return scopes.includes(scope);
}

export async function requireAdminScope(
  req: Request,
  res: Response,
  scope: string,
  allowedRoles: Role[] = ["super_admin", "admin", "viewer"],
): Promise<AdminUserRow | null> {
  const admin = await requireAdmin(req, res, allowedRoles);
  if (!admin) return null;
  if (!adminHasScope(admin, scope)) {
    res.status(403).json({ error: `Missing scope: ${scope}` });
    return null;
  }
  return admin;
}
