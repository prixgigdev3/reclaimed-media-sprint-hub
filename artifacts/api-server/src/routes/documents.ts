import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { eq, and, desc, asc, isNull, inArray } from "drizzle-orm";
import { Readable } from "stream";
import { db, clientDocumentsTable, clientsTable, type ClientDocument } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAdmin, requireAdminWrite, requireClient } from "../lib/access";
import { logActivity } from "../lib/notifications";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

type DocKind = "folder" | "file" | "link";

async function uploadGenericBuffer(buffer: Buffer, contentType: string, ownerId: string): Promise<string> {
  const uploadUrl = await objectStorage.getObjectEntityUploadURL();
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType || "application/octet-stream" },
    body: new Uint8Array(buffer),
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed: ${putRes.status} ${await putRes.text()}`);
  }
  return objectStorage.trySetObjectEntityAclPolicy(uploadUrl, { owner: ownerId, visibility: "private" });
}

function shapeDoc(d: ClientDocument) {
  return {
    id: d.id,
    clientId: d.clientId,
    parentId: d.parentId ?? null,
    title: d.title,
    description: d.description,
    kind: d.kind as DocKind,
    linkUrl: d.linkUrl ?? null,
    originalFilename: d.originalFilename ?? null,
    mimeType: d.mimeType ?? null,
    sizeBytes: d.sizeBytes ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}

// Walk parents up the tree to build breadcrumbs for the current folder.
async function buildAncestors(clientId: number, folderId: number | null) {
  if (!folderId) return [] as ReturnType<typeof shapeDoc>[];
  const chain: ClientDocument[] = [];
  let cursor: number | null = folderId;
  // Hard cap to avoid an infinite loop if data is ever corrupted.
  for (let i = 0; cursor && i < 32; i++) {
    const [row] = await db
      .select()
      .from(clientDocumentsTable)
      .where(and(eq(clientDocumentsTable.id, cursor), eq(clientDocumentsTable.clientId, clientId)));
    if (!row) break;
    chain.push(row);
    cursor = row.parentId ?? null;
  }
  return chain.reverse().map(shapeDoc);
}

// Recursively collect every descendant id of a folder so delete can clean
// children + their object storage files in one pass.
async function collectDescendants(clientId: number, rootId: number) {
  const all: ClientDocument[] = [];
  let frontier: number[] = [rootId];
  for (let depth = 0; depth < 32 && frontier.length > 0; depth++) {
    const rows = await db
      .select()
      .from(clientDocumentsTable)
      .where(and(eq(clientDocumentsTable.clientId, clientId), inArray(clientDocumentsTable.parentId, frontier)));
    if (rows.length === 0) break;
    all.push(...rows);
    frontier = rows.map((r) => r.id);
  }
  return all;
}

// List items inside a folder (or the root). Always returns ordering: folders
// first then files/links, both alphabetised by title — this mirrors the
// expectation that admins see folders grouped on top.
async function listFolder(clientId: number, parentId: number | null) {
  const where = parentId
    ? and(eq(clientDocumentsTable.clientId, clientId), eq(clientDocumentsTable.parentId, parentId))
    : and(eq(clientDocumentsTable.clientId, clientId), isNull(clientDocumentsTable.parentId));
  const rows = await db.select().from(clientDocumentsTable).where(where).orderBy(asc(clientDocumentsTable.title));
  const folders = rows.filter((r) => r.kind === "folder");
  const others = rows.filter((r) => r.kind !== "folder");
  return [...folders, ...others].map(shapeDoc);
}

function parseParentId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function ensureFolderBelongsToClient(clientId: number, folderId: number | null) {
  if (!folderId) return true;
  const [row] = await db
    .select()
    .from(clientDocumentsTable)
    .where(and(eq(clientDocumentsTable.id, folderId), eq(clientDocumentsTable.clientId, clientId)));
  return !!row && row.kind === "folder";
}

async function deleteWithDescendants(clientId: number, doc: ClientDocument) {
  const docs: ClientDocument[] = [doc];
  if (doc.kind === "folder") {
    const children = await collectDescendants(clientId, doc.id);
    docs.push(...children);
  }
  // Note: we don't currently delete the underlying object storage entries —
  // the row deletion is what the user sees. Orphaned objects can be swept
  // separately if needed.
  await db
    .delete(clientDocumentsTable)
    .where(and(eq(clientDocumentsTable.clientId, clientId), inArray(clientDocumentsTable.id, docs.map((d) => d.id))));
}

// =============== ADMIN ===============

router.get("/admin/clients/:id/documents", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const clientId = parseInt(String(req.params.id), 10);
  const parentId = parseParentId(req.query.parentId);
  if (!(await ensureFolderBelongsToClient(clientId, parentId))) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const items = await listFolder(clientId, parentId);
  const ancestors = await buildAncestors(clientId, parentId);
  const folder = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  res.json({ folder, ancestors, items });
});

router.post(
  "/admin/clients/:id/documents",
  async (req, res, next) => {
    const admin = await requireAdminWrite(req, res);
    if (!admin) return;
    (req as Request & { _admin?: typeof admin })._admin = admin;
    next();
  },
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        if (e?.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "File too large (max 50MB)" });
          return;
        }
        res.status(400).json({ error: e?.message || "Upload error" });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    const admin = (req as Request & { _admin: { id: number } })._admin;
    const clientId = parseInt(String(req.params.id), 10);
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    const parentId = parseParentId(req.body?.parentId);
    if (!(await ensureFolderBelongsToClient(clientId, parentId))) {
      res.status(400).json({ error: "Parent folder not found" });
      return;
    }
    const title = typeof req.body?.title === "string" && req.body.title.trim().length > 0
      ? req.body.title.trim().slice(0, 200)
      : file?.originalname?.slice(0, 200) ?? "";
    const description = typeof req.body?.description === "string" ? req.body.description.slice(0, 2000) : "";
    const linkUrl = typeof req.body?.linkUrl === "string" ? req.body.linkUrl.trim() : "";
    const kindRaw = typeof req.body?.kind === "string" ? req.body.kind : "";
    const kind: DocKind = kindRaw === "folder" ? "folder" : file ? "file" : linkUrl ? "link" : kindRaw === "file" ? "file" : kindRaw === "link" ? "link" : "file";

    if (!title) {
      res.status(400).json({ error: "Title is required" });
      return;
    }

    let inserted: ClientDocument | undefined;
    if (kind === "folder") {
      [inserted] = await db
        .insert(clientDocumentsTable)
        .values({
          clientId,
          parentId: parentId ?? undefined,
          title,
          description,
          kind: "folder",
          uploadedByAdminId: admin.id,
        })
        .returning();
    } else if (kind === "file" && file) {
      try {
        const objectKey = await uploadGenericBuffer(file.buffer, file.mimetype, String(admin.id));
        [inserted] = await db
          .insert(clientDocumentsTable)
          .values({
            clientId,
            parentId: parentId ?? undefined,
            title,
            description,
            kind: "file",
            fileObjectKey: objectKey,
            originalFilename: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            uploadedByAdminId: admin.id,
          })
          .returning();
      } catch (err) {
        req.log.error({ err }, "client document upload failed");
        res.status(500).json({ error: "Failed to upload file" });
        return;
      }
    } else if (kind === "link") {
      if (!/^https?:\/\//i.test(linkUrl)) {
        res.status(400).json({ error: "linkUrl must start with http:// or https://" });
        return;
      }
      [inserted] = await db
        .insert(clientDocumentsTable)
        .values({
          clientId,
          parentId: parentId ?? undefined,
          title,
          description,
          kind: "link",
          linkUrl,
          uploadedByAdminId: admin.id,
        })
        .returning();
    } else {
      res.status(400).json({ error: "Provide a file, a linkUrl, or kind=folder" });
      return;
    }

    if (!inserted) {
      res.status(500).json({ error: "Insert failed" });
      return;
    }

    await logActivity(
      "client_document_added",
      `${kind === "folder" ? "Folder" : kind === "link" ? "Link" : "Document"} "${title}" added for ${client.firstName} ${client.lastName}`,
      clientId,
    );
    res.json(shapeDoc(inserted));
  },
);

router.patch("/admin/clients/:id/documents/:docId", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const clientId = parseInt(String(req.params.id), 10);
  const docId = parseInt(String(req.params.docId), 10);
  const [doc] = await db
    .select()
    .from(clientDocumentsTable)
    .where(and(eq(clientDocumentsTable.id, docId), eq(clientDocumentsTable.clientId, clientId)));
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  const patch: Partial<{ title: string; description: string; linkUrl: string }> = {};
  if (typeof req.body?.title === "string" && req.body.title.trim()) patch.title = req.body.title.trim().slice(0, 200);
  if (typeof req.body?.description === "string") patch.description = req.body.description.slice(0, 2000);
  if (doc.kind === "link" && typeof req.body?.linkUrl === "string") {
    if (!/^https?:\/\//i.test(req.body.linkUrl.trim())) {
      res.status(400).json({ error: "linkUrl must start with http:// or https://" });
      return;
    }
    patch.linkUrl = req.body.linkUrl.trim();
  }
  if (Object.keys(patch).length === 0) {
    res.json(shapeDoc(doc));
    return;
  }
  const [updated] = await db
    .update(clientDocumentsTable)
    .set(patch)
    .where(and(eq(clientDocumentsTable.id, docId), eq(clientDocumentsTable.clientId, clientId)))
    .returning();
  res.json(shapeDoc(updated));
});

router.delete("/admin/clients/:id/documents/:docId", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const clientId = parseInt(String(req.params.id), 10);
  const docId = parseInt(String(req.params.docId), 10);
  const [doc] = await db
    .select()
    .from(clientDocumentsTable)
    .where(and(eq(clientDocumentsTable.id, docId), eq(clientDocumentsTable.clientId, clientId)));
  if (!doc) { res.status(404).json({ error: "Not found" }); return; }
  await deleteWithDescendants(clientId, doc);
  res.sendStatus(204);
});

// =============== CLIENT ===============

router.get("/me/documents", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  const parentId = parseParentId(req.query.parentId);
  if (!(await ensureFolderBelongsToClient(client.id, parentId))) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const items = await listFolder(client.id, parentId);
  const ancestors = await buildAncestors(client.id, parentId);
  const folder = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  res.json({ folder, ancestors, items });
});

// Legacy flat listing kept for backwards compatibility — returns every doc
// for the client in case anything still calls the old shape. Falls back to
// the folder-shaped payload when ?flat is not set.
router.get("/me/documents/all", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  const rows = await db
    .select()
    .from(clientDocumentsTable)
    .where(eq(clientDocumentsTable.clientId, client.id))
    .orderBy(desc(clientDocumentsTable.createdAt));
  res.json(rows.map(shapeDoc));
});

router.get("/me/documents/:id/download", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  const docId = parseInt(String(req.params.id), 10);
  const [d] = await db
    .select()
    .from(clientDocumentsTable)
    .where(and(eq(clientDocumentsTable.id, docId), eq(clientDocumentsTable.clientId, client.id)));
  if (!d) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (d.kind === "link" && d.linkUrl) {
    res.redirect(d.linkUrl);
    return;
  }
  if (d.kind !== "file" || !d.fileObjectKey) {
    res.status(404).json({ error: "File missing" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(d.fileObjectKey);
    const dl = await objectStorage.downloadObject(file);
    const ct = dl.headers.get("Content-Type") ?? d.mimeType ?? "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(d.originalFilename ?? d.title ?? "document").replace(/"/g, "")}"`,
    );
    Readable.fromWeb(dl.body as ReadableStream<Uint8Array>).pipe(res);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    req.log.error({ err }, "document download failed");
    res.status(500).json({ error: "Download failed" });
  }
});

export default router;
