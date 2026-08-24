import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  modulesTable,
  episodesTable,
  episodeAssetsTable,
  clientUploadsTable,
  supportTicketsTable,
  supportTicketMessagesTable,
  activityEventsTable,
  objectUploadsTable,
} from "@workspace/db";
import { requireAdmin, requireAdminWrite, requireClient } from "../lib/access";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getOrCreateSettings, notify, logActivity } from "../lib/notifications";

const router: IRouter = Router();
const storage = new ObjectStorageService();

function reqContext(req: Request): { ip: string; userAgent: string } {
  const fwd = req.headers["x-forwarded-for"];
  const ip = typeof fwd === "string" && fwd.length > 0
    ? fwd.split(",")[0].trim()
    : req.ip || req.socket.remoteAddress || "";
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"]!.slice(0, 512) : "";
  return { ip, userAgent: ua };
}

function sanitizeName(s: unknown, fallback = "file"): string {
  const raw = typeof s === "string" ? s : "";
  const cleaned = raw.replace(/[\r\n\t]/g, " ").trim().slice(0, 200);
  return cleaned || fallback;
}

// ============================================================================
// Support thread — client side
// ============================================================================

router.get("/me/support", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.clientId, client.id))
    .orderBy(desc(supportTicketsTable.lastMessageAt));
  res.json(
    tickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      lastMessageAt: t.lastMessageAt.toISOString(),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
    })),
  );
});

router.get("/me/support/:id", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const [t] = await db
    .select()
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.clientId, client.id)));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  const messages = await db
    .select()
    .from(supportTicketMessagesTable)
    .where(eq(supportTicketMessagesTable.ticketId, t.id))
    .orderBy(asc(supportTicketMessagesTable.createdAt));
  res.json({
    id: t.id,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorName: m.authorName,
      authorEmail: m.authorEmail,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

router.post("/me/support/:id/messages", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: false });
  if (!client) return;
  const id = Number(req.params.id);
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 8000) : "";
  if (!Number.isFinite(id) || !body) { res.status(400).json({ error: "Bad request" }); return; }
  const [t] = await db
    .select()
    .from(supportTicketsTable)
    .where(and(eq(supportTicketsTable.id, id), eq(supportTicketsTable.clientId, client.id)));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  const now = new Date();
  await db.insert(supportTicketMessagesTable).values({
    ticketId: t.id,
    authorType: "client",
    authorId: client.id,
    authorName: `${client.firstName} ${client.lastName}`,
    authorEmail: client.email,
    body,
  });
  // A client reply on a resolved ticket reopens it.
  await db
    .update(supportTicketsTable)
    .set({ lastMessageAt: now, status: t.status === "resolved" ? "open" : t.status, resolvedAt: t.status === "resolved" ? null : t.resolvedAt })
    .where(eq(supportTicketsTable.id, t.id));
  const settings = await getOrCreateSettings();
  const supportTo = settings.supportEmail || settings.notifyIcpEmail;
  if (supportTo) {
    await notify(
      supportTo,
      `[Support reply] ${t.subject} — ${client.firstName} ${client.lastName}`,
      `New reply on ticket #${t.id} from ${client.firstName} ${client.lastName} <${client.email}>:\n\n${body}`,
    );
  }
  res.status(204).end();
});

// ============================================================================
// Support thread — admin side
// ============================================================================

router.get("/admin/support", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const where = status === "open" || status === "resolved"
    ? eq(supportTicketsTable.status, status)
    : undefined;
  const tickets = await (where
    ? db.select().from(supportTicketsTable).where(where).orderBy(desc(supportTicketsTable.lastMessageAt))
    : db.select().from(supportTicketsTable).orderBy(desc(supportTicketsTable.lastMessageAt))
  );
  const clientIds = Array.from(new Set(tickets.map((t) => t.clientId)));
  const clients = clientIds.length
    ? await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds))
    : [];
  const byId = new Map(clients.map((c) => [c.id, c]));
  res.json(
    tickets.map((t) => {
      const c = byId.get(t.clientId);
      return {
        id: t.id,
        subject: t.subject,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        lastMessageAt: t.lastMessageAt.toISOString(),
        resolvedAt: t.resolvedAt?.toISOString() ?? null,
        client: c
          ? { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, businessName: c.businessName }
          : null,
      };
    }),
  );
});

router.get("/admin/support/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);
  const [t] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, t.clientId));
  const messages = await db
    .select()
    .from(supportTicketMessagesTable)
    .where(eq(supportTicketMessagesTable.ticketId, t.id))
    .orderBy(asc(supportTicketMessagesTable.createdAt));
  res.json({
    id: t.id,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    client: c
      ? { id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, businessName: c.businessName }
      : null,
    messages: messages.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorName: m.authorName,
      authorEmail: m.authorEmail,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// NOTE: `POST /admin/support/:id/messages` and `PATCH /admin/support/:id` are
// served by routes/admin.ts (registered first in routes/index.ts). The handlers
// that previously lived here were dead code. Keep all admin-side support
// mutations in admin.ts — this file is for client-side support + asset routes.

// ============================================================================
// Episode assets — admin upload, client download
// ============================================================================

// Client-visible list of assets attached to an episode. Only published
// episodes inside published modules are exposed.
router.get("/me/episodes/:id/assets", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const [ep] = await db.select().from(episodesTable).where(eq(episodesTable.id, id));
  if (!ep || !ep.published) { res.json([]); return; }
  const [mod] = await db.select().from(modulesTable).where(eq(modulesTable.id, ep.moduleId));
  if (!mod || !mod.published) { res.json([]); return; }
  const rows = await db
    .select()
    .from(episodeAssetsTable)
    .where(eq(episodeAssetsTable.episodeId, id))
    .orderBy(asc(episodeAssetsTable.createdAt));
  res.json(rows.map((a) => ({
    id: a.id,
    name: a.name,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  })));
});

router.get("/admin/episodes/:id/assets", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(episodeAssetsTable)
    .where(eq(episodeAssetsTable.episodeId, id))
    .orderBy(asc(episodeAssetsTable.createdAt));
  res.json(rows.map((a) => ({
    id: a.id,
    name: a.name,
    objectPath: a.objectPath,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    createdAt: a.createdAt.toISOString(),
  })));
});

router.post("/admin/episodes/:id/assets", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const episodeId = Number(req.params.id);
  const name = sanitizeName(req.body?.name);
  const objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath : "";
  const contentType = typeof req.body?.contentType === "string" ? req.body.contentType.slice(0, 200) : "";
  const sizeBytes = Number.isFinite(req.body?.size) ? Math.max(0, Math.floor(req.body.size)) : 0;
  if (!Number.isFinite(episodeId) || !objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "Bad request" });
    return;
  }
  const [ep] = await db.select().from(episodesTable).where(eq(episodesTable.id, episodeId));
  if (!ep) { res.status(404).json({ error: "Episode not found" }); return; }
  const [row] = await db.insert(episodeAssetsTable).values({
    episodeId, name, objectPath, contentType, sizeBytes, uploadedByAdminId: admin.id,
  }).returning();
  res.json({
    id: row.id,
    name: row.name,
    objectPath: row.objectPath,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  });
});

router.delete("/admin/episodes/assets/:assetId", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = Number(req.params.assetId);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }
  await db.delete(episodeAssetsTable).where(eq(episodeAssetsTable.id, id));
  res.status(204).end();
});

// ============================================================================
// Client uploads — client uploads files against an episode/checklist item
// ============================================================================

router.post("/me/episodes/:id/uploads", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: false });
  if (!client) return;
  const episodeId = Number(req.params.id);
  if (!Number.isFinite(episodeId)) {
    res.status(400).json({ error: "Bad request" });
    return;
  }
  // Two submission shapes:
  //   { kind:"file", name, objectPath, contentType, size, checklistItemId? }
  //   { kind:"link", name, linkUrl,                                checklistItemId? }
  // Default kind is "file" so the old upload-only client keeps working.
  const requestedKind = String(req.body?.kind ?? "file");
  const kind: "file" | "link" = requestedKind === "link" ? "link" : "file";
  const name = sanitizeName(req.body?.name);
  const checklistItemId = Number.isFinite(req.body?.checklistItemId)
    ? Math.floor(req.body.checklistItemId)
    : null;

  let objectPath: string | null = null;
  let linkUrl: string | null = null;
  let contentType = "";
  let sizeBytes = 0;

  if (kind === "file") {
    objectPath = typeof req.body?.objectPath === "string" ? req.body.objectPath : "";
    contentType = typeof req.body?.contentType === "string" ? req.body.contentType.slice(0, 200) : "";
    sizeBytes = Number.isFinite(req.body?.size) ? Math.max(0, Math.floor(req.body.size)) : 0;
    if (!objectPath || !objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "Bad request" });
      return;
    }
    // Cross-tenant rebinding guard: the objectPath must be one this client
    // was issued. Otherwise a client could register a foreign upload as
    // their own and read it back via /me/files/:kind/:id?kind=upload.
    const [owner] = await db
      .select()
      .from(objectUploadsTable)
      .where(eq(objectUploadsTable.objectPath, objectPath));
    if (!owner || owner.ownerType !== "client" || owner.ownerId !== client.id) {
      res.status(403).json({ error: "Object path was not issued to this client" });
      return;
    }
  } else {
    const raw = typeof req.body?.linkUrl === "string" ? req.body.linkUrl.trim() : "";
    // Only allow http(s) — blocks `javascript:`, `data:`, `file:` etc that
    // would otherwise execute in the admin's browser when they click the
    // link. URL constructor also rejects malformed input.
    let parsed: URL | null = null;
    try { parsed = new URL(raw); } catch { parsed = null; }
    if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
      res.status(400).json({ error: "Link must be a valid http(s) URL" });
      return;
    }
    // Cap stored URL length to keep an attacker from DoS-spamming megabyte
    // strings into the table.
    linkUrl = raw.slice(0, 2000);
  }

  const [ep] = await db.select().from(episodesTable).where(eq(episodesTable.id, episodeId));
  if (!ep) { res.status(404).json({ error: "Episode not found" }); return; }
  const [row] = await db.insert(clientUploadsTable).values({
    clientId: client.id, episodeId, checklistItemId,
    name, kind, objectPath, linkUrl, contentType, sizeBytes,
  }).returning();
  await logActivity(
    "client_upload",
    kind === "link"
      ? `${client.firstName} ${client.lastName} shared a link "${name}" on "${ep.title}"`
      : `${client.firstName} ${client.lastName} uploaded "${name}" to "${ep.title}"`,
    client.id,
  );
  res.json({
    id: row.id,
    name: row.name,
    kind: row.kind,
    objectPath: row.objectPath,
    linkUrl: row.linkUrl,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checklistItemId: row.checklistItemId,
    createdAt: row.createdAt.toISOString(),
  });
});

router.get("/me/episodes/:id/uploads", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const episodeId = Number(req.params.id);
  const rows = await db
    .select()
    .from(clientUploadsTable)
    .where(and(eq(clientUploadsTable.clientId, client.id), eq(clientUploadsTable.episodeId, episodeId)))
    .orderBy(desc(clientUploadsTable.createdAt));
  res.json(rows.map((u) => ({
    id: u.id,
    name: u.name,
    kind: u.kind,
    objectPath: u.objectPath,
    linkUrl: u.linkUrl,
    contentType: u.contentType,
    sizeBytes: u.sizeBytes,
    checklistItemId: u.checklistItemId,
    createdAt: u.createdAt.toISOString(),
  })));
});

router.delete("/me/uploads/:id", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: false });
  if (!client) return;
  const id = Number(req.params.id);
  const [row] = await db.select().from(clientUploadsTable).where(eq(clientUploadsTable.id, id));
  if (!row || row.clientId !== client.id) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(clientUploadsTable).where(eq(clientUploadsTable.id, id));
  res.status(204).end();
});

router.get("/admin/clients/:id/uploads", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const clientId = Number(req.params.id);
  const rows = await db
    .select()
    .from(clientUploadsTable)
    .where(eq(clientUploadsTable.clientId, clientId))
    .orderBy(desc(clientUploadsTable.createdAt));
  // Resolve episode titles in one round-trip.
  const epIds = Array.from(new Set(rows.map((r) => r.episodeId)));
  const eps = epIds.length
    ? await db.select().from(episodesTable).where(inArray(episodesTable.id, epIds))
    : [];
  const epById = new Map(eps.map((e) => [e.id, e]));
  res.json(rows.map((u) => ({
    id: u.id,
    name: u.name,
    kind: u.kind,
    objectPath: u.objectPath,
    linkUrl: u.linkUrl,
    contentType: u.contentType,
    sizeBytes: u.sizeBytes,
    checklistItemId: u.checklistItemId,
    episodeId: u.episodeId,
    episodeTitle: epById.get(u.episodeId)?.title ?? `Episode #${u.episodeId}`,
    createdAt: u.createdAt.toISOString(),
  })));
});

// ============================================================================
// Object serving — clients can fetch episode assets and their own uploads;
// admins can fetch anything by virtue of /storage/objects/* (already exists).
// ============================================================================

router.get("/me/files/:kind/:id", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const kind = String(req.params.kind);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Bad id" }); return; }

  let objectPath = "";
  let downloadName = "file";
  if (kind === "asset") {
    const [a] = await db.select().from(episodeAssetsTable).where(eq(episodeAssetsTable.id, id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    // Entitlement check: only let clients fetch assets attached to a
    // published episode inside a published module. This avoids enumerating
    // ids to read assets the client could not otherwise see in the UI.
    const [ep] = await db.select().from(episodesTable).where(eq(episodesTable.id, a.episodeId));
    if (!ep || !ep.published) { res.status(404).json({ error: "Not found" }); return; }
    const [mod] = await db.select().from(modulesTable).where(eq(modulesTable.id, ep.moduleId));
    if (!mod || !mod.published) { res.status(404).json({ error: "Not found" }); return; }
    objectPath = a.objectPath;
    downloadName = a.name;
  } else if (kind === "upload") {
    const [u] = await db.select().from(clientUploadsTable).where(eq(clientUploadsTable.id, id));
    if (!u || u.clientId !== client.id) { res.status(404).json({ error: "Not found" }); return; }
    // Link rows are not streamable — the frontend opens linkUrl directly.
    if (u.kind === "link" || !u.objectPath) { res.status(404).json({ error: "Not a file" }); return; }
    objectPath = u.objectPath;
    downloadName = u.name;
  } else {
    res.status(400).json({ error: "Unknown kind" });
    return;
  }

  if (!objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "Bad object path" });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    // Redirect the browser to a signed GCS URL so it downloads directly from
    // storage instead of streaming through the app (see getSignedDownloadUrl).
    const url = await storage.getSignedDownloadUrl(file, { filename: downloadName });
    res.redirect(302, url);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving client file");
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve file" });
  }
});

// Same admin-side download (returns Content-Disposition with the original
// filename) so the admin client detail page can link uploads with friendly
// names instead of the raw GCS object id.
router.get("/admin/files/:kind/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const kind = String(req.params.kind);
  const id = Number(req.params.id);
  let objectPath = "";
  let downloadName = "file";
  if (kind === "asset") {
    const [a] = await db.select().from(episodeAssetsTable).where(eq(episodeAssetsTable.id, id));
    if (!a) { res.status(404).json({ error: "Not found" }); return; }
    objectPath = a.objectPath;
    downloadName = a.name;
  } else if (kind === "upload") {
    const [u] = await db.select().from(clientUploadsTable).where(eq(clientUploadsTable.id, id));
    if (!u) { res.status(404).json({ error: "Not found" }); return; }
    if (u.kind === "link" || !u.objectPath) { res.status(404).json({ error: "Not a file" }); return; }
    objectPath = u.objectPath;
    downloadName = u.name;
  } else {
    res.status(400).json({ error: "Unknown kind" });
    return;
  }
  try {
    const file = await storage.getObjectEntityFile(objectPath);
    // Redirect the browser to a signed GCS URL so it downloads directly from
    // storage instead of streaming through the app (see getSignedDownloadUrl).
    const url = await storage.getSignedDownloadUrl(file, { filename: downloadName });
    res.redirect(302, url);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving admin file");
    if (!res.headersSent) res.status(500).json({ error: "Failed to serve file" });
  }
});

// Variants of activity context (kept tiny so we don't drag in lib/access).
void reqContext;

export default router;
