import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import multer from "multer";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAdmin, requireAdminWrite, resolveRole } from "../lib/access";
import { db, objectUploadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Lesson video uploads. 200MB cap covers walkthroughs without compress, but
// is small enough to refuse accidental hour-long screen recordings.
const lessonVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/webm"]);
const ALLOWED_VIDEO_EXT = /\.(mp4|webm)$/i;

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  // Allow either an admin (uploading episode assets / agreement logos) or
  // a logged-in client (uploading deliverables against an episode). The
  // ownership ACL is enforced when the file is later associated with a
  // database row (episode_assets / client_uploads).
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { role, client, admin } = await resolveRole(req.user.email, req.user.id);
  if (role !== "super_admin" && role !== "admin" && role !== "client") {
    res.status(403).json({ error: "Upload access required" });
    return;
  }
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name : null;
  const size = typeof body.size === "number" ? body.size : null;
  const contentType = typeof body.contentType === "string" ? body.contentType : null;
  if (!name || size == null || !contentType) {
    res.status(400).json({ error: "Missing or invalid required fields (name, size, contentType)" });
    return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    // Bind ownership of this freshly issued object path to the requester.
    // Any later /me/* write that references this path (support attachment,
    // episode upload, etc.) and any /me/files/*path read must verify
    // against this row to prevent cross-tenant rebinding.
    const ownerType = role === "client" ? "client" : "admin";
    const ownerId = role === "client" ? (client?.id ?? 0) : (admin?.id ?? 0);
    if (ownerId > 0) {
      await db
        .insert(objectUploadsTable)
        .values({ objectPath, ownerType, ownerId })
        .onConflictDoNothing();
    }
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  // Generic object reads are admin-only; agreement PDFs have dedicated
  // authenticated routes that scope access to assignment owners.
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    if (wildcardPath.includes("..")) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * GET /me/files/*
 *
 * Authenticated proxy to private object storage for clients (and admins).
 * Currently scoped to support attachments: only paths registered in
 * support_attachments are served, and the requester must be either the
 * ticket's owner client or any admin user.
 */
router.get("/me/files/*path", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
  if (!wildcardPath || wildcardPath.includes("..")) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  const objectPath = `/objects/${wildcardPath}`;
  // Authoritative authorization: serve the object only to the client the
  // upload URL was originally issued to (or to any admin). We deliberately
  // do NOT trust the support_attachments join here — a malicious client
  // could otherwise attach a known foreign objectPath to their own ticket
  // and read any tenant's upload via this proxy.
  const [owner] = await db
    .select()
    .from(objectUploadsTable)
    .where(eq(objectUploadsTable.objectPath, objectPath));
  const { role, client, admin } = await resolveRole(req.user.email, req.user.id);
  const isAdmin = !!admin && (role === "super_admin" || role === "admin" || role === "viewer");
  const isOwner = !!owner
    && owner.ownerType === "client"
    && role === "client"
    && !!client
    && client.id === owner.ownerId;
  if (!owner) {
    // Unknown path: don't leak existence; admins can still fetch via
    // /storage/objects/* which is gated on requireAdmin.
    res.status(404).json({ error: "File not found" });
    return;
  }
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving /me/files object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * POST /admin/episode-videos/upload
 *
 * Admin-only. Accepts an mp4/webm walkthrough video (multipart, field "file"),
 * stores it in private object storage, and returns a streaming URL that any
 * authenticated user can play. The returned URL is what the admin pastes into
 * an episode's videoUrl field.
 */
router.post(
  "/admin/episode-videos/upload",
  // Auth FIRST so unauthenticated callers can't push 200MB of body through
  // multer before we reject them.
  async (req, res, next) => {
    const admin = await requireAdminWrite(req, res);
    if (!admin) return;
    (req as Request & { __adminUserId?: string }).__adminUserId = String(admin.id);
    next();
  },
  (req, res, next) => {
    lessonVideoUpload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const e = err as { code?: string; message?: string };
        if (e?.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "Video too large (max 200MB). Compress with HandBrake or upload to Loom/YouTube and paste that URL instead." });
          return;
        }
        res.status(400).json({ error: e?.message || "Upload error" });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    const adminUserId = (req as Request & { __adminUserId?: string }).__adminUserId;
    if (!adminUserId) {
      // Belt-and-suspenders — auth middleware above should have set this.
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    const okMime = ALLOWED_VIDEO_MIME.has(file.mimetype);
    const okExt = ALLOWED_VIDEO_EXT.test(file.originalname);
    if (!okMime && !okExt) {
      res.status(400).json({ error: "Only .mp4 or .webm files are supported" });
      return;
    }
    try {
      const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
      const contentType = okMime ? file.mimetype : (file.originalname.toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4");
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: new Uint8Array(file.buffer),
      });
      if (!putRes.ok) {
        const txt = await putRes.text();
        req.log.error({ status: putRes.status, body: txt }, "Episode video upload to object storage failed");
        res.status(502).json({ error: "Storage upload failed" });
        return;
      }
      const objectPath = await objectStorageService.trySetObjectEntityAclPolicy(uploadUrl, {
        owner: adminUserId,
        visibility: "private",
      });
      // objectPath is like "/objects/<uuid>" — expose it via lesson-videos.
      // Bake the `/api` prefix into the stored URL since the api-server is
      // mounted there in the shared proxy. The browser hits this URL directly.
      const id = objectPath.replace(/^\/objects\//, "");
      const videoUrl = `/api/storage/lesson-videos/${id}`;
      res.json({ videoUrl, objectPath, contentType, sizeBytes: file.size });
    } catch (error) {
      req.log.error({ err: error }, "Episode video upload failed");
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

/**
 * GET /storage/lesson-videos/*path
 *
 * Streams a lesson video from private object storage to any authenticated
 * user (admin or client). Lesson videos are deliberately not client-scoped —
 * the same walkthrough is shown to every client whose episode references it.
 * Path is an opaque object UUID so it can't be guessed.
 */
router.get("/storage/lesson-videos/*path", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user?.email) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Require a real app role (admin or client) — bare OIDC authentication
  // isn't enough to read private lesson assets.
  const { role } = await resolveRole(req.user.email, req.user.id);
  if (role === "none") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    if (!wildcardPath || wildcardPath.includes("..")) {
      res.status(400).json({ error: "Invalid path" });
      return;
    }
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Video not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving lesson video");
    res.status(500).json({ error: "Failed to serve video" });
  }
});

export default router;
