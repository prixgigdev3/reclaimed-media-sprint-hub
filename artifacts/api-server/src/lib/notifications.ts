import crypto from "crypto";
import { Resend } from "resend";
import { eq, sql } from "drizzle-orm";
import { BRAND_NAME, BRAND_APP_NAME } from "./brand";
import {
  db,
  activityEventsTable,
  settingsTable,
  notificationsTable,
  adminUsersTable,
  type AdminUserRow,
} from "@workspace/db";
import { logger } from "./logger";

export async function logActivity(
  kind: string,
  message: string,
  clientId: number | null = null,
): Promise<void> {
  await db.insert(activityEventsTable).values({ kind, message, clientId });
}

export async function getOrCreateSettings() {
  const [row] = await db.select().from(settingsTable);
  if (row) return row;
  const apiKey = "phk_" + crypto.randomBytes(24).toString("hex");
  const [created] = await db
    .insert(settingsTable)
    .values({ apiKey })
    .returning();
  return created;
}

const resendApiKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM || `${BRAND_APP_NAME} <onboarding@resend.dev>`;
const resend = resendApiKey ? new Resend(resendApiKey) : null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bodyToHtml(body: string): string {
  const lines = body.split(/\r?\n/);
  const html = lines
    .map((line) => {
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const escaped = escapeHtml(line);
      return escaped.replace(urlRegex, (url) => {
        const safe = escapeHtml(url);
        return `<a href="${safe}" style="color:#4451A0;text-decoration:underline">${safe}</a>`;
      });
    })
    .join("<br>");
  const safeAppName = escapeHtml(BRAND_APP_NAME);
  return `<div style="font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;color:#0F172A;font-size:15px;line-height:1.6;max-width:560px;margin:0 auto;padding:24px">
    <div style="border-bottom:3px solid #4451A0;padding-bottom:12px;margin-bottom:24px">
      <strong style="font-size:20px;color:#4451A0;letter-spacing:0.5px;font-family:'Snell Roundhand','Brush Script MT',cursive;font-weight:400">${safeAppName}</strong>
    </div>
    <div>${html}</div>
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #E2E8F0;color:#94A3B8;font-size:12px">
      Sent by ${BRAND_APP_NAME}
    </div>
  </div>`;
}

/**
 * Create an in-app notification for a single recipient. Use the
 * audience+userId pair to identify them (audience='client' → clientsTable.id,
 * audience='admin' → adminUsersTable.id).
 */
export async function createNotification(args: {
  audience: "client" | "admin";
  userId: number;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}): Promise<void> {
  await db.insert(notificationsTable).values({
    audience: args.audience,
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body: args.body ?? null,
    link: args.link ?? null,
  });
}

/**
 * Look up admin operators that should receive notifications for a given
 * scope (e.g. "support"). Includes super_admins (always notified), admins
 * with empty scope arrays (= full access), and anyone explicitly scoped.
 */
export async function getAdminsForScope(scope: string): Promise<AdminUserRow[]> {
  const rows = await db.select().from(adminUsersTable);
  return rows.filter((a) => {
    if (a.role === "super_admin") return true;
    const scopes = (a.scopes ?? []) as string[];
    if (scopes.length === 0) return true;
    return scopes.includes(scope);
  });
}

/**
 * Convenience: create an in-app notification AND send an email to a list
 * of admins for a given scope.
 */
export async function notifyScopedAdmins(
  scope: string,
  args: { kind: string; title: string; body: string; link?: string },
): Promise<void> {
  const admins = await getAdminsForScope(scope);
  await Promise.all(
    admins.map(async (a) => {
      await createNotification({
        audience: "admin",
        userId: a.id,
        kind: args.kind,
        title: args.title,
        body: args.body,
        link: args.link ?? null,
      });
      if (a.email) await notify(a.email, args.title, args.body);
    }),
  );
}

export async function unreadCount(audience: "client" | "admin", userId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(
      sql`${notificationsTable.audience} = ${audience}
          AND ${notificationsTable.userId} = ${userId}
          AND ${notificationsTable.readAt} IS NULL`,
    );
  return Number(row?.n ?? 0);
}

void eq; // re-export for callers that need it

export type NotifyResult = { ok: boolean; error?: string };

export async function notify(
  to: string,
  subject: string,
  body: string,
): Promise<NotifyResult> {
  if (!to) return { ok: false, error: "No recipient address" };
  if (!resend) {
    logger.warn({ to, subject }, "[notify] RESEND_API_KEY not set — email skipped");
    return { ok: false, error: "Email service is not configured (RESEND_API_KEY missing)" };
  }
  try {
    const result = await resend.emails.send({
      from: resendFrom,
      to,
      subject,
      text: body,
      html: bodyToHtml(body),
    });
    if (result.error) {
      const message =
        (result.error as { message?: string }).message ||
        "Email provider rejected the message";
      logger.error({ to, subject, err: result.error }, "[notify] Resend send failed");
      return { ok: false, error: message };
    }
    logger.info({ to, subject, id: result.data?.id }, "[notify] email sent");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    logger.error({ to, subject, err }, "[notify] email send threw");
    return { ok: false, error: message };
  }
}
