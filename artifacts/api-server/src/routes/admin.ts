import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql, desc, asc, gte, lte, ilike, or, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  modulesTable,
  episodesTable,
  episodeProgressTable,
  icpResponsesTable,
  activityEventsTable,
  settingsTable,
  adminUsersTable,
  clientNotesTable,
  agreementAssignmentsTable,
  supportTicketsTable,
  supportTicketMessagesTable,
  supportAttachmentsTable,
  supportTicketRatingsTable,
  notificationsTable,
  type ChecklistItem,
} from "@workspace/db";
import { requireAdmin, requireAdminWrite, resolveRole, requireAdminScope } from "../lib/access";
import { ensureSprintHubCurriculumV2026 } from "../lib/seedCurriculum";
import { currentSession, setImpersonateClientId } from "../lib/auth";
import {
  logActivity,
  getOrCreateSettings,
  notify,
  createNotification,
  unreadCount,
} from "../lib/notifications";
import { BRAND_NAME, BRAND_APP_NAME } from "../lib/brand";
import { loadTicketDetail, sanitizeAttachments, computeTicketSlas, avg, median } from "../lib/support";
import { computeClientHealth, loadAllClientHealth } from "../lib/clientHealth";
import crypto from "crypto";

const router: IRouter = Router();

// Drizzle predicate that excludes admin housekeeping noise from the
// activity feed: admin logins, impersonation start/stop, etc. We DO keep
// rows where an admin is actively assisting on a support thread, so
// support-team members still show up in the feed.
//
// The filter is "anyone except admins, OR admins doing support work".
// Pre-2025 events have actor_type=NULL, which we treat as system events
// (welcome invite, ICP submitted, etc.) and keep visible.
const CLIENT_FACING_ACTIVITY = sql`(
  ${activityEventsTable.actorType} IS NULL
  OR ${activityEventsTable.actorType} <> 'admin'
  OR ${activityEventsTable.kind} ILIKE 'support%'
)`;

router.get("/admin/dashboard", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const allClients = await db.select().from(clientsTable);
  const totalClients = allClients.length;
  const notLoggedInCount = allClients.filter((c) => !c.lastLoginAt).length;

  const icpRows = await db.select().from(icpResponsesTable).where(eq(icpResponsesTable.submitted, true));
  const icpSubmittedCount = icpRows.length;

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const sprintsThisWeek = allClients.filter((c) => {
    if (!c.sprintStartDate) return false;
    const d = new Date(c.sprintStartDate);
    return d >= weekStart && d < weekEnd;
  }).length;

  // Recent activity preview: filtered to client-facing rows only and
  // capped at 5 — the dashboard tile shows these and links to the full
  // paginated feed at /admin/activity for "see more".
  const recent = await db
    .select()
    .from(activityEventsTable)
    .where(CLIENT_FACING_ACTIVITY)
    .orderBy(desc(activityEventsTable.createdAt))
    .limit(5);

  // 30-day growth matrix. We bucket by date (UTC) and count four
  // client-side signals so the dashboard chart can show momentum at a
  // glance without a separate analytics pipeline. The kinds map to:
  //   newClients       — `client_invited`
  //   icpSubmissions   — `icp_submitted`
  //   episodesCompleted— `episode_complete`
  //   clientLogins     — `login` rows where the actor is a client
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 29);
  const growthRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${activityEventsTable.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`,
      kind: activityEventsTable.kind,
      actorType: activityEventsTable.actorType,
      n: sql<number>`count(*)::int`,
    })
    .from(activityEventsTable)
    .where(
      and(
        gte(activityEventsTable.createdAt, since),
        sql`${activityEventsTable.kind} IN ('client_invited','icp_submitted','episode_complete','login')`,
      ),
    )
    .groupBy(sql`1`, activityEventsTable.kind, activityEventsTable.actorType);

  const series: Record<string, { date: string; newClients: number; icpSubmissions: number; episodesCompleted: number; clientLogins: number }> = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    series[key] = { date: key, newClients: 0, icpSubmissions: 0, episodesCompleted: 0, clientLogins: 0 };
  }
  for (const r of growthRows) {
    const bucket = series[r.day];
    if (!bucket) continue;
    if (r.kind === "client_invited") bucket.newClients += Number(r.n);
    else if (r.kind === "icp_submitted") bucket.icpSubmissions += Number(r.n);
    else if (r.kind === "episode_complete") bucket.episodesCompleted += Number(r.n);
    else if (r.kind === "login" && r.actorType === "client") bucket.clientLogins += Number(r.n);
  }
  const growthSeries = Object.values(series).sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    totalClients,
    icpSubmittedCount,
    notLoggedInCount,
    sprintsThisWeek,
    recentActivity: recent.map((e) => ({
      id: e.id,
      kind: e.kind,
      message: e.message,
      clientId: e.clientId ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    growthSeries,
  });
});

// Paginated client-side activity feed used by the dedicated "Activity"
// page (the dashboard's See more link). Same client-facing filter as
// the dashboard preview so the two views stay consistent.
router.get("/admin/activity", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;
  const where = cursor && Number.isFinite(cursor)
    ? and(CLIENT_FACING_ACTIVITY, sql`${activityEventsTable.id} < ${cursor}`)
    : CLIENT_FACING_ACTIVITY;
  const rows = await db
    .select()
    .from(activityEventsTable)
    .where(where)
    .orderBy(desc(activityEventsTable.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((e) => ({
    id: e.id,
    kind: e.kind,
    message: e.message,
    clientId: e.clientId ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
  res.json({ items, nextCursor: hasMore ? items[items.length - 1].id : null });
});

const SPRINT_LENGTH_DAYS = 22;

// All possible lifecycle stages, computed from agreement / module / ICP
// progress + admin-driven sprint start + admin-driven post-sprint status.
type ClientStage =
  | "agreement_pending"
  | "modules_in_progress"
  | "icp_pending"
  | "awaiting_review"
  | "sprint_active"
  | "sprint_complete"
  | "monthly"
  | "offboarded"
  | "paused";

function computeStage(input: {
  agreementSigned: boolean;
  episodesComplete: boolean;
  icpSubmitted: boolean;
  sprintStartedAt: Date | null;
  postSprintStatus: string | null;
  sprintComplete: boolean;
}): ClientStage {
  if (input.postSprintStatus === "monthly") return "monthly";
  if (input.postSprintStatus === "offboarded") return "offboarded";
  if (input.postSprintStatus === "paused") return "paused";
  if (input.sprintStartedAt && input.sprintComplete) return "sprint_complete";
  if (input.sprintStartedAt) return "sprint_active";
  if (input.agreementSigned && input.episodesComplete && input.icpSubmitted) return "awaiting_review";
  if (input.agreementSigned && input.episodesComplete && !input.icpSubmitted) return "icp_pending";
  if (input.agreementSigned) return "modules_in_progress";
  return "agreement_pending";
}

// Pre-batched lookups so list endpoints can avoid the N+1 fan-out below.
// When shaping a single client (detail view) we just call the batch helper
// with that one row, so cost stays equivalent.
interface AdminClientShapeCtx {
  eps: Array<{ id: number; moduleId: number }>;
  progressByClient: Map<number, Array<{ episodeId: number }>>;
  icpByClient: Map<number, { submitted: boolean | null }>;
  assignmentsByClient: Map<number, Array<{ status: string; clientSignedAt: Date | null; completedAt: Date | null }>>;
}

async function buildAdminClientCtx(clientIds: number[]): Promise<AdminClientShapeCtx> {
  const eps = await db
    .select({ id: episodesTable.id, moduleId: episodesTable.moduleId })
    .from(episodesTable)
    .where(eq(episodesTable.published, true));
  const progressByClient = new Map<number, Array<{ episodeId: number }>>();
  const icpByClient = new Map<number, { submitted: boolean | null }>();
  const assignmentsByClient = new Map<
    number,
    Array<{ status: string; clientSignedAt: Date | null; completedAt: Date | null }>
  >();
  if (clientIds.length === 0) {
    return { eps, progressByClient, icpByClient, assignmentsByClient };
  }
  // Three batched queries instead of 3*N: scales linearly with the client
  // count even when there are hundreds of clients on the dashboard.
  const [progressRows, icpRows, assignmentRows] = await Promise.all([
    db
      .select({ clientId: episodeProgressTable.clientId, episodeId: episodeProgressTable.episodeId })
      .from(episodeProgressTable)
      .where(and(inArray(episodeProgressTable.clientId, clientIds), sql`${episodeProgressTable.completedAt} IS NOT NULL`)),
    db
      .select({ clientId: icpResponsesTable.clientId, submitted: icpResponsesTable.submitted })
      .from(icpResponsesTable)
      .where(inArray(icpResponsesTable.clientId, clientIds)),
    db
      .select({
        clientId: agreementAssignmentsTable.clientId,
        status: agreementAssignmentsTable.status,
        clientSignedAt: agreementAssignmentsTable.clientSignedAt,
        completedAt: agreementAssignmentsTable.completedAt,
      })
      .from(agreementAssignmentsTable)
      .where(inArray(agreementAssignmentsTable.clientId, clientIds)),
  ]);
  for (const r of progressRows) {
    if (!progressByClient.has(r.clientId)) progressByClient.set(r.clientId, []);
    progressByClient.get(r.clientId)!.push({ episodeId: r.episodeId });
  }
  for (const r of icpRows) icpByClient.set(r.clientId, { submitted: r.submitted });
  for (const r of assignmentRows) {
    if (!assignmentsByClient.has(r.clientId)) assignmentsByClient.set(r.clientId, []);
    assignmentsByClient.get(r.clientId)!.push({
      status: r.status,
      clientSignedAt: r.clientSignedAt,
      completedAt: r.completedAt,
    });
  }
  return { eps, progressByClient, icpByClient, assignmentsByClient };
}

function shapeAdminClientFromCtx(
  c: typeof clientsTable.$inferSelect,
  ctx: AdminClientShapeCtx,
  extras: { inviteEmailWarning?: string | null } = {},
) {
  const eps = ctx.eps;
  const totalEpisodes = eps.length;
  const totalModules = new Set(eps.map((e) => e.moduleId)).size;
  const progress = ctx.progressByClient.get(c.id) ?? [];
  const completedEpisodes = progress.length;
  const epsByMod = new Map<number, number[]>();
  for (const e of eps) {
    if (!epsByMod.has(e.moduleId)) epsByMod.set(e.moduleId, []);
    epsByMod.get(e.moduleId)!.push(e.id);
  }
  const completedSet = new Set(progress.map((p) => p.episodeId));
  let modulesComplete = 0;
  for (const [, ids] of epsByMod) {
    if (ids.length > 0 && ids.every((id) => completedSet.has(id))) modulesComplete++;
  }
  const episodesComplete = totalEpisodes > 0 && completedEpisodes === totalEpisodes;

  const icpSubmitted = !!ctx.icpByClient.get(c.id)?.submitted;

  const assignments = ctx.assignmentsByClient.get(c.id) ?? [];
  const agreementSigned = assignments.some(
    (a) => !!a.clientSignedAt || !!a.completedAt || a.status === "signed" || a.status === "completed",
  );

  let sprintComplete = false;
  if (c.sprintStartedAt) {
    const elapsedDays = Math.floor((Date.now() - c.sprintStartedAt.getTime()) / 86400000);
    sprintComplete = elapsedDays >= SPRINT_LENGTH_DAYS;
  }

  const stage = computeStage({
    agreementSigned,
    episodesComplete,
    icpSubmitted,
    sprintStartedAt: c.sprintStartedAt ?? null,
    postSprintStatus: c.postSprintStatus ?? null,
    sprintComplete,
  });

  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    businessName: c.businessName,
    phone: c.phone ?? null,
    sprintStartDate: c.sprintStartDate ?? null,
    inviteSentAt: c.inviteSentAt?.toISOString() ?? null,
    lastLoginAt: c.lastLoginAt?.toISOString() ?? null,
    status: c.status,
    modulesComplete,
    totalModules,
    icpSubmitted,
    agreementSigned,
    episodesComplete,
    sprintStartedAt: c.sprintStartedAt?.toISOString() ?? null,
    sprintComplete,
    postSprintStatus: c.postSprintStatus ?? null,
    stage,
    inviteEmailWarning: extras.inviteEmailWarning ?? null,
  };
}

// Back-compat wrapper for single-client callers (detail view, create, update,
// resend-invite, revoke, notes update). Builds a one-client ctx so the cost
// matches the old per-client query shape; list endpoints should call
// buildAdminClientCtx + shapeAdminClientFromCtx directly to amortise.
async function shapeAdminClient(
  c: typeof clientsTable.$inferSelect,
  extras: { inviteEmailWarning?: string | null } = {},
) {
  const ctx = await buildAdminClientCtx([c.id]);
  return shapeAdminClientFromCtx(c, ctx, extras);
}

router.get("/admin/clients", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const { status, search } = req.query as { status?: string; search?: string };
  const conditions: ReturnType<typeof eq>[] = [];
  if (status) conditions.push(eq(clientsTable.status, status));
  if (search) {
    const s = `%${search}%`;
    conditions.push(or(ilike(clientsTable.firstName, s), ilike(clientsTable.lastName, s), ilike(clientsTable.email, s), ilike(clientsTable.businessName, s))!);
  }
  const rows = await (conditions.length > 0
    ? db.select().from(clientsTable).where(and(...conditions)).orderBy(desc(clientsTable.createdAt))
    : db.select().from(clientsTable).orderBy(desc(clientsTable.createdAt)));
  // Batched ctx: 4 queries total regardless of client count, instead of
  // 4 * N when this used to call shapeAdminClient per row.
  const ctx = await buildAdminClientCtx(rows.map((c) => c.id));
  const out = rows.map((c) => shapeAdminClientFromCtx(c, ctx));
  res.json(out);
});

async function createClientCore(body: {
  first_name: string;
  last_name: string;
  email: string;
  business_name: string;
  phone?: string;
  sprint_start_date?: string;
}) {
  const inviteToken = crypto.randomBytes(24).toString("hex");
  const [created] = await db
    .insert(clientsTable)
    .values({
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email.toLowerCase(),
      businessName: body.business_name,
      phone: body.phone ?? null,
      sprintStartDate: body.sprint_start_date ?? null,
      status: "invited",
      inviteSentAt: new Date(),
      inviteToken,
    })
    .onConflictDoUpdate({
      target: clientsTable.email,
      set: {
        firstName: body.first_name,
        lastName: body.last_name,
        businessName: body.business_name,
        phone: body.phone ?? null,
        sprintStartDate: body.sprint_start_date ?? null,
        inviteSentAt: new Date(),
      },
    })
    .returning();
  const emailResult = await notify(
    body.email,
    `Welcome to the ${BRAND_NAME} Sprint`,
    `Hi ${body.first_name},\n\nWelcome to the ${BRAND_APP_NAME}. Sign in here to start: ${process.env.REPLIT_DOMAINS?.split(",")[0] ?? "your portal"}\n\n— ${BRAND_NAME}`,
  );
  await logActivity("client_invited", `${body.first_name} ${body.last_name} (${body.business_name}) was invited`, created.id);
  return { created, emailResult };
}

router.post("/admin/clients", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const b = req.body ?? {};
  if (!b.first_name || !b.last_name || !b.email || !b.business_name) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const { created, emailResult } = await createClientCore(b);
  res.json(
    await shapeAdminClient(created, {
      inviteEmailWarning: emailResult.ok ? null : emailResult.error ?? "Welcome email could not be sent",
    }),
  );
});

// =============== CLIENT INTELLIGENCE ===============
// IMPORTANT: these must be registered BEFORE the catch-all /admin/clients/:id
// route below — otherwise Express matches "/admin/clients/health" against
// :id="health" and parseInt fails.

// Roster-wide health summary for the dashboard. Buckets clients by tone
// and surfaces the worst-scoring few inline.
router.get("/admin/clients/health", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const rows = await loadAllClientHealth();
  const counts = { green: 0, amber: 0, red: 0 };
  for (const r of rows) counts[r.tone]++;
  res.json({
    ...counts,
    total: rows.length,
    attention: rows.filter((r) => r.tone !== "green").slice(0, 10),
    rows,
  });
});

// Per-client deep dive used by the client detail page. Returns the
// score, signal breakdown, flags/positives, and the AI-generated
// narrative. Pass ?refresh=1 to bypass the 6h narrative cache.
router.get("/admin/clients/:id/health", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id) { res.status(400).json({ error: "Bad id" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) { res.status(404).json({ error: "Not found" }); return; }
  const force = req.query.refresh === "1" || req.query.refresh === "true";
  const health = await computeClientHealth(client, { withNarrative: true, forceRefresh: force });
  res.json(health);
});

router.get("/admin/clients/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!c) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const client = await shapeAdminClient(c);

  const mods = await db.select().from(modulesTable).orderBy(asc(modulesTable.position));
  const eps = await db.select().from(episodesTable).orderBy(asc(episodesTable.position));
  const progress = await db.select().from(episodeProgressTable).where(eq(episodeProgressTable.clientId, c.id));
  const progByEp = new Map(progress.map((p) => [p.episodeId, p]));
  const modules = mods.map((m) => {
    const moduleEps = eps.filter((e) => e.moduleId === m.id);
    let prevDone = true;
    const shaped = moduleEps.map((e) => {
      const p = progByEp.get(e.id);
      const locked = e.requirePrevious ? !prevDone : false;
      prevDone = !!p?.completedAt;
      return {
        id: e.id,
        moduleId: e.moduleId,
        title: e.title,
        videoUrl: e.videoUrl ?? null,
        copy: e.copy,
        position: e.position,
        locked,
        completed: !!p?.completedAt,
        completedAt: p?.completedAt?.toISOString() ?? null,
        checklistItems: e.checklistItems ?? [],
        checklistChecked: p?.checklistChecked ?? [],
        checklistResponses: p?.checklistResponses ?? {},
        kind: e.kind,
      };
    });
    const done = shaped.filter((e) => e.completed).length;
    const status: "locked" | "in_progress" | "complete" =
      shaped.length > 0 && done === shaped.length ? "complete" : done > 0 ? "in_progress" : "locked";
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      position: m.position,
      status,
      episodes: shaped,
    };
  });

  const [icp] = await db.select().from(icpResponsesTable).where(eq(icpResponsesTable.clientId, c.id));
  const notes = await db.select().from(clientNotesTable).where(eq(clientNotesTable.clientId, c.id)).orderBy(desc(clientNotesTable.createdAt));

  res.json({
    client,
    modules,
    icp: {
      answers: icp?.answers ?? {},
      submitted: !!icp?.submitted,
      submittedAt: icp?.submittedAt?.toISOString() ?? null,
      savedAt: icp?.savedAt?.toISOString() ?? null,
    },
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      authorName: n.authorName,
    })),
  });
});

router.patch("/admin/clients/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (b.firstName !== undefined) patch.firstName = b.firstName;
  if (b.lastName !== undefined) patch.lastName = b.lastName;
  if (b.businessName !== undefined) patch.businessName = b.businessName;
  if (b.phone !== undefined) patch.phone = b.phone;
  if (b.sprintStartDate !== undefined) patch.sprintStartDate = b.sprintStartDate;
  if (b.status !== undefined) patch.status = b.status;
  if (b.postSprintStatus !== undefined) {
    const v = b.postSprintStatus;
    if (v !== null && !["monthly", "offboarded", "paused"].includes(v)) {
      res.status(400).json({ error: "postSprintStatus must be one of: monthly, offboarded, paused, null" });
      return;
    }
    patch.postSprintStatus = v;
  }
  const [updated] = await db.update(clientsTable).set(patch).where(eq(clientsTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(await shapeAdminClient(updated));
});

router.delete("/admin/clients/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  await db.delete(clientsTable).where(eq(clientsTable.id, id));
  res.sendStatus(204);
});

router.post("/admin/clients/:id/start-sprint", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const shaped = await shapeAdminClient(c);
  if (!shaped.agreementSigned || !shaped.episodesComplete || !shaped.icpSubmitted) {
    res.status(400).json({
      error: "Client has not met prerequisites yet",
      prerequisites: {
        agreementSigned: shaped.agreementSigned,
        episodesComplete: shaped.episodesComplete,
        icpSubmitted: shaped.icpSubmitted,
      },
    });
    return;
  }
  if (c.sprintStartedAt) {
    res.status(400).json({ error: "Sprint has already been started" });
    return;
  }
  const [updated] = await db
    .update(clientsTable)
    .set({ sprintStartedAt: new Date() })
    .where(eq(clientsTable.id, id))
    .returning();
  await logActivity("sprint_started", `${c.firstName} ${c.lastName} — 22-day sprint started by ${admin.email ?? "admin"}`, c.id);
  res.json(await shapeAdminClient(updated));
});

router.post("/admin/clients/:id/resend-invite", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  // Look up first; only stamp inviteSentAt after a successful send so we
  // don't lie about delivery state when Resend rejects the message.
  const [existing] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const emailResult = await notify(
    existing.email,
    `Reminder: your ${BRAND_APP_NAME}`,
    `Hi ${existing.firstName}, just a reminder to log into your portal.`,
  );
  if (!emailResult.ok) {
    // Surface the real failure to the operator instead of silently 200-ing.
    res.status(502).json({
      error: `Could not send reminder email: ${emailResult.error ?? "unknown error"}`,
    });
    return;
  }
  const [c] = await db
    .update(clientsTable)
    .set({ inviteSentAt: new Date() })
    .where(eq(clientsTable.id, id))
    .returning();
  await logActivity("client_reminded", `Reminder sent to ${c.firstName} ${c.lastName}`, c.id);
  res.json(await shapeAdminClient(c));
});

router.post("/admin/clients/:id/revoke", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [c] = await db.update(clientsTable).set({ status: "revoked" }).where(eq(clientsTable.id, id)).returning();
  if (!c) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await logActivity("client_revoked", `${c.firstName} ${c.lastName} access revoked`, c.id);
  res.json(await shapeAdminClient(c));
});

router.get("/admin/clients/:id/notes", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const notes = await db.select().from(clientNotesTable).where(eq(clientNotesTable.clientId, id)).orderBy(desc(clientNotesTable.createdAt));
  res.json(
    notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      authorName: n.authorName,
    })),
  );
});

router.post("/admin/clients/:id/notes", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const body = String(req.body?.body ?? "").trim();
  if (!body) {
    res.status(400).json({ error: "Body required" });
    return;
  }
  const [n] = await db
    .insert(clientNotesTable)
    .values({ clientId: id, body, authorName: admin.name ?? admin.email })
    .returning();
  res.json({
    id: n.id,
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    authorName: n.authorName,
  });
});

// CSV / PDF exports
router.get("/admin/clients/:id/icp.csv", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [icp] = await db.select().from(icpResponsesTable).where(eq(icpResponsesTable.clientId, id));
  const answers = icp?.answers ?? {};
  const rows: string[] = ["Question,Answer"];
  for (const [k, v] of Object.entries(answers)) {
    const safe = String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ");
    rows.push(`"${k}","${safe}"`);
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="icp-client-${id}.csv"`);
  res.send(rows.join("\n"));
});

router.get("/admin/clients/:id/icp.pdf", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  const [icp] = await db.select().from(icpResponsesTable).where(eq(icpResponsesTable.clientId, id));
  const answers = icp?.answers ?? {};
  // Minimal PDF using printable text. Use HTML attachment that prints clean — most browsers preview.
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>ICP — ${c?.businessName ?? "Client"}</title>
<style>body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#0F172A;max-width:780px;margin:40px auto;padding:0 24px}
h1{color:#0F172A;border-bottom:3px solid #E8600A;padding-bottom:12px}h3{color:#0F172A;margin-top:24px}
.q{font-weight:600;margin-bottom:4px}.a{white-space:pre-wrap;color:#475569;margin-bottom:18px}</style></head>
<body><h1>ICP Questionnaire</h1>
<p><strong>${c?.firstName ?? ""} ${c?.lastName ?? ""}</strong> — ${c?.businessName ?? ""}<br>
${c?.email ?? ""}<br>Submitted: ${icp?.submittedAt?.toISOString() ?? "—"}</p>
${Object.entries(answers)
  .map(([k, v]) => `<div class="q">${k}</div><div class="a">${String(v ?? "").replace(/</g, "&lt;")}</div>`)
  .join("")}
</body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="icp-client-${id}.html"`);
  res.send(html);
});

// One-shot: re-apply the canonical Sprint Hub curriculum (v2026 copy).
// Idempotent — if it has already been applied, it returns { applied: false }.
// Pass ?force=1 to re-apply on top of the existing data (does not overwrite
// the ICP episode).
router.post("/admin/curriculum/seed-sprint-hub", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const force = req.query.force === "1" || req.query.force === "true";
  try {
    const result = await ensureSprintHubCurriculumV2026({ force });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "manual curriculum seed failed");
    res.status(500).json({ error: "seed failed" });
  }
});

// Modules
router.get("/admin/modules", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const mods = await db.select().from(modulesTable).orderBy(asc(modulesTable.position));
  const eps = await db.select().from(episodesTable).orderBy(asc(episodesTable.position));
  res.json(
    mods.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      position: m.position,
      published: m.published,
      courseId: m.courseId ?? null,
      episodes: eps
        .filter((e) => e.moduleId === m.id)
        .map((e) => ({
          id: e.id,
          moduleId: e.moduleId,
          title: e.title,
          videoUrl: e.videoUrl ?? null,
          copy: e.copy,
          position: e.position,
          published: e.published,
          requirePrevious: e.requirePrevious,
          kind: e.kind,
          checklistItems: e.checklistItems ?? [],
        })),
    })),
  );
});

router.post("/admin/modules", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const b = req.body ?? {};
  if (!b.title) {
    res.status(400).json({ error: "Title required" });
    return;
  }
  const maxRow = await db.select({ p: sql<number>`coalesce(max(${modulesTable.position}), 0)` }).from(modulesTable);
  const position = b.position ?? (maxRow[0]?.p ?? 0) + 1;
  const [m] = await db
    .insert(modulesTable)
    .values({
      title: b.title,
      description: b.description ?? "",
      published: b.published ?? true,
      position,
    })
    .returning();
  res.json({ id: m.id, title: m.title, description: m.description, position: m.position, published: m.published, courseId: m.courseId ?? null, episodes: [] });
});

router.patch("/admin/modules/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) patch.title = b.title;
  if (b.description !== undefined) patch.description = b.description;
  if (b.published !== undefined) patch.published = b.published;
  if (b.position !== undefined) patch.position = b.position;
  const [m] = await db.update(modulesTable).set(patch).where(eq(modulesTable.id, id)).returning();
  if (!m) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const eps = await db.select().from(episodesTable).where(eq(episodesTable.moduleId, id)).orderBy(asc(episodesTable.position));
  res.json({
    id: m.id,
    title: m.title,
    description: m.description,
    position: m.position,
    published: m.published,
    courseId: m.courseId ?? null,
    episodes: eps.map((e) => ({
      id: e.id,
      moduleId: e.moduleId,
      title: e.title,
      videoUrl: e.videoUrl ?? null,
      copy: e.copy,
      position: e.position,
      published: e.published,
      requirePrevious: e.requirePrevious,
      kind: e.kind,
      checklistItems: e.checklistItems ?? [],
    })),
  });
});

router.delete("/admin/modules/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  await db.delete(modulesTable).where(eq(modulesTable.id, id));
  res.sendStatus(204);
});

router.post("/admin/modules/:id/episodes", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const moduleId = parseInt(String(req.params.id), 10);
  const b = req.body ?? {};
  if (!b.title) {
    res.status(400).json({ error: "Title required" });
    return;
  }
  const maxRow = await db
    .select({ p: sql<number>`coalesce(max(${episodesTable.position}), 0)` })
    .from(episodesTable)
    .where(eq(episodesTable.moduleId, moduleId));
  const position = b.position ?? (maxRow[0]?.p ?? 0) + 1;
  const [e] = await db
    .insert(episodesTable)
    .values({
      moduleId,
      title: b.title,
      videoUrl: b.videoUrl ?? null,
      copy: b.copy ?? "",
      position,
      published: b.published ?? true,
      requirePrevious: b.requirePrevious ?? true,
      kind: b.kind ?? "standard",
      checklistItems: (b.checklistItems ?? []) as ChecklistItem[],
    })
    .returning();
  res.json({
    id: e.id,
    moduleId: e.moduleId,
    title: e.title,
    videoUrl: e.videoUrl ?? null,
    copy: e.copy,
    position: e.position,
    published: e.published,
    requirePrevious: e.requirePrevious,
    kind: e.kind,
    checklistItems: e.checklistItems ?? [],
  });
});

router.patch("/admin/episodes/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) patch.title = b.title ?? "";
  if (b.videoUrl !== undefined) patch.videoUrl = b.videoUrl;
  if (b.copy !== undefined) patch.copy = b.copy ?? "";
  if (b.position !== undefined) patch.position = b.position;
  if (b.published !== undefined) patch.published = b.published;
  if (b.requirePrevious !== undefined) patch.requirePrevious = b.requirePrevious;
  if (b.kind !== undefined) patch.kind = b.kind;
  if (b.checklistItems !== undefined) {
    patch.checklistItems = Array.isArray(b.checklistItems) ? b.checklistItems : [];
  }
  const [e] = await db.update(episodesTable).set(patch).where(eq(episodesTable.id, id)).returning();
  if (!e) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    id: e.id,
    moduleId: e.moduleId,
    title: e.title,
    videoUrl: e.videoUrl ?? null,
    copy: e.copy,
    position: e.position,
    published: e.published,
    requirePrevious: e.requirePrevious,
    kind: e.kind,
    checklistItems: e.checklistItems ?? [],
  });
});

router.delete("/admin/episodes/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  await db.delete(episodesTable).where(eq(episodesTable.id, id));
  res.sendStatus(204);
});

// Settings
function maskKey(key: string): string {
  if (!key || key.length < 8) return "••••••••";
  return key.slice(0, 4) + "••••••••••••" + key.slice(-4);
}

function shapeSettings(s: typeof settingsTable.$inferSelect, role: string) {
  const proto = process.env.REPLIT_DOMAINS?.split(",")[0];
  const webhookUrl = proto ? `https://${proto}/api/invite-client` : "/api/invite-client";
  const isSuperAdmin = role === "super_admin";
  return {
    apiKey: isSuperAdmin ? s.apiKey : maskKey(s.apiKey),
    businessManagerId: s.businessManagerId,
    notifyOnIcp: s.notifyOnIcp,
    notifyOnFirstLogin: s.notifyOnFirstLogin,
    notifyOnAllComplete: s.notifyOnAllComplete,
    notifyIcpEmail: s.notifyIcpEmail,
    notifyFirstLoginEmail: s.notifyFirstLoginEmail,
    notifyAllCompleteEmail: s.notifyAllCompleteEmail,
    supportEmail: s.supportEmail,
    webhookUrl,
  };
}

router.get("/admin/settings", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const s = await getOrCreateSettings();
  res.json(shapeSettings(s, admin.role));
});

router.patch("/admin/settings", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const s = await getOrCreateSettings();
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const k of [
    "businessManagerId",
    "notifyOnIcp",
    "notifyOnFirstLogin",
    "notifyOnAllComplete",
    "notifyIcpEmail",
    "notifyFirstLoginEmail",
    "notifyAllCompleteEmail",
    "supportEmail",
  ]) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  const [updated] = await db.update(settingsTable).set(patch).where(eq(settingsTable.id, s.id)).returning();
  res.json(shapeSettings(updated, admin.role));
});

router.post("/admin/settings/api-key/regenerate", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const s = await getOrCreateSettings();
  const apiKey = "phk_" + crypto.randomBytes(24).toString("hex");
  const [updated] = await db.update(settingsTable).set({ apiKey }).where(eq(settingsTable.id, s.id)).returning();
  res.json(shapeSettings(updated, admin.role));
});

// Admin users — operator account list is a super_admin-only surface
router.get("/admin/admins", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const users = await db.select().from(adminUsersTable).orderBy(desc(adminUsersTable.createdAt));
  res.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      role: u.role,
      scopes: u.scopes ?? [],
      userId: u.userId ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
  );
});

router.post("/admin/admins", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const b = req.body ?? {};
  if (!b.email || !b.role) {
    res.status(400).json({ error: "email and role required" });
    return;
  }
  const scopes = Array.isArray(b.scopes)
    ? (b.scopes as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  const [u] = await db
    .insert(adminUsersTable)
    .values({ email: String(b.email).toLowerCase(), name: b.name ?? null, role: b.role, scopes })
    .onConflictDoUpdate({
      target: adminUsersTable.email,
      set: { role: b.role, name: b.name ?? null, scopes },
    })
    .returning();
  await notify(u.email, `You've been invited as a ${BRAND_NAME} admin`, `Sign in at the portal to access admin tools.`);
  res.json({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    scopes: u.scopes ?? [],
    userId: u.userId ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });
});

router.patch("/admin/admins/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const role = String(req.body?.role ?? "");
  if (!["super_admin", "admin", "viewer"].includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }
  const [u] = await db.update(adminUsersTable).set({ role }).where(eq(adminUsersTable.id, id)).returning();
  if (!u) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    scopes: u.scopes ?? [],
    userId: u.userId ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });
});

router.delete("/admin/admins/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  await db.delete(adminUsersTable).where(eq(adminUsersTable.id, id));
  res.sendStatus(204);
});

// =============== IMPERSONATION (preview-as-client) ===============

router.post("/admin/clients/:id/impersonate", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminWrite(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id) { res.status(400).json({ error: "Bad id" }); return; }
  const [target] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!target) { res.status(404).json({ error: "Client not found" }); return; }
  const ok = await setImpersonateClientId(req, id);
  if (!ok) { res.status(401).json({ error: "No session" }); return; }
  await db.insert(activityEventsTable).values({
    kind: "impersonation_started",
    message: `${admin.email} started previewing as ${target.firstName} ${target.lastName}`,
    clientId: id,
    actorType: "admin",
    actorId: admin.id,
    actorEmail: admin.email,
  });
  res.json({ ok: true, clientId: id });
});

router.post("/admin/exit-impersonate", async (req: Request, res: Response): Promise<void> => {
  const cur = await currentSession(req);
  const prev = cur?.data.impersonateClientId ?? null;
  await setImpersonateClientId(req, null);
  if (req.isAuthenticated() && prev) {
    const { admin } = await resolveRole(req.user.email, req.user.id);
    if (admin) {
      await db.insert(activityEventsTable).values({
        kind: "impersonation_ended",
        message: `${admin.email} ended preview as client #${prev}`,
        clientId: prev,
        actorType: "admin",
        actorId: admin.id,
        actorEmail: admin.email,
      });
    }
  }
  res.json({ ok: true });
});

// =============== SUPPORT (admin) ===============

router.get("/admin/support", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminScope(req, res, "support");
  if (!admin) return;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const where = status === "open" || status === "resolved"
    ? eq(supportTicketsTable.status, status)
    : undefined;
  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(where ?? sql`true`)
    .orderBy(desc(supportTicketsTable.lastMessageAt))
    .limit(200);
  const clientIds = Array.from(new Set(tickets.map((t) => t.clientId)));
  const clients = clientIds.length
    ? await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds))
    : [];
  const cMap = new Map(clients.map((c) => [c.id, c]));
  const slaMap = await computeTicketSlas(tickets);
  res.json(tickets.map((t) => {
    const c = cMap.get(t.clientId) ?? null;
    const sla = slaMap.get(t.id);
    return {
      id: t.id,
      subject: t.subject,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      lastMessageAt: t.lastMessageAt.toISOString(),
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      firstResponseMs: sla?.firstResponseMs ?? null,
      resolutionMs: sla?.resolutionMs ?? null,
      awaitingReplyMs: sla?.awaitingReplyMs ?? null,
      lastMessageAuthor: sla?.lastMessageAuthor ?? null,
      client: c ? {
        id: c.id, firstName: c.firstName, lastName: c.lastName,
        email: c.email, businessName: c.businessName,
      } : null,
    };
  }));
});

// Aggregate support SLA metrics for the admin dashboard / support header.
// Looks at the last 90 days so a one-time outlier doesn't anchor the average.
router.get("/admin/support/metrics", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminScope(req, res, "support");
  if (!admin) return;
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(sql`${supportTicketsTable.createdAt} >= ${since}`)
    .orderBy(desc(supportTicketsTable.createdAt));
  const slaMap = await computeTicketSlas(tickets);

  const firstResp: number[] = [];
  const resolution: number[] = [];
  const awaitingNow: { ticketId: number; subject: string; clientId: number; awaitingReplyMs: number }[] = [];
  const perClient = new Map<number, { ticketCount: number; firstResp: number[]; resolution: number[] }>();
  let openCount = 0;
  let resolvedCount = 0;
  for (const t of tickets) {
    const sla = slaMap.get(t.id)!;
    if (t.status === "open") openCount++;
    else if (t.status === "resolved") resolvedCount++;
    if (sla.firstResponseMs !== null) firstResp.push(sla.firstResponseMs);
    if (sla.resolutionMs !== null) resolution.push(sla.resolutionMs);
    if (sla.awaitingReplyMs !== null) {
      awaitingNow.push({ ticketId: t.id, subject: t.subject, clientId: t.clientId, awaitingReplyMs: sla.awaitingReplyMs });
    }
    const pc = perClient.get(t.clientId) ?? { ticketCount: 0, firstResp: [], resolution: [] };
    pc.ticketCount++;
    if (sla.firstResponseMs !== null) pc.firstResp.push(sla.firstResponseMs);
    if (sla.resolutionMs !== null) pc.resolution.push(sla.resolutionMs);
    perClient.set(t.clientId, pc);
  }

  const clientIds = Array.from(perClient.keys());
  const clients = clientIds.length
    ? await db.select().from(clientsTable).where(inArray(clientsTable.id, clientIds))
    : [];
  const cMap = new Map(clients.map((c) => [c.id, c]));
  const perClientOut = Array.from(perClient.entries())
    .map(([clientId, pc]) => {
      const c = cMap.get(clientId);
      return {
        clientId,
        clientName: c ? `${c.firstName} ${c.lastName}`.trim() || c.email : "Unknown",
        businessName: c?.businessName ?? null,
        ticketCount: pc.ticketCount,
        avgFirstResponseMs: avg(pc.firstResp),
        avgResolutionMs: avg(pc.resolution),
      };
    })
    .sort((a, b) => b.ticketCount - a.ticketCount);

  awaitingNow.sort((a, b) => b.awaitingReplyMs - a.awaitingReplyMs);

  res.json({
    windowDays: 90,
    totalTickets: tickets.length,
    openCount,
    resolvedCount,
    awaitingReplyCount: awaitingNow.length,
    avgFirstResponseMs: avg(firstResp),
    medianFirstResponseMs: median(firstResp),
    avgResolutionMs: avg(resolution),
    medianResolutionMs: median(resolution),
    awaiting: awaitingNow.slice(0, 10),
    perClient: perClientOut.slice(0, 50),
  });
});

router.get("/admin/support/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminScope(req, res, "support");
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const detail = await loadTicketDetail(id);
  if (!detail) { res.status(404).json({ error: "Not found" }); return; }
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, detail.ticket.clientId));
  const t = detail.ticket;
  const slaMap = await computeTicketSlas([t]);
  const sla = slaMap.get(t.id);
  const [rating] = await db
    .select()
    .from(supportTicketRatingsTable)
    .where(eq(supportTicketRatingsTable.ticketId, id));
  res.json({
    id: t.id,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    firstResponseMs: sla?.firstResponseMs ?? null,
    resolutionMs: sla?.resolutionMs ?? null,
    awaitingReplyMs: sla?.awaitingReplyMs ?? null,
    lastMessageAuthor: sla?.lastMessageAuthor ?? null,
    client: c ? {
      id: c.id, firstName: c.firstName, lastName: c.lastName,
      email: c.email, businessName: c.businessName,
    } : null,
    messages: detail.messages,
    rating: rating
      ? {
          resolutionRating: rating.resolutionRating,
          processRating: rating.processRating,
          comment: rating.comment,
          createdAt: rating.createdAt.toISOString(),
        }
      : null,
  });
});

router.post("/admin/support/:id/messages", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminScope(req, res, "support", ["super_admin", "admin"]);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 8000) : "";
  const attachments = sanitizeAttachments(req.body?.attachments);
  if (!body && attachments.length === 0) {
    res.status(400).json({ error: "Message body or attachment required" });
    return;
  }
  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket) { res.status(404).json({ error: "Not found" }); return; }
  const now = new Date();
  const [msg] = await db.insert(supportTicketMessagesTable).values({
    ticketId: id,
    authorType: "admin",
    authorId: admin.id,
    authorName: admin.name || admin.email,
    authorEmail: admin.email,
    body: body || "(attachment)",
  }).returning();
  if (attachments.length) {
    await db.insert(supportAttachmentsTable).values(
      attachments.map((a) => ({ messageId: msg.id, ...a })),
    );
  }
  await db.update(supportTicketsTable).set({ lastMessageAt: now }).where(eq(supportTicketsTable.id, id));

  res.json({ id: msg.id });

  // Notify the ticket's client (in-app + email).
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, ticket.clientId));
  if (client) {
    void createNotification({
      audience: "client",
      userId: client.id,
      kind: "support_reply",
      title: `New reply on: ${ticket.subject}`,
      body: body || "(attachment)",
      link: `/support`,
    }).catch((err) => req.log.error({ err }, "createNotification failed"));
    if (client.email) {
      void notify(
        client.email,
        `New reply on your ${BRAND_NAME} support ticket: ${ticket.subject}`,
        `${admin.name || admin.email} replied:\n\n${body || "(attachment)"}\n\nVisit your portal to view and respond.`,
      ).catch((err) => req.log.error({ err }, "notify client failed"));
    }
  }
});

router.patch("/admin/support/:id", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdminScope(req, res, "support", ["super_admin", "admin"]);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const status = String(req.body?.status ?? "");
  if (!["open", "resolved"].includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const [t] = await db.update(supportTicketsTable).set({
    status,
    resolvedAt: status === "resolved" ? new Date() : null,
  }).where(eq(supportTicketsTable.id, id)).returning();
  if (!t) { res.status(404).json({ error: "Not found" }); return; }
  // Notify the client of status changes.
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, t.clientId));
  if (client) {
    void createNotification({
      audience: "client",
      userId: client.id,
      kind: "support_status",
      title: status === "resolved" ? `Resolved: ${t.subject}` : `Reopened: ${t.subject}`,
      body: status === "resolved"
        ? "Your support ticket has been marked resolved. Reply any time to reopen it."
        : "Your support ticket has been reopened.",
      link: `/support`,
    }).catch((err) => req.log.error({ err }, "createNotification failed"));
  }
  res.json({ id: t.id, status: t.status });
});

// =============== NOTIFICATIONS (admin) ===============

router.get("/admin/notifications", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.audience, "admin"), eq(notificationsTable.userId, admin.id)))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  const unread = await unreadCount("admin", admin.id);
  res.json({
    unread,
    items: rows.map((n) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

router.post("/admin/notifications/:id/read", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  await db.update(notificationsTable).set({ readAt: new Date() }).where(
    and(
      eq(notificationsTable.id, id),
      eq(notificationsTable.audience, "admin"),
      eq(notificationsTable.userId, admin.id),
    ),
  );
  res.json({ ok: true });
});

router.post("/admin/notifications/read-all", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  await db.update(notificationsTable).set({ readAt: new Date() }).where(
    and(
      eq(notificationsTable.audience, "admin"),
      eq(notificationsTable.userId, admin.id),
      sql`${notificationsTable.readAt} IS NULL`,
    ),
  );
  res.json({ ok: true });
});

// =============== ADMIN SCOPES ===============

const VALID_SCOPES = new Set([
  "dashboard", "clients", "content", "agreements",
  "analytics", "support", "settings", "admins",
]);

router.patch("/admin/admins/:id/scopes", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res, ["super_admin"]);
  if (!admin) return;
  const id = parseInt(String(req.params.id), 10);
  const raw = req.body?.scopes;
  if (!Array.isArray(raw)) { res.status(400).json({ error: "scopes must be an array" }); return; }
  const scopes = (raw as unknown[])
    .filter((s): s is string => typeof s === "string" && VALID_SCOPES.has(s));
  const [u] = await db.update(adminUsersTable).set({ scopes }).where(eq(adminUsersTable.id, id)).returning();
  if (!u) { res.status(404).json({ error: "Not found" }); return; }
  res.json({
    id: u.id, email: u.email, name: u.name ?? null, role: u.role,
    scopes: u.scopes ?? [],
    userId: u.userId ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });
});

// Webhook (no auth, X-API-Key required)
router.post("/invite-client", async (req: Request, res: Response): Promise<void> => {
  const provided = String(req.headers["x-api-key"] ?? "");
  const s = await getOrCreateSettings();
  if (!provided || provided !== s.apiKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  const b = req.body ?? {};
  if (!b.first_name || !b.last_name || !b.email || !b.business_name) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const { created, emailResult } = await createClientCore(b);
  res.json({
    client_id: created.id,
    success: true,
    invite_email_sent: emailResult.ok,
    invite_email_error: emailResult.ok ? null : emailResult.error ?? null,
  });
});

export default router;
