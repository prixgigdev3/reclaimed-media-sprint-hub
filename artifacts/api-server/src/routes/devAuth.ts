import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import {
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

const router: IRouter = Router();

export function devLoginEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_LOGIN_ENABLED === "1"
  );
}

export function assertDevLoginSafeAtBoot(): void {
  if (
    process.env.DEV_LOGIN_ENABLED === "1" &&
    process.env.NODE_ENV !== "development"
  ) {
    throw new Error(
      "Refusing to start: DEV_LOGIN_ENABLED=1 is only permitted when NODE_ENV=development. " +
        "Unset DEV_LOGIN_ENABLED or set NODE_ENV=development.",
    );
  }
}

function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

router.get("/dev-login", async (req: Request, res: Response): Promise<void> => {
  if (!devLoginEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const email = String(req.query.email || "").toLowerCase().trim();
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "email query param required" });
    return;
  }
  // Reuse the existing user row if there's already one for this email
  // (e.g. seeded admin or a real Replit OIDC user). Falling back to a fresh
  // dev_<hash> id keeps brand-new test emails working too.
  const { eq } = await import("drizzle-orm");
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const id = existing[0]?.id
    ?? "dev_" + crypto.createHash("sha256").update(email).digest("hex").slice(0, 24);
  const firstName = String(req.query.firstName || existing[0]?.firstName || email.split("@")[0]);
  const lastName = String(req.query.lastName || existing[0]?.lastName || "");

  const userData = {
    id,
    email,
    firstName,
    lastName,
    profileImageUrl: existing[0]?.profileImageUrl ?? null,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { ...userData, updatedAt: new Date() },
    })
    .returning();

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
    },
    access_token: "dev-token",
    expires_at: now + 60 * 60 * 24,
  };

  const sid = await createSession(sessionData);
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });

  const returnTo = safeReturnTo(req.query.returnTo);
  if (returnTo) {
    res.redirect(returnTo);
    return;
  }
  res.json({ ok: true, user: sessionData.user });
});

export default router;
