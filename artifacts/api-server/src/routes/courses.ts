import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import {
  db,
  coursesTable,
  clientCoursesTable,
  clientsTable,
  modulesTable,
} from "@workspace/db";
import { requireAdmin, requireAdminWrite } from "../lib/access";
import { rateLimited, rateLimitKey } from "../lib/rateLimit";
import { logActivity } from "../lib/notifications";
import { openai, aiAvailable } from "../lib/openai";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// AI-assisted course drafting helpers. The AI only ever returns a *draft*
// shape — admins always see and can edit the result before anything is
// written to the database. Manual creation continues to work unchanged.
// ---------------------------------------------------------------------------

interface AiCourseDraft {
  title: string;
  description: string;
  modules: { title: string; description: string }[];
}

function normalizeDraft(input: unknown): AiCourseDraft | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
  const description = typeof o.description === "string" ? o.description.trim().slice(0, 600) : "";
  const modulesRaw = Array.isArray(o.modules) ? (o.modules as unknown[]) : [];
  const modules = modulesRaw
    .map((m) => {
      const mo = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return {
        title: typeof mo.title === "string" ? mo.title.trim().slice(0, 200) : "",
        description: typeof mo.description === "string" ? mo.description.trim().slice(0, 1000) : "",
      };
    })
    .filter((m) => m.title.length > 0);
  if (!title || modules.length === 0) return null;
  return { title, description, modules };
}

const AI_DRAFT_SYSTEM = [
  "You are a curriculum designer for an agency that ships short, focused client courses.",
  "Given source material the admin pastes in (notes, transcripts, doc dumps, brain dumps), design a course outline.",
  "",
  "Return STRICT JSON matching this exact shape — no prose, no markdown, no code fences:",
  "{",
  '  "title": "concise course name (<= 60 chars)",',
  '  "description": "1-2 sentence internal description for the admin",',
  '  "modules": [',
  '    { "title": "module name (<= 80 chars)", "description": "1-3 sentence summary of what this module covers" }',
  "  ]",
  "}",
  "",
  "Rules:",
  "- Produce between 3 and 8 modules unless the admin specifies otherwise.",
  "- Order modules from foundational to advanced.",
  "- Do NOT invent video URLs, episode counts, or lesson IDs.",
  "- Keep wording crisp and operational; no marketing fluff.",
].join("\n");

// POST /admin/courses/ai-draft — draft a course outline from pasted content.
// Returns the structured draft only; nothing is persisted. The UI lets the
// admin edit every field, then calls /ai-create to actually save.
router.post("/admin/courses/ai-draft", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  if (!aiAvailable()) {
    res.status(503).json({ error: "AI integration is not configured on this server" });
    return;
  }
  // 10 AI drafts per admin per 5 minutes — enough for genuine iteration,
  // tight enough to cap runaway OpenAI cost from a stuck client.
  if (rateLimited(res, rateLimitKey(req, "ai-draft", admin.id), 10, 5 * 60_000)) return;
  const b = req.body ?? {};
  const source = typeof b.source === "string" ? b.source.trim() : "";
  const hint = typeof b.hint === "string" ? b.hint.trim().slice(0, 500) : "";
  const moduleCountRaw = Number(b.moduleCount);
  const moduleCount = Number.isFinite(moduleCountRaw)
    ? Math.max(2, Math.min(12, Math.round(moduleCountRaw)))
    : null;
  if (source.length < 20) {
    res.status(400).json({ error: "Provide at least 20 characters of source material to draft from." });
    return;
  }
  // Cap the prompt size so we don't accidentally ship a huge transcript.
  const trimmedSource = source.slice(0, 12000);
  const userPrompt = [
    hint ? `Admin notes / focus: ${hint}` : "",
    moduleCount ? `Aim for exactly ${moduleCount} modules.` : "",
    "Source material:",
    trimmedSource,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AI_DRAFT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ error: "AI returned invalid JSON. Try again or rephrase the source." });
      return;
    }
    const draft = normalizeDraft(parsed);
    if (!draft) {
      res.status(502).json({ error: "AI returned an unusable course shape. Try again or add more detail." });
      return;
    }
    res.json(draft);
  } catch (err) {
    req.log?.error?.(err, "ai-draft failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "AI request failed", message });
  }
});

// POST /admin/courses/ai-create — persist a (possibly admin-edited) draft as
// a new course plus its modules. One transaction so we never end up with a
// half-built course on partial failure.
router.post("/admin/courses/ai-create", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  if (rateLimited(res, rateLimitKey(req, "ai-create", admin.id), 20, 5 * 60_000)) return;
  const draft = normalizeDraft(req.body);
  if (!draft) {
    res.status(400).json({ error: "Provide a title and at least one module." });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [maxCourse] = await tx
      .select({ p: sql<number>`coalesce(max(${coursesTable.position}), 0)::int` })
      .from(coursesTable);
    const coursePosition = (Number(maxCourse?.p) || 0) + 1;
    const [course] = await tx
      .insert(coursesTable)
      .values({
        title: draft.title,
        description: draft.description,
        position: coursePosition,
        archived: false,
      })
      .returning();
    const [maxModule] = await tx
      .select({ p: sql<number>`coalesce(max(${modulesTable.position}), 0)::int` })
      .from(modulesTable);
    const startPos = (Number(maxModule?.p) || 0) + 1;
    await tx.insert(modulesTable).values(
      draft.modules.map((m, idx) => ({
        title: m.title,
        description: m.description,
        position: startPos + idx,
        published: true,
        courseId: course.id,
      })),
    );
    return course;
  });
  await logActivity(
    "admin.course.ai_created",
    `Course "${draft.title}" created via AI by admin #${admin.id} with ${draft.modules.length} module(s)`,
  );
  res.json(shapeCourse(created, draft.modules.length, 0));
});

function shapeCourse(c: typeof coursesTable.$inferSelect, moduleCount: number, clientCount: number) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    position: c.position,
    archived: c.archived,
    moduleCount,
    clientCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// GET /admin/courses — list all courses with module + client counts.
router.get("/admin/courses", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const rows = await db.select().from(coursesTable).orderBy(asc(coursesTable.position), asc(coursesTable.id));
  const moduleCounts = await db
    .select({ courseId: modulesTable.courseId, n: sql<number>`count(*)::int` })
    .from(modulesTable)
    .groupBy(modulesTable.courseId);
  const clientCounts = await db
    .select({ courseId: clientCoursesTable.courseId, n: sql<number>`count(*)::int` })
    .from(clientCoursesTable)
    .groupBy(clientCoursesTable.courseId);
  const mMap = new Map(moduleCounts.map((r) => [r.courseId, Number(r.n)]));
  const cMap = new Map(clientCounts.map((r) => [r.courseId, Number(r.n)]));
  res.json(rows.map((c) => shapeCourse(c, mMap.get(c.id) ?? 0, cMap.get(c.id) ?? 0)));
});

// POST /admin/courses
router.post("/admin/courses", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const b = req.body ?? {};
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "Title required" });
    return;
  }
  const description = typeof b.description === "string" ? b.description : "";
  const maxRow = await db.select({ p: sql<number>`coalesce(max(${coursesTable.position}), 0)::int` }).from(coursesTable);
  const position = (Number(maxRow[0]?.p) || 0) + 1;
  const [c] = await db
    .insert(coursesTable)
    .values({ title, description, position, archived: false })
    .returning();
  await logActivity("admin.course.created", `Course "${title}" created by admin #${admin.id}`);
  res.json(shapeCourse(c, 0, 0));
});

// PATCH /admin/courses/:id
router.patch("/admin/courses/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof b.title === "string") patch.title = b.title.trim();
  if (typeof b.description === "string") patch.description = b.description;
  if (typeof b.archived === "boolean") patch.archived = b.archived;
  if (typeof b.position === "number") patch.position = b.position;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No changes" });
    return;
  }
  const [c] = await db.update(coursesTable).set(patch).where(eq(coursesTable.id, id)).returning();
  if (!c) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(shapeCourse(c, 0, 0));
});

// DELETE /admin/courses/:id
// - Default behaviour: refuse with 409 if the course has any modules or
//   client assignments attached, so an accidental click can't nuke content.
// - With `?cascade=1`: hard-delete the course AND every module/episode/
//   progress/file/client-assignment that hangs off it. The admin UI uses
//   this after an explicit "yes, delete everything" confirmation.
router.delete("/admin/courses/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  const cascade = req.query.cascade === "1" || req.query.cascade === "true";

  const [{ n: modN }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(modulesTable)
    .where(eq(modulesTable.courseId, id));
  const [{ n: cliN }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(clientCoursesTable)
    .where(eq(clientCoursesTable.courseId, id));

  if (!cascade && (Number(modN) > 0 || Number(cliN) > 0)) {
    res.status(409).json({
      error: "Course is not empty",
      message: `Course has ${modN} module(s) and ${cliN} client assignment(s). Pass ?cascade=1 to delete everything.`,
      moduleCount: Number(modN),
      clientCount: Number(cliN),
    });
    return;
  }

  // Wrap in a transaction so a partial failure leaves the DB untouched.
  // Deleting modules cascades to episodes → progress / files. Deleting the
  // course cascades to client_courses. Modules have a nullable courseId so
  // there's no FK cascade from course → modules; we delete them explicitly.
  await db.transaction(async (tx) => {
    if (cascade) {
      await tx.delete(modulesTable).where(eq(modulesTable.courseId, id));
    }
    await tx.delete(coursesTable).where(eq(coursesTable.id, id));
  });

  await logActivity(
    cascade ? "admin.course.deleted_cascade" : "admin.course.deleted",
    `Course #${id} deleted by admin #${admin.id}${cascade ? ` (cascade: ${modN} module(s), ${cliN} client(s))` : ""}`,
  );
  res.sendStatus(204);
});

// PATCH /admin/modules/:id/course — set or clear a module's course.
router.patch("/admin/modules/:id/course", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  const b = req.body ?? {};
  const courseId: number | null = b.courseId === null ? null : Number(b.courseId);
  if (courseId !== null && !Number.isFinite(courseId)) {
    res.status(400).json({ error: "Bad courseId" });
    return;
  }
  if (courseId !== null) {
    const [exists] = await db.select({ id: coursesTable.id }).from(coursesTable).where(eq(coursesTable.id, courseId));
    if (!exists) {
      res.status(400).json({ error: "Course does not exist" });
      return;
    }
  }
  const [m] = await db.update(modulesTable).set({ courseId }).where(eq(modulesTable.id, id)).returning();
  if (!m) {
    res.status(404).json({ error: "Module not found" });
    return;
  }
  res.json({ id: m.id, courseId: m.courseId });
});

// GET /admin/clients/:id/courses — list this client's assigned courses + every available course.
router.get("/admin/clients/:id/courses", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const clientId = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(clientId)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  const [client] = await db.select({ id: clientsTable.id }).from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const all = await db.select().from(coursesTable).orderBy(asc(coursesTable.position), asc(coursesTable.id));
  const assigned = await db
    .select({ courseId: clientCoursesTable.courseId, assignedAt: clientCoursesTable.assignedAt })
    .from(clientCoursesTable)
    .where(eq(clientCoursesTable.clientId, clientId));
  const assignedMap = new Map(assigned.map((a) => [a.courseId, a.assignedAt]));
  res.json(
    all.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      archived: c.archived,
      assigned: assignedMap.has(c.id),
      assignedAt: assignedMap.get(c.id)?.toISOString() ?? null,
    })),
  );
});

// PUT /admin/clients/:id/courses — replace assignment set (set semantic).
// Body: { courseIds: number[] }
router.put("/admin/clients/:id/courses", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const clientId = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(clientId)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const raw: unknown[] = Array.isArray(req.body?.courseIds) ? req.body.courseIds : [];
  const courseIds: number[] = Array.from(
    new Set(raw.map((n) => Number(n)).filter((n): n is number => Number.isFinite(n))),
  );

  // Validate every requested course exists.
  if (courseIds.length > 0) {
    const found = await db
      .select({ id: coursesTable.id })
      .from(coursesTable)
      .where(inArray(coursesTable.id, courseIds));
    if (found.length !== courseIds.length) {
      res.status(400).json({ error: "One or more courses do not exist" });
      return;
    }
  }

  const existing = await db
    .select({ courseId: clientCoursesTable.courseId })
    .from(clientCoursesTable)
    .where(eq(clientCoursesTable.clientId, clientId));
  const have = new Set(existing.map((e) => e.courseId));
  const want = new Set(courseIds);
  const toAdd = courseIds.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));

  // Wrap insert+delete in a single transaction so concurrent admin edits
  // can't interleave and leave the client in a torn state.
  await db.transaction(async (tx) => {
    if (toAdd.length > 0) {
      await tx
        .insert(clientCoursesTable)
        .values(toAdd.map((courseId) => ({ clientId, courseId, assignedByAdminId: admin.id })))
        .onConflictDoNothing();
    }
    if (toRemove.length > 0) {
      await tx
        .delete(clientCoursesTable)
        .where(and(eq(clientCoursesTable.clientId, clientId), inArray(clientCoursesTable.courseId, toRemove)));
    }
  });
  await logActivity(
    "admin.client.courses_updated",
    `Courses updated by admin #${admin.id} (+${toAdd.length} / -${toRemove.length})`,
    clientId,
  );
  res.json({ ok: true, added: toAdd.length, removed: toRemove.length, total: courseIds.length });
});

export default router;
