import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import multer from "multer";
import {
  db,
  agreementTemplatesTable,
  agreementAssignmentsTable,
  agreementEventsTable,
  clientsTable,
  type AgreementField,
  type AgreementFieldValue,
  type AgreementPlaceholder,
} from "@workspace/db";
import { requireAdmin, requireAdminWrite, requireClient, resolveRole } from "../lib/access";
import {
  convertDocxToPdf,
  getPdfPageCount,
  uploadPdfBuffer,
  downloadPdf,
  renderSignedPdf,
  renderBuilderPdf,
  extractPlaceholders,
  applyPlaceholderDefaults,
} from "../lib/agreements";
import { autoFormatAgreement } from "../lib/agreementAutoFormat";
import { recordActivity, getRequestIp, getRequestUserAgent } from "../lib/activityLog";
import { notifyScopedAdmins } from "../lib/notifications";
import { ObjectStorageService } from "../lib/objectStorage";
import { Readable } from "stream";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const objectStorage = new ObjectStorageService();

function shapeTemplate(t: typeof agreementTemplatesTable.$inferSelect) {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    originalFilename: t.originalFilename,
    pageCount: t.pageCount,
    fields: t.fields,
    bodyMarkdown: t.bodyMarkdown,
    placeholders: t.placeholders,
    hasLogo: !!t.logoObjectKey,
    logoUrl: t.logoObjectKey ? `/api/admin/agreements/templates/${t.id}/logo` : null,
    archived: t.archived,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/**
 * Validate + sanitize an incoming placeholders array from the admin.
 * We only allow the admin to set role/defaultValue per placeholder; the rest
 * (key/type/label) are re-derived from the body text via extractPlaceholders.
 */
function sanitizeIncomingPlaceholders(raw: unknown): AgreementPlaceholder[] {
  if (!Array.isArray(raw)) return [];
  const out: AgreementPlaceholder[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Partial<AgreementPlaceholder>;
    if (typeof p.key !== "string" || !p.key) continue;
    const role = p.role === "admin" ? "admin" : "client";
    const defaultValue =
      typeof p.defaultValue === "string" && p.defaultValue.length <= 5000 ? p.defaultValue : undefined;
    out.push({
      key: p.key,
      label: typeof p.label === "string" ? p.label : p.key,
      type: (p.type as AgreementPlaceholder["type"]) ?? "text",
      required: p.required,
      role,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    });
  }
  return out;
}

function shapeAssignment(
  a: typeof agreementAssignmentsTable.$inferSelect,
  t?: typeof agreementTemplatesTable.$inferSelect,
  c?: typeof clientsTable.$inferSelect,
) {
  return {
    id: a.id,
    templateId: a.templateId,
    clientId: a.clientId,
    status: a.status,
    fieldValues: a.fieldValues,
    hasSignedPdf: !!a.signedPdfKey,
    clientSignedAt: a.clientSignedAt?.toISOString() ?? null,
    adminSignedAt: a.adminSignedAt?.toISOString() ?? null,
    assignedAt: a.assignedAt.toISOString(),
    completedAt: a.completedAt?.toISOString() ?? null,
    template: t
      ? {
          id: t.id,
          kind: t.kind,
          title: t.title,
          description: t.description,
          pageCount: t.pageCount,
          fields: t.fields,
          bodyMarkdown: t.bodyMarkdown,
          placeholders: t.placeholders,
        }
      : null,
    placeholderValues: a.placeholderValues ?? {},
    signatureMethod: a.signatureMethod ?? null,
    client: c
      ? {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          businessName: c.businessName,
        }
      : null,
  };
}

// =============== ADMIN: TEMPLATE PATCH REGISTRY ===============
//
// One-click wording updates the admin can apply to every builder template at
// once. Each patch is a literal find/replace pair against `body_markdown`.
// Patches are idempotent: applying twice is a no-op because the second pass
// no longer finds the original phrase. New agreed wording changes get appended
// to this list as they come up in conversation with the admin.
type TemplatePatch = {
  id: string;
  title: string;
  description: string;
  find: string;
  replace: string;
};

// One-off wording patches for existing builder templates. The previous
// business-specific patches were removed during the Reclaimed Media rebrand;
// add new entries here when template wording needs a bulk update.
const TEMPLATE_PATCHES: TemplatePatch[] = [];

router.get("/admin/agreements/patches", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  // Only surface patches that would actually do something: at least one
  // builder template still contains the original phrase. This makes the
  // "Apply wording updates (N)" button disappear once N drops to zero,
  // instead of sitting there forever after the patch has been applied.
  const templates = await db
    .select({ bodyMarkdown: agreementTemplatesTable.bodyMarkdown })
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.kind, "builder"));
  const bodies = templates.map((t) => t.bodyMarkdown ?? "");
  const applicable = TEMPLATE_PATCHES.filter((p) => bodies.some((b) => b.includes(p.find)));
  res.json(
    applicable.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
    })),
  );
});

router.post("/admin/agreements/patches/apply", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;

  const results: Array<{
    patchId: string;
    title: string;
    templatesUpdated: number;
    templatesAlreadyApplied: number;
    templatesNotApplicable: number;
    updatedTemplateIds: number[];
  }> = [];

  const templates = await db
    .select()
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.kind, "builder"));

  for (const patch of TEMPLATE_PATCHES) {
    let updated = 0;
    let alreadyApplied = 0;
    let notApplicable = 0;
    const updatedIds: number[] = [];

    for (const t of templates) {
      const body = t.bodyMarkdown ?? "";
      const hasOld = body.includes(patch.find);
      const hasNew = body.includes(patch.replace);
      if (hasOld) {
        const nextBody = body.split(patch.find).join(patch.replace);
        const nextPlaceholders = extractPlaceholders(nextBody, t.placeholders ?? []);
        await db
          .update(agreementTemplatesTable)
          .set({ bodyMarkdown: nextBody, placeholders: nextPlaceholders })
          .where(eq(agreementTemplatesTable.id, t.id));
        updated += 1;
        updatedIds.push(t.id);
        req.log.info(
          { templateId: t.id, patchId: patch.id, adminId: admin.id },
          "Applied template patch",
        );
      } else if (hasNew) {
        alreadyApplied += 1;
      } else {
        notApplicable += 1;
      }
    }

    results.push({
      patchId: patch.id,
      title: patch.title,
      templatesUpdated: updated,
      templatesAlreadyApplied: alreadyApplied,
      templatesNotApplicable: notApplicable,
      updatedTemplateIds: updatedIds,
    });
  }

  res.json({ results });
});

// =============== ADMIN: TEMPLATES ===============

router.get("/admin/agreements/templates", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const rows = await db.select().from(agreementTemplatesTable).orderBy(desc(agreementTemplatesTable.createdAt));
  res.json(rows.map(shapeTemplate));
});

// Auto-format an agreement body: ask the LLM to insert placeholder tokens
// at the appropriate spots. Returns the proposed body plus a list of
// inserted tokens and any guard warnings. The caller decides whether to
// accept the suggestion (we never persist directly here).
router.post("/admin/agreements/auto-format", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const body = typeof req.body?.body === "string" ? req.body.body : "";
  if (!body.trim()) {
    res.status(400).json({ error: "Body is required" });
    return;
  }
  if (body.length > 100_000) {
    res.status(400).json({ error: "Body too long" });
    return;
  }
  const result = await autoFormatAgreement(body);
  res.json(result);
});

// Create a builder (in-platform) template — no file upload.
router.post("/admin/agreements/templates/builder", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : "";
  const bodyMarkdown = typeof req.body?.bodyMarkdown === "string" ? req.body.bodyMarkdown : "";
  const incomingPlaceholders = sanitizeIncomingPlaceholders(req.body?.placeholders);
  const logoObjectKey =
    typeof req.body?.logoObjectKey === "string" && req.body.logoObjectKey.trim()
      ? req.body.logoObjectKey.trim()
      : null;
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  if (bodyMarkdown.length > 100_000) {
    res.status(400).json({ error: "Body too long" });
    return;
  }
  // Re-derive canonical placeholders from the body, then merge admin overrides
  // (role + defaultValue) for matching keys.
  const placeholders = extractPlaceholders(bodyMarkdown, incomingPlaceholders);
  const [created] = await db
    .insert(agreementTemplatesTable)
    .values({
      kind: "builder",
      title,
      description,
      pdfObjectKey: "",
      originalFilename: "",
      pageCount: 0,
      fields: [],
      bodyMarkdown,
      placeholders,
      logoObjectKey,
      createdByAdminId: admin.id,
    })
    .returning();
  await recordActivity({
    kind: "agreement_template_created",
    message: `Builder agreement "${title}" created`,
    actor: { type: "admin", id: admin.id, email: admin.email },
    req,
    metadata: { templateId: created.id, kind: "builder", placeholderCount: placeholders.length },
  });
  res.json(shapeTemplate(created));
});

router.post(
  "/admin/agreements/templates",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const admin = await requireAdminWrite(req, res);
    if (!admin) return;
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    const title = (req.body?.title as string) || file.originalname;
    const description = (req.body?.description as string) || "";
    const isPdf = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    const isDocx =
      file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.originalname.toLowerCase().endsWith(".docx") ||
      file.originalname.toLowerCase().endsWith(".doc");
    if (!isPdf && !isDocx) {
      res.status(400).json({ error: "Only PDF or DOCX/DOC files are supported" });
      return;
    }
    try {
      let pdfBuffer = file.buffer;
      if (isDocx) {
        pdfBuffer = await convertDocxToPdf(file.buffer);
      }
      const pageCount = await getPdfPageCount(pdfBuffer);
      const objectPath = await uploadPdfBuffer(pdfBuffer, String(admin.id));
      const [created] = await db
        .insert(agreementTemplatesTable)
        .values({
          title,
          description,
          pdfObjectKey: objectPath,
          originalFilename: file.originalname,
          pageCount,
          fields: [],
          createdByAdminId: admin.id,
        })
        .returning();
      await recordActivity({
        kind: "agreement_template_created",
        message: `Template "${title}" uploaded`,
        actor: { type: "admin", id: admin.id, email: admin.email },
        req,
        metadata: { templateId: created.id, pageCount },
      });
      res.json(shapeTemplate(created));
    } catch (err) {
      req.log.error({ err }, "agreement template upload failed");
      res.status(500).json({ error: "Failed to process file. Make sure it is a valid PDF or DOCX." });
    }
  },
);

router.get("/admin/agreements/templates/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, id));
  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(shapeTemplate(t));
});

router.patch("/admin/agreements/templates/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const body = req.body ?? {};
  // Load existing so we can merge admin overrides on placeholders correctly.
  const [existing] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const updates: Partial<typeof agreementTemplatesTable.$inferInsert> = {};
  if (typeof body.title === "string") updates.title = body.title;
  if (typeof body.description === "string") updates.description = body.description;
  if (Array.isArray(body.fields)) updates.fields = body.fields as AgreementField[];
  // Build canonical placeholders from (new or existing) body, preserving
  // admin-set role/defaultValue overrides from either the new payload or the
  // existing row.
  const incomingOverrides = sanitizeIncomingPlaceholders(body.placeholders);
  const overrideSource = incomingOverrides.length > 0 ? incomingOverrides : (existing.placeholders ?? []);
  if (typeof body.bodyMarkdown === "string") {
    updates.bodyMarkdown = body.bodyMarkdown;
    updates.placeholders = extractPlaceholders(body.bodyMarkdown, overrideSource);
  } else if (incomingOverrides.length > 0) {
    // Body unchanged but overrides updated — re-derive against existing body.
    updates.placeholders = extractPlaceholders(existing.bodyMarkdown, incomingOverrides);
  }
  if (body.logoObjectKey === null) {
    updates.logoObjectKey = null;
  } else if (typeof body.logoObjectKey === "string" && body.logoObjectKey.trim()) {
    updates.logoObjectKey = body.logoObjectKey.trim();
  }
  const [t] = await db
    .update(agreementTemplatesTable)
    .set(updates)
    .where(eq(agreementTemplatesTable.id, id))
    .returning();
  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(shapeTemplate(t));
});

// Upload (or replace) a brand logo for a template. Stores PNG/JPEG bytes in
// object storage and saves the path on the template row.
router.post(
  "/admin/agreements/templates/:id/logo",
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    const admin = await requireAdminWrite(req, res);
    if (!admin) return;
    const id = parseInt(String(req.params.id), 10);
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file" });
      return;
    }
    if (!/^image\/(png|jpe?g)$/i.test(file.mimetype)) {
      res.status(400).json({ error: "Logo must be PNG or JPEG" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      res.status(413).json({ error: "Logo too large (max 5MB)" });
      return;
    }
    try {
      const uploadUrl = await objectStorage.getObjectEntityUploadURL();
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.mimetype },
        body: new Uint8Array(file.buffer),
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed: ${putRes.status}`);
      }
      const objectPath = await objectStorage.trySetObjectEntityAclPolicy(uploadUrl, {
        owner: String(admin.id),
        visibility: "private",
      });
      const [t] = await db
        .update(agreementTemplatesTable)
        .set({ logoObjectKey: objectPath })
        .where(eq(agreementTemplatesTable.id, id))
        .returning();
      if (!t) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(shapeTemplate(t));
    } catch (err) {
      req.log.error({ err }, "logo upload failed");
      res.status(500).json({ error: "Failed to upload logo" });
    }
  },
);

// Stream the logo image for a template (admin-only).
router.get("/admin/agreements/templates/:id/logo", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, id));
  if (!t || !t.logoObjectKey) {
    res.status(404).json({ error: "No logo" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(t.logoObjectKey);
    const [meta] = await file.getMetadata();
    res.setHeader("Content-Type", (meta.contentType as string) || "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    Readable.fromWeb((await objectStorage.downloadObject(file)).body as ReadableStream<Uint8Array>).pipe(res);
  } catch (err) {
    req.log.error({ err }, "logo stream failed");
    res.status(404).json({ error: "Logo not found" });
  }
});

router.delete("/admin/agreements/templates/:id/logo", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [t] = await db
    .update(agreementTemplatesTable)
    .set({ logoObjectKey: null })
    .where(eq(agreementTemplatesTable.id, id))
    .returning();
  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(shapeTemplate(t));
});

router.delete("/admin/agreements/templates/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  await db.delete(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, id));
  res.json({ success: true });
});

router.get("/admin/agreements/templates/:id/pdf", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, id));
  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(t.pdfObjectKey);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=3600");
    Readable.fromWeb((await objectStorage.downloadObject(file)).body as ReadableStream<Uint8Array>).pipe(res);
  } catch (err) {
    req.log.error({ err }, "template pdf stream failed");
    res.status(404).json({ error: "PDF not found" });
  }
});

// =============== ADMIN: ASSIGNMENTS ===============

router.post("/admin/agreements/assignments", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const templateId = Number(req.body?.templateId);
  const clientId = Number(req.body?.clientId);
  // `preSigned` is set by the admin when the client signed this agreement
  // OUT OF BAND (paper / DocuSign / etc.) before being onboarded into the
  // hub. We still record an assignment so the audit trail and the agreement
  // gate logic are consistent, but it's stamped completed immediately so
  // the client doesn't have to re-sign anything to start their sprint.
  const preSigned = req.body?.preSigned === true;
  if (!templateId || !clientId) {
    res.status(400).json({ error: "templateId and clientId required" });
    return;
  }
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, templateId));
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!t || !c) {
    res.status(404).json({ error: "Template or client not found" });
    return;
  }
  const now = new Date();
  const [created] = await db
    .insert(agreementAssignmentsTable)
    .values({
      templateId,
      clientId,
      assignedByAdminId: admin.id,
      status: preSigned ? "completed" : "pending",
      ...(preSigned ? { clientSignedAt: now, completedAt: now } : {}),
    })
    .returning();
  await recordActivity({
    kind: preSigned ? "agreement_marked_pre_signed" : "agreement_assigned",
    message: preSigned
      ? `Marked "${t.title}" as already signed by ${c.firstName} ${c.lastName} (signed out of band)`
      : `Assigned "${t.title}" to ${c.firstName} ${c.lastName}`,
    clientId: c.id,
    actor: { type: "admin", id: admin.id, email: admin.email },
    req,
    metadata: { templateId, assignmentId: created.id, preSigned },
  });
  await db.insert(agreementEventsTable).values({
    assignmentId: created.id,
    actorType: "admin",
    actorId: admin.id,
    actorEmail: admin.email,
    kind: "assigned",
    metadata: { templateId, preSigned },
  });
  if (preSigned) {
    await db.insert(agreementEventsTable).values({
      assignmentId: created.id,
      actorType: "admin",
      actorId: admin.id,
      actorEmail: admin.email,
      kind: "signed",
      ip: getRequestIp(req) || null,
      userAgent: getRequestUserAgent(req) || null,
      metadata: {
        preSigned: true,
        note: "Marked as already signed out of band by admin during onboarding",
      },
    });
  }
  res.json(shapeAssignment(created, t, c));
});

router.get("/admin/agreements/assignments", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const clientIdQ = req.query.clientId ? Number(req.query.clientId) : undefined;
  const rows = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(clientIdQ ? eq(agreementAssignmentsTable.clientId, clientIdQ) : undefined)
    .orderBy(desc(agreementAssignmentsTable.assignedAt));
  const allTemplates = await db.select().from(agreementTemplatesTable);
  const allClients = await db.select().from(clientsTable);
  const tById = new Map(allTemplates.map((t) => [t.id, t]));
  const cById = new Map(allClients.map((c) => [c.id, c]));
  res.json(rows.map((a) => shapeAssignment(a, tById.get(a.templateId), cById.get(a.clientId))));
});

router.get("/admin/agreements/assignments/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [a] = await db.select().from(agreementAssignmentsTable).where(eq(agreementAssignmentsTable.id, id));
  if (!a) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, a.templateId));
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, a.clientId));
  const events = await db
    .select()
    .from(agreementEventsTable)
    .where(eq(agreementEventsTable.assignmentId, id))
    .orderBy(desc(agreementEventsTable.createdAt));
  res.json({
    ...shapeAssignment(a, t, c),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      actorType: e.actorType,
      actorEmail: e.actorEmail ?? null,
      ip: e.ip ?? null,
      createdAt: e.createdAt.toISOString(),
      metadata: e.metadata,
    })),
  });
});

router.delete("/admin/agreements/assignments/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  await db.delete(agreementAssignmentsTable).where(eq(agreementAssignmentsTable.id, id));
  res.json({ success: true });
});

router.post(
  "/admin/agreements/assignments/:id/sign",
  async (req: Request, res: Response): Promise<void> => {
    const admin = await requireAdminWrite(req, res);
    if (!admin) return;
    const id = parseInt(String(req.params.id), 10);
    const [a] = await db.select().from(agreementAssignmentsTable).where(eq(agreementAssignmentsTable.id, id));
    if (!a) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (a.status !== "client_signed") {
      res.status(400).json({ error: "Client must sign first" });
      return;
    }
    const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, a.templateId));
    if (!t) {
      res.status(404).json({ error: "Template missing" });
      return;
    }
    const merged = mergeValues(a.fieldValues ?? [], req.body?.fieldValues, "admin", t.fields ?? []);
    const pdfBuf = await downloadPdf(t.pdfObjectKey);
    const signedBuf = await renderSignedPdf(pdfBuf, t.fields ?? [], merged);
    const signedKey = await uploadPdfBuffer(signedBuf, String(admin.id));

    const now = new Date();
    const updatedRows = await db
      .update(agreementAssignmentsTable)
      .set({
        status: "completed",
        fieldValues: merged,
        adminSignedAt: now,
        adminSignedById: admin.id,
        signedPdfKey: signedKey,
        completedAt: now,
      })
      .where(and(eq(agreementAssignmentsTable.id, id), eq(agreementAssignmentsTable.status, "client_signed")))
      .returning();
    if (updatedRows.length === 0) {
      res.status(409).json({ error: "Assignment state changed; refresh and try again" });
      return;
    }
    const updated = updatedRows[0];
    await db.insert(agreementEventsTable).values({
      assignmentId: id,
      actorType: "admin",
      actorId: admin.id,
      actorEmail: admin.email,
      kind: "signed",
    });
    const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, a.clientId));
    await recordActivity({
      kind: "agreement_completed",
      message: `Agreement "${t.title}" countersigned for ${c?.firstName ?? ""} ${c?.lastName ?? ""}`.trim(),
      clientId: a.clientId,
      actor: { type: "admin", id: admin.id, email: admin.email },
      req,
      metadata: { assignmentId: id },
    });
    res.json(shapeAssignment(updated, t, c));
  },
);

router.get(
  "/admin/agreements/assignments/:id/signed.pdf",
  async (req: Request, res: Response): Promise<void> => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const id = parseInt(String(req.params.id), 10);
    const [a] = await db.select().from(agreementAssignmentsTable).where(eq(agreementAssignmentsTable.id, id));
    if (!a || !a.signedPdfKey) {
      res.status(404).json({ error: "Signed PDF not available" });
      return;
    }
    try {
      const file = await objectStorage.getObjectEntityFile(a.signedPdfKey);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="agreement-${id}.pdf"`);
      Readable.fromWeb((await objectStorage.downloadObject(file)).body as ReadableStream<Uint8Array>).pipe(res);
    } catch (err) {
      req.log.error({ err }, "signed pdf download failed");
      res.status(404).json({ error: "PDF not found" });
    }
  },
);

// =============== CLIENT: AGREEMENTS ===============

router.get("/me/agreements", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res);
  if (!client) return;
  const rows = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(eq(agreementAssignmentsTable.clientId, client.id))
    .orderBy(desc(agreementAssignmentsTable.assignedAt));
  const tIds = [...new Set(rows.map((r) => r.templateId))];
  const tList = tIds.length > 0 ? await db.select().from(agreementTemplatesTable) : [];
  const tById = new Map(tList.map((t) => [t.id, t]));
  res.json(rows.map((a) => shapeAssignment(a, tById.get(a.templateId), client)));
});

router.get("/me/agreements/:id", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res);
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  const [a] = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(and(eq(agreementAssignmentsTable.id, id), eq(agreementAssignmentsTable.clientId, client.id)));
  if (!a) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, a.templateId));
  // Log open with IP/UA for the audit trail.
  await db.insert(agreementEventsTable).values({
    assignmentId: id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    kind: "viewed",
    ip: getRequestIp(req) || null,
    userAgent: getRequestUserAgent(req) || null,
  });
  if (a.status === "pending") {
    await db
      .update(agreementAssignmentsTable)
      .set({ status: "viewed" })
      .where(eq(agreementAssignmentsTable.id, id));
  }
  await recordActivity({
    kind: "agreement_viewed",
    message: `Viewed agreement "${t?.title ?? id}"`,
    clientId: client.id,
    actor: { type: "client", id: client.id, email: client.email },
    req,
    metadata: { assignmentId: id },
  });
  res.json(shapeAssignment(a, t, client));
});

router.get("/me/agreements/:id/pdf", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res);
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  const [a] = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(and(eq(agreementAssignmentsTable.id, id), eq(agreementAssignmentsTable.clientId, client.id)));
  if (!a) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const useSigned = a.signedPdfKey && req.query.signed === "1";
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, a.templateId));
  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Builder templates have no source PDF — only the signed PDF is available.
  if (!useSigned && t.kind === "builder") {
    res.status(404).json({ error: "Document not yet signed" });
    return;
  }
  const key = useSigned ? a.signedPdfKey! : t.pdfObjectKey;
  try {
    const file = await objectStorage.getObjectEntityFile(key);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "private, max-age=600");
    Readable.fromWeb((await objectStorage.downloadObject(file)).body as ReadableStream<Uint8Array>).pipe(res);
  } catch (err) {
    req.log.error({ err }, "client pdf stream failed");
    res.status(404).json({ error: "PDF not found" });
  }
});

router.post("/me/agreements/:id/sign", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: false });
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  const [a] = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(and(eq(agreementAssignmentsTable.id, id), eq(agreementAssignmentsTable.clientId, client.id)));
  if (!a) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (a.status === "completed" || a.status === "client_signed") {
    res.status(400).json({ error: "Already signed" });
    return;
  }
  const [t] = await db.select().from(agreementTemplatesTable).where(eq(agreementTemplatesTable.id, a.templateId));
  if (!t) {
    res.status(404).json({ error: "Template missing" });
    return;
  }

  if (t.kind === "builder") {
    return signBuilderAgreement(req, res, a, t, client);
  }

  const merged = mergeValues(a.fieldValues ?? [], req.body?.fieldValues, "client", t.fields ?? []);
  const requiredClientFields = (t.fields ?? []).filter((f) => f.role === "client" && f.required !== false);
  const completedIds = new Set(merged.map((m) => m.value && m.fieldId));
  const missing = requiredClientFields.filter((f) => !completedIds.has(f.id));
  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required fields: ${missing.map((f) => f.id).join(", ")}` });
    return;
  }

  const now = new Date();
  const updatedRows = await db
    .update(agreementAssignmentsTable)
    .set({ status: "client_signed", fieldValues: merged, clientSignedAt: now })
    .where(and(
      eq(agreementAssignmentsTable.id, id),
      eq(agreementAssignmentsTable.clientId, client.id),
      inArray(agreementAssignmentsTable.status, ["pending", "viewed"]),
    ))
    .returning();
  if (updatedRows.length === 0) {
    res.status(409).json({ error: "Assignment state changed; refresh and try again" });
    return;
  }
  const updated = updatedRows[0];
  await db.insert(agreementEventsTable).values({
    assignmentId: id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    kind: "signed",
    ip: getRequestIp(req) || null,
    userAgent: getRequestUserAgent(req) || null,
  });
  await recordActivity({
    kind: "agreement_signed_by_client",
    message: `Client signed agreement #${id}`,
    clientId: client.id,
    actor: { type: "client", id: client.id, email: client.email },
    req,
    metadata: { assignmentId: id },
  });
  void notifyScopedAdmins("agreements", {
    kind: "agreement_signed",
    title: `Agreement signed: ${client.firstName} ${client.lastName}`,
    body: `${client.businessName} signed agreement "${t.title}". Review it in the Agreements tab.`,
    link: `/admin/agreements/assignments/${id}`,
  }).catch((err) => req.log.error({ err }, "notifyScopedAdmins(agreement_signed) failed"));
  res.json(shapeAssignment(updated));
});

async function signBuilderAgreement(
  req: Request,
  res: Response,
  a: typeof agreementAssignmentsTable.$inferSelect,
  t: typeof agreementTemplatesTable.$inferSelect,
  client: typeof clientsTable.$inferSelect,
): Promise<void> {
  const incomingValues = req.body?.placeholderValues;
  const signatureDataUrl = typeof req.body?.signatureDataUrl === "string" ? req.body.signatureDataUrl : "";
  const signatureMethodRaw = req.body?.signatureMethod;
  const signatureMethod: "drawn" | "typed" | null =
    signatureMethodRaw === "drawn" || signatureMethodRaw === "typed" ? signatureMethodRaw : null;

  if (!signatureDataUrl || !signatureMethod) {
    res.status(400).json({ error: "Signature is required" });
    return;
  }
  if (signatureDataUrl.length > 2_000_000) {
    res.status(400).json({ error: "Signature payload too large" });
    return;
  }
  if (signatureMethod === "drawn") {
    // Strict data-URL validation so we can't accept a "signed" submission that
    // would render a blank signature box because the image silently failed to embed.
    if (!/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(signatureDataUrl)) {
      res.status(400).json({ error: "Drawn signature must be a base64 PNG or JPEG data URL" });
      return;
    }
  } else if (signatureDataUrl.trim().length === 0 || signatureDataUrl.length > 200) {
    res.status(400).json({ error: "Typed signature must be 1–200 characters" });
    return;
  }

  // Sanitize placeholder values: only known *client-role* keys, string values,
  // trimmed, length-capped. Admin-role placeholders are filled server-side
  // from defaultValue and the client cannot override them.
  const placeholders = (t.placeholders ?? []) as AgreementPlaceholder[];
  const clientPlaceholders = placeholders.filter((p) => (p.role ?? "client") === "client");
  const clientKeys = new Set(clientPlaceholders.map((p) => p.key));
  const placeholdersByKey = new Map(placeholders.map((p) => [p.key, p]));
  // Strict validator for drawn-initial data URLs: must be PNG or JPEG, base64-
  // encoded, with valid magic bytes. Without this a malicious client could
  // submit any `data:image/...` string to satisfy a required initial field.
  const validateInitialDataUrl = (v: string): string | null => {
    const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+=*)$/i.exec(v);
    if (!m) return null;
    let buf: Buffer;
    try {
      buf = Buffer.from(m[2], "base64");
    } catch {
      return null;
    }
    if (buf.length < 8 || buf.length > 1_500_000) return null;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!isPng && !isJpg) return null;
    return v;
  };
  const cleanValues: Record<string, string> = {};
  if (incomingValues && typeof incomingValues === "object") {
    for (const [k, v] of Object.entries(incomingValues as Record<string, unknown>)) {
      if (!clientKeys.has(k)) continue; // ignore admin-role keys from client
      if (typeof v !== "string") continue;
      const ph = placeholdersByKey.get(k)!;
      if (ph.type === "initial") {
        if (v.length > 2_000_000) continue;
        // Initials may be either a drawn image (data URL) OR a typed string
        // captured via the "Type" tab in the SignaturePad. Drawn values get
        // strict magic-byte validation; typed values are sanitised to a
        // short alphanumeric string (max 12 chars) so they round-trip
        // safely into the PDF renderer (which already handles non-data-URL
        // initials as plain text — see lib/agreements.ts buildParagraphAtoms).
        if (v.startsWith("data:")) {
          const ok = validateInitialDataUrl(v);
          if (!ok) continue;
          cleanValues[k] = ok;
        } else {
          const typed = v.replace(/[^\p{L}\p{N}\s.\-']/gu, "").trim().slice(0, 12);
          if (!typed) continue;
          cleanValues[k] = typed;
        }
      } else {
        if (v.length > 5000) continue;
        const trimmed = v.trim();
        if (trimmed.length === 0) continue;
        cleanValues[k] = trimmed;
      }
    }
  }
  // Auto-fill date for client-role {{date}} if missing.
  if (clientKeys.has("date") && !cleanValues.date) {
    cleanValues.date = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  }
  // Verify required *client* placeholders are filled. (Admin placeholders are
  // resolved from defaults and need no client input.)
  const missing = clientPlaceholders.filter((p) => p.required !== false && !cleanValues[p.key]);
  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required fields: ${missing.map((p) => p.label).join(", ")}` });
    return;
  }
  // Bake in admin-role defaults so the rendered PDF shows them.
  const finalValues = applyPlaceholderDefaults(placeholders, cleanValues);

  const now = new Date();
  const signerName = `${client.firstName} ${client.lastName}`.trim() || client.email;

  // CLAIM the assignment first so a concurrent submit can't trigger a
  // duplicate render/upload. We move pending/viewed → client_signed atomically;
  // only the winner proceeds to render & upload, then promotes to completed.
  const claimRows = await db
    .update(agreementAssignmentsTable)
    .set({
      status: "client_signed",
      placeholderValues: cleanValues,
      signatureDataUrl,
      signatureMethod,
      clientSignedAt: now,
    })
    .where(and(
      eq(agreementAssignmentsTable.id, a.id),
      eq(agreementAssignmentsTable.clientId, client.id),
      inArray(agreementAssignmentsTable.status, ["pending", "viewed"]),
    ))
    .returning();
  if (claimRows.length === 0) {
    res.status(409).json({ error: "Assignment state changed; refresh and try again" });
    return;
  }

  // Pull all events so far so they show on the audit page (we'll add the
  // "signed" event after rendering so the timestamp matches).
  const priorEvents = await db
    .select()
    .from(agreementEventsTable)
    .where(eq(agreementEventsTable.assignmentId, a.id));
  const auditEvents = priorEvents.map((e) => ({
    kind: e.kind,
    actorType: e.actorType,
    actorEmail: e.actorEmail ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    metadata: (e.metadata ?? {}) as Record<string, unknown>,
    createdAt: e.createdAt,
  }));
  auditEvents.push({
    kind: "signed",
    actorType: "client",
    actorEmail: client.email,
    ip: getRequestIp(req) || null,
    userAgent: getRequestUserAgent(req) || null,
    metadata: {},
    createdAt: now,
  });

  // Best-effort logo fetch — never fail signing because of a missing/bad logo.
  let logoPng: Buffer | null = null;
  if (t.logoObjectKey) {
    try {
      logoPng = await downloadPdf(t.logoObjectKey);
    } catch (err) {
      req.log.warn({ err, templateId: t.id }, "failed to load template logo; rendering without it");
    }
  }

  let signedKey: string;
  try {
    const pdfBuf = await renderBuilderPdf({
      title: t.title,
      bodyMarkdown: t.bodyMarkdown,
      placeholders,
      values: finalValues,
      signatureDataUrl,
      signatureMethod,
      signerName,
      signerEmail: client.email,
      signedAt: now,
      events: auditEvents,
      logoPng,
    });
    signedKey = await uploadPdfBuffer(pdfBuf, String(client.id));
  } catch (err) {
    // Roll back the claim so the user can retry. We only revert if no other
    // process has since promoted the row past client_signed.
    req.log.error({ err, assignmentId: a.id }, "builder pdf render/upload failed; rolling back claim");
    await db
      .update(agreementAssignmentsTable)
      .set({ status: "viewed", clientSignedAt: null, signatureDataUrl: null, signatureMethod: null })
      .where(and(
        eq(agreementAssignmentsTable.id, a.id),
        eq(agreementAssignmentsTable.status, "client_signed"),
      ));
    res.status(500).json({ error: "Failed to generate signed PDF. Please try again." });
    return;
  }

  // Finalize: client_signed → completed with the signed PDF reference.
  const updatedRows = await db
    .update(agreementAssignmentsTable)
    .set({
      status: "completed",
      signedPdfKey: signedKey,
      completedAt: now,
    })
    .where(and(
      eq(agreementAssignmentsTable.id, a.id),
      eq(agreementAssignmentsTable.status, "client_signed"),
    ))
    .returning();
  if (updatedRows.length === 0) {
    // Extremely unlikely (we hold the claim), but bail safely.
    res.status(409).json({ error: "Assignment state changed during signing; refresh and try again" });
    return;
  }
  await db.insert(agreementEventsTable).values({
    assignmentId: a.id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    kind: "signed",
    ip: getRequestIp(req) || null,
    userAgent: getRequestUserAgent(req) || null,
    createdAt: now,
  });
  await recordActivity({
    kind: "agreement_signed_by_client",
    message: `Client signed agreement "${t.title}"`,
    clientId: client.id,
    actor: { type: "client", id: client.id, email: client.email },
    req,
    metadata: { assignmentId: a.id, kind: "builder" },
  });
  void notifyScopedAdmins("agreements", {
    kind: "agreement_signed",
    title: `Agreement signed: ${client.firstName} ${client.lastName}`,
    body: `${client.businessName} signed agreement "${t.title}". Review it in the Agreements tab.`,
    link: `/admin/agreements/assignments/${a.id}`,
  }).catch((err) => req.log.error({ err }, "notifyScopedAdmins(agreement_signed) failed"));
  res.json(shapeAssignment(updatedRows[0], t, client));
}

function mergeValues(
  existing: AgreementFieldValue[],
  incoming: unknown,
  role: "admin" | "client",
  templateFields: AgreementField[],
): AgreementFieldValue[] {
  const fieldsById = new Map(templateFields.map((f) => [f.id, f]));
  const map = new Map<string, AgreementFieldValue>();
  for (const v of existing) map.set(v.fieldId, v);
  const now = new Date().toISOString();
  if (!Array.isArray(incoming)) return Array.from(map.values());
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Partial<AgreementFieldValue>;
    if (typeof v.fieldId !== "string" || !v.fieldId) continue;
    if (typeof v.value !== "string") continue;
    if (v.value.length > 20000) continue;
    const f = fieldsById.get(v.fieldId);
    if (!f) continue;
    if (f.role !== role) continue; // enforce role boundary
    const sigMethod = v.signatureMethod === "drawn" || v.signatureMethod === "typed" ? v.signatureMethod : undefined;
    map.set(v.fieldId, {
      fieldId: v.fieldId,
      type: f.type,
      value: v.value,
      ...(sigMethod ? { signatureMethod: sigMethod } : {}),
      signedAt: now,
    });
  }
  return Array.from(map.values());
}

export default router;
