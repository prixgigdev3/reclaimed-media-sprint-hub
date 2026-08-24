import { and, eq, asc, inArray, sql } from "drizzle-orm";
import {
  db,
  supportTicketsTable,
  supportTicketMessagesTable,
  supportAttachmentsTable,
  type SupportTicket,
} from "@workspace/db";

export interface AttachmentInput {
  kind: "image" | "file" | "link";
  name: string;
  url?: string | null;
  objectPath?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
}

/**
 * Validate and trim attachment payloads from the client. Caps at 10
 * attachments per message; silently drops malformed entries so a single
 * bad row doesn't fail the whole reply.
 */
/**
 * Allow-list URL schemes for stored link attachments. Anything else (e.g.
 * `javascript:`, `data:`, `file:`) is rejected to prevent stored XSS /
 * phishing in chat bubbles that render the link as an anchor.
 */
function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

/**
 * Strict object-path format: must be the canonical "/objects/<id>" emitted
 * by the upload-URL helper. Refusing arbitrary paths blocks a registered
 * client from binding a known-private path (e.g. someone else's upload) to
 * a ticket they own and then fetching it via /me/files/*.
 */
const OBJECT_PATH_RE = /^\/objects\/[A-Za-z0-9_\-./]{1,400}$/;
function safeObjectPath(raw: string): string | null {
  if (!raw || raw.includes("..")) return null;
  return OBJECT_PATH_RE.test(raw) ? raw : null;
}

export function sanitizeAttachments(raw: unknown): AttachmentInput[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentInput[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const kind = a.kind === "image" || a.kind === "file" || a.kind === "link" ? a.kind : null;
    if (!kind) continue;
    const name = typeof a.name === "string" ? a.name.slice(0, 200) : "";
    if (!name) continue;
    const url = typeof a.url === "string" ? safeHttpUrl(a.url) : null;
    const objectPath = typeof a.objectPath === "string" ? safeObjectPath(a.objectPath) : null;
    if (kind === "link" && !url) continue;
    if ((kind === "image" || kind === "file") && !objectPath) continue;
    out.push({
      kind,
      name,
      url,
      objectPath,
      contentType: typeof a.contentType === "string" ? a.contentType.slice(0, 100) : null,
      sizeBytes: typeof a.sizeBytes === "number" && Number.isFinite(a.sizeBytes) ? a.sizeBytes : null,
    });
  }
  return out;
}

export async function loadTicketDetail(ticketId: number) {
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, ticketId));
  if (!t) return null;
  const messages = await db
    .select()
    .from(supportTicketMessagesTable)
    .where(eq(supportTicketMessagesTable.ticketId, ticketId))
    .orderBy(asc(supportTicketMessagesTable.createdAt));
  const ids = messages.map((m) => m.id);
  const atts = ids.length
    ? await db.select().from(supportAttachmentsTable).where(inArray(supportAttachmentsTable.messageId, ids))
    : [];
  const attsByMsg = new Map<number, typeof atts>();
  for (const a of atts) {
    const arr = attsByMsg.get(a.messageId) ?? [];
    arr.push(a);
    attsByMsg.set(a.messageId, arr);
  }
  return {
    ticket: t,
    messages: messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorName: m.authorName,
      authorEmail: m.authorEmail,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      attachments: (attsByMsg.get(m.id) ?? []).map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        url: a.url,
        objectPath: a.objectPath,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    })),
  };
}

/**
 * Per-ticket SLA timings computed from message history.
 *  - firstResponseMs: how long it took for the first admin reply (null if
 *    the team hasn't replied yet)
 *  - resolutionMs: total open->resolved duration (null if still open)
 *  - awaitingReplyMs: how long the client has been waiting on us right now
 *    (null unless the ticket is open AND the last message is from the
 *    client — i.e. the ball is in our court)
 *  - lastMessageAuthor: who sent the most recent message
 */
export interface TicketSla {
  firstResponseMs: number | null;
  resolutionMs: number | null;
  awaitingReplyMs: number | null;
  lastMessageAuthor: "client" | "admin" | null;
}

/**
 * Compute SLA timings for a batch of tickets in two grouped queries
 * (cheap regardless of message volume). Returns a Map keyed by ticket id.
 */
export async function computeTicketSlas(
  tickets: Pick<SupportTicket, "id" | "createdAt" | "resolvedAt" | "status">[],
  now: Date = new Date(),
): Promise<Map<number, TicketSla>> {
  const out = new Map<number, TicketSla>();
  if (tickets.length === 0) return out;
  const ids = tickets.map((t) => t.id);

  // First admin reply per ticket. Uses drizzle's `inArray` rather than a
  // raw ANY(${ids}) — inlining a number[] into a tagged sql template renders
  // as `($1,$2,...)` (a tuple, not an array), which Postgres rejects with a
  // syntax error inside ANY(...). `inArray` builds the right `IN (...)`
  // clause regardless of array length.
  const firstAdmin = await db
    .select({
      ticketId: supportTicketMessagesTable.ticketId,
      firstAt: sql<Date>`min(${supportTicketMessagesTable.createdAt})`,
    })
    .from(supportTicketMessagesTable)
    .where(
      and(
        inArray(supportTicketMessagesTable.ticketId, ids),
        eq(supportTicketMessagesTable.authorType, "admin"),
      ),
    )
    .groupBy(supportTicketMessagesTable.ticketId);
  const firstAdminMap = new Map<number, Date>(
    firstAdmin.map((r) => [r.ticketId, r.firstAt instanceof Date ? r.firstAt : new Date(r.firstAt as unknown as string)]),
  );

  // Most recent message per ticket (author + timestamp). Same array-binding
  // gotcha as above — interpolate `inArray` rather than `ANY(${ids})`.
  const lastMsg = await db.execute<{ ticket_id: number; author_type: string; created_at: Date }>(sql`
    select distinct on (ticket_id) ticket_id, author_type, created_at
    from ${supportTicketMessagesTable}
    where ${inArray(supportTicketMessagesTable.ticketId, ids)}
    order by ticket_id, created_at desc
  `);
  const lastMap = new Map<number, { author: "client" | "admin"; at: Date }>();
  for (const r of lastMsg.rows ?? []) {
    const author = r.author_type === "admin" ? "admin" : "client";
    const at = r.created_at instanceof Date ? r.created_at : new Date(r.created_at as unknown as string);
    lastMap.set(r.ticket_id, { author, at });
  }

  for (const t of tickets) {
    const firstAt = firstAdminMap.get(t.id) ?? null;
    const last = lastMap.get(t.id) ?? null;
    const firstResponseMs = firstAt ? firstAt.getTime() - t.createdAt.getTime() : null;
    const resolutionMs = t.resolvedAt ? t.resolvedAt.getTime() - t.createdAt.getTime() : null;
    const awaitingReplyMs = t.status === "open" && last?.author === "client"
      ? now.getTime() - last.at.getTime()
      : null;
    out.set(t.id, {
      firstResponseMs: firstResponseMs !== null && firstResponseMs >= 0 ? firstResponseMs : null,
      resolutionMs: resolutionMs !== null && resolutionMs >= 0 ? resolutionMs : null,
      awaitingReplyMs: awaitingReplyMs !== null && awaitingReplyMs >= 0 ? awaitingReplyMs : null,
      lastMessageAuthor: last?.author ?? null,
    });
  }
  return out;
}

/**
 * Aggregate helpers for support metrics.
 */
export function avg(nums: number[]): number | null {
  const v = nums.filter((n) => Number.isFinite(n));
  if (v.length === 0) return null;
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
}

export function median(nums: number[]): number | null {
  const v = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? Math.round((v[mid - 1] + v[mid]) / 2) : v[mid];
}

/**
 * Look up the support ticket that owns a given object storage path so we
 * can authorize file downloads against the ticket's client + admins.
 */
export async function findTicketForObjectPath(objectPath: string): Promise<{ ticketId: number; clientId: number } | null> {
  const [att] = await db
    .select({ ticketId: supportTicketMessagesTable.ticketId, clientId: supportTicketsTable.clientId })
    .from(supportAttachmentsTable)
    .innerJoin(
      supportTicketMessagesTable,
      eq(supportTicketMessagesTable.id, supportAttachmentsTable.messageId),
    )
    .innerJoin(
      supportTicketsTable,
      eq(supportTicketsTable.id, supportTicketMessagesTable.ticketId),
    )
    .where(eq(supportAttachmentsTable.objectPath, objectPath))
    .limit(1);
  return att ?? null;
}
