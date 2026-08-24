import type { Request } from "express";
import { db, activityEventsTable } from "@workspace/db";

export type Actor =
  | { type: "client"; id: number; email: string | null }
  | { type: "admin"; id: number; email: string | null }
  | { type: "system" };

export function getRequestIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return String(fwd[0]).split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "";
}

export function getRequestUserAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 512) : "";
}

export async function recordActivity(opts: {
  kind: string;
  message: string;
  clientId?: number | null;
  actor?: Actor | null;
  req?: Request | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const ip = opts.req ? getRequestIp(opts.req) : null;
  const ua = opts.req ? getRequestUserAgent(opts.req) : null;
  const actor = opts.actor;
  await db.insert(activityEventsTable).values({
    kind: opts.kind,
    message: opts.message,
    clientId: opts.clientId ?? null,
    actorType: actor?.type ?? null,
    actorId: actor && "id" in actor ? actor.id : null,
    actorEmail: actor && "email" in actor ? actor.email : null,
    ip,
    userAgent: ua,
    metadata: opts.metadata ?? {},
  });
}
