import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, asc, sql, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  modulesTable,
  episodesTable,
  episodeProgressTable,
  clientCoursesTable,
  icpResponsesTable,
  activityEventsTable,
  supportTicketsTable,
  supportTicketMessagesTable,
  supportAttachmentsTable,
  supportTicketRatingsTable,
  notificationsTable,
  agreementAssignmentsTable,
  agreementTemplatesTable,
  agreementEventsTable,
  objectUploadsTable,
  type Client,
  type Episode,
} from "@workspace/db";
import { resolveRole, requireClient } from "../lib/access";
import { currentSession } from "../lib/auth";
import {
  logActivity,
  getOrCreateSettings,
  notify,
  notifyScopedAdmins,
  unreadCount,
} from "../lib/notifications";
import { BRAND_APP_NAME } from "../lib/brand";
import { desc } from "drizzle-orm";
import { loadTicketDetail, sanitizeAttachments } from "../lib/support";

const router: IRouter = Router();

function clientProfileFor(c: Client) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    businessName: c.businessName,
    phone: c.phone ?? null,
    sprintStartDate: c.sprintStartDate ?? null,
    status: c.status,
    inviteSentAt: c.inviteSentAt?.toISOString() ?? null,
    lastLoginAt: c.lastLoginAt?.toISOString() ?? null,
    tutorialCompletedAt: c.tutorialCompletedAt?.toISOString() ?? null,
    acceptedTermsAt: c.acceptedTermsAt?.toISOString() ?? null,
  };
}

function shapeEpisode(
  e: Episode,
  locked: boolean,
  progress?: { completedAt: Date | null; checklistChecked: number[]; checklistResponses: Record<string, string> },
) {
  return {
    id: e.id,
    moduleId: e.moduleId,
    title: e.title,
    videoUrl: e.videoUrl ?? null,
    copy: e.copy,
    position: e.position,
    locked,
    completed: !!progress?.completedAt,
    completedAt: progress?.completedAt ? progress.completedAt.toISOString() : null,
    checklistItems: e.checklistItems ?? [],
    checklistChecked: progress?.checklistChecked ?? [],
    checklistResponses: progress?.checklistResponses ?? {},
    kind: e.kind,
  };
}

// Returns whether the agreement gate is satisfied for this client. The
// gate is OPEN (true) when the client has no agreement assigned at all,
// or when every assignment they have is signed/completed. It is CLOSED
// (false) only when at least one assignment is still awaiting their
// signature — in which case `buildClientModules` locks every episode so
// the client cannot start sprint work until they sign.
async function getAgreementGateOpen(clientId: number): Promise<boolean> {
  const allAssignments = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(eq(agreementAssignmentsTable.clientId, clientId));
  // No assignment yet → gate is CLOSED. Previously this returned `true`,
  // which let a freshly-onboarded client jump straight into the ICP and
  // module content before they had ever signed (or even seen) the service
  // agreement. The agreement must be the first thing they do after
  // accepting terms — `accept-terms` now auto-assigns the latest published
  // template, so a "no assignments" state should only be possible while
  // the admin is still configuring templates.
  if (allAssignments.length === 0) return false;
  return allAssignments.every(
    (a) => !!a.clientSignedAt || !!a.completedAt || a.status === "signed" || a.status === "completed",
  );
}

async function buildClientModules(client: Client, opts?: { agreementGateOpen?: boolean }) {
  const agreementGateOpen = opts?.agreementGateOpen ?? (await getAgreementGateOpen(client.id));
  // Course-based content gating: a client only sees modules whose course
  // is in their assigned course set. Modules with no course (legacy) are
  // never shown once the courses feature is in use — admins must place
  // them in a course explicitly. The post-deploy backfill placed every
  // pre-existing module into the auto-created "Sprint Hub" course and
  // assigned every existing client to it, so this is backwards-compatible.
  const assignedCourses = await db
    .select({ courseId: clientCoursesTable.courseId })
    .from(clientCoursesTable)
    .where(eq(clientCoursesTable.clientId, client.id));
  const assignedCourseIds = assignedCourses.map((r) => r.courseId);
  const mods = assignedCourseIds.length === 0
    ? []
    : await db
        .select()
        .from(modulesTable)
        .where(and(eq(modulesTable.published, true), inArray(modulesTable.courseId, assignedCourseIds)))
        .orderBy(asc(modulesTable.position));
  const eps = await db
    .select()
    .from(episodesTable)
    .where(eq(episodesTable.published, true))
    .orderBy(asc(episodesTable.position));
  const progress = await db
    .select()
    .from(episodeProgressTable)
    .where(eq(episodeProgressTable.clientId, client.id));
  const progressByEpisode = new Map(progress.map((p) => [p.episodeId, p]));

  // Cross-module sequential gate: a module is `prevModuleComplete` only when
  // every published episode in the previous module has progress.completedAt.
  // Used below to lock module N when module N-1 isn't fully done.
  let prevModuleComplete = true;
  const out = mods.map((m) => {
    const moduleEps = eps.filter((e) => e.moduleId === m.id);
    const moduleGateOpen = agreementGateOpen && prevModuleComplete;
    let prevDone = true;
    const shaped = moduleEps.map((e, idx) => {
      const p = progressByEpisode.get(e.id);
      // An already-completed episode must never be locked — even if the
      // previous one is missing/incomplete (e.g. admin reordered episodes,
      // toggled `requirePrevious` after the fact, or the previous module
      // doesn't carry over here). Otherwise the user sees "completed" but
      // can't reopen the episode they just finished.
      const completed = !!p?.completedAt;
      const intraLock = e.requirePrevious ? !prevDone && !completed : false;
      // Lock everything when the agreement is unsigned or the previous
      // module isn't done — but never lock an already-completed episode,
      // so clients can revisit work they've already finished.
      const locked = completed ? false : (intraLock || !moduleGateOpen);
      prevDone = completed;
      void idx;
      return shapeEpisode(e, locked, p ? { completedAt: p.completedAt, checklistChecked: p.checklistChecked ?? [], checklistResponses: p.checklistResponses ?? {} } : undefined);
    });
    const completedCount = shaped.filter((e) => e.completed).length;
    const status: "locked" | "in_progress" | "complete" =
      completedCount === shaped.length && shaped.length > 0
        ? "complete"
        : completedCount > 0
          ? "in_progress"
          : shaped.every((e) => e.locked)
            ? "locked"
            : "in_progress";
    // Update the cross-module gate state for the NEXT module before
    // continuing. A module with zero published episodes is treated as
    // complete so it doesn't block the rest of the course.
    prevModuleComplete = shaped.length === 0 || completedCount === shaped.length;
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      position: m.position,
      status,
      episodes: shaped,
    };
  });

  // Unlock the very first module's first episode regardless of intra-module
  // ordering — but ONLY when the agreement gate is open. If the client still
  // owes a signature, every episode (including the first) must stay locked
  // so they're forced through the agreement flow first.
  if (agreementGateOpen && out.length > 0 && out[0].episodes.length > 0) {
    const first = out[0].episodes[0];
    if (!first.completed) first.locked = false;
  }
  return out;
}

router.get("/me", async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.json({ authenticated: false, role: "none", user: null, client: null });
    return;
  }
  const fwd = req.headers["x-forwarded-for"];
  const ip = typeof fwd === "string" && fwd.length > 0
    ? fwd.split(",")[0].trim()
    : req.ip || req.socket.remoteAddress || "";
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"]!.slice(0, 512) : "";
  const cur = await currentSession(req);
  const impersonateId = cur?.data.impersonateClientId ?? null;
  let effectiveRole = "none" as Awaited<ReturnType<typeof resolveRole>>["role"];
  let effectiveClient: Client | null = null;
  const resolved = await resolveRole(req.user.email, req.user.id, { ip, userAgent: ua });
  if (impersonateId && resolved.admin && (resolved.admin.role === "super_admin" || resolved.admin.role === "admin")) {
    const [target] = await db.select().from(clientsTable).where(eq(clientsTable.id, impersonateId));
    if (target) {
      effectiveRole = "client";
      effectiveClient = target;
    }
  }
  const role = effectiveClient ? effectiveRole : resolved.role;
  const client = effectiveClient ?? resolved.client;
  const impersonating = !!effectiveClient;
  const adminScopes = !impersonating && resolved.admin ? (resolved.admin.scopes ?? []) : [];
  res.json({
    authenticated: true,
    role,
    user: req.user,
    client: client ? clientProfileFor(client) : null,
    impersonating,
    adminScopes,
  });
});

function getReqContext(req: Request): { ip: string; userAgent: string } {
  const fwd = req.headers["x-forwarded-for"];
  const ip = typeof fwd === "string" && fwd.length > 0
    ? fwd.split(",")[0].trim()
    : req.ip || req.socket.remoteAddress || "";
  const ua = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"]!.slice(0, 512) : "";
  return { ip, userAgent: ua };
}

router.post("/me/onboarding/tutorial-complete", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const now = new Date();
  await db.update(clientsTable).set({ tutorialCompletedAt: now }).where(eq(clientsTable.id, client.id));
  await db.insert(activityEventsTable).values({
    kind: "tutorial_completed",
    message: `${client.firstName} ${client.lastName} finished the welcome tutorial`,
    clientId: client.id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    ip: getReqContext(req).ip,
    userAgent: getReqContext(req).userAgent,
  });
  res.json({ tutorialCompletedAt: now.toISOString() });
});

router.post("/me/onboarding/accept-terms", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const accepted = req.body?.accepted === true;
  if (!accepted) {
    res.status(400).json({ error: "Acceptance required" });
    return;
  }
  const ctx = getReqContext(req);
  const now = new Date();
  await db.update(clientsTable).set({
    acceptedTermsAt: now,
    consentIp: ctx.ip || null,
    consentUserAgent: ctx.userAgent || null,
  }).where(eq(clientsTable.id, client.id));
  await db.insert(activityEventsTable).values({
    kind: "terms_accepted",
    message: `${client.firstName} ${client.lastName} accepted the terms`,
    clientId: client.id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { ip: ctx.ip, userAgent: ctx.userAgent },
  });
  // Auto-assign the active service agreement so the client can sign it
  // immediately after onboarding. Routed through the shared helper so the
  // dashboard recovery path uses the same atomic transaction and we never
  // double-insert from a fast double-tap on "Accept terms".
  await ensureClientHasAgreementAssignment(client.id, req.log);
  res.json({ acceptedTermsAt: now.toISOString(), ip: ctx.ip });
});

/**
 * Make sure a client has at least one agreement assignment.
 *
 * Used in two places:
 *   - Right after the client accepts the terms-of-service modal, so the
 *     "sign your agreement" CTA actually has something to open.
 *   - At the top of `/me/dashboard`, so a client whose only assignment was
 *     deleted (template wiped by an admin) doesn't end up permanently
 *     gated. Without this recovery, the new "zero assignments == closed"
 *     gate semantics would be a footgun for admin operations.
 *
 * The whole select-then-insert runs inside a transaction so concurrent
 * requests (double-tap on accept-terms, parallel tab loads) can't both
 * observe "no existing" and both insert a duplicate pending assignment —
 * which would otherwise force the client through multiple signatures
 * because the gate requires *every* assignment to be signed.
 */
async function ensureClientHasAgreementAssignment(
  clientId: number,
  log: Request["log"],
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: agreementAssignmentsTable.id })
        .from(agreementAssignmentsTable)
        .where(eq(agreementAssignmentsTable.clientId, clientId))
        .limit(1);
      if (existing.length > 0) return;
      const [tpl] = await tx
        .select({ id: agreementTemplatesTable.id })
        .from(agreementTemplatesTable)
        .where(eq(agreementTemplatesTable.archived, false))
        .orderBy(desc(agreementTemplatesTable.updatedAt))
        .limit(1);
      if (!tpl) return; // No published template configured — admin must fix.
      await tx.insert(agreementAssignmentsTable).values({
        templateId: tpl.id,
        clientId,
        status: "pending",
      });
    });
  } catch (err) {
    log.warn({ err, clientId }, "ensureClientHasAgreementAssignment failed");
  }
}

router.post("/me/support", async (req: Request, res: Response): Promise<void> => {
  // Don't let admins open new support tickets while previewing as the client.
  const client = await requireClient(req, res, { allowImpersonation: false });
  if (!client) return;
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 200) : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 8000) : "";
  if (!subject || !body) {
    res.status(400).json({ error: "Subject and body required" });
    return;
  }
  const now = new Date();
  const [ticket] = await db.insert(supportTicketsTable).values({
    clientId: client.id, subject, body, lastMessageAt: now,
  }).returning();
  // Seed the thread with the opening message so the new thread UIs render
  // the original request as the first message in the conversation.
  await db.insert(supportTicketMessagesTable).values({
    ticketId: ticket.id,
    authorType: "client",
    authorId: client.id,
    authorName: `${client.firstName} ${client.lastName}`,
    authorEmail: client.email,
    body,
  });
  const settings = await getOrCreateSettings();
  const supportTo = settings.supportEmail || settings.notifyIcpEmail;
  if (supportTo) {
    await notify(
      supportTo,
      `[Support] ${subject} — ${client.firstName} ${client.lastName}`,
      `From: ${client.firstName} ${client.lastName} <${client.email}>\nBusiness: ${client.businessName}\n\n${body}\n\n— Ticket #${ticket.id}`,
    );
  }
  await db.insert(activityEventsTable).values({
    kind: "support_ticket",
    message: `Support ticket: ${subject}`,
    clientId: client.id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    ip: getReqContext(req).ip,
    userAgent: getReqContext(req).userAgent,
    metadata: { ticketId: ticket.id },
  });
  res.json({ id: ticket.id, status: "received" });
  void notifyScopedAdmins("support", {
    kind: "support_ticket",
    title: `New support request: ${subject}`,
    body: `${client.firstName} ${client.lastName} (${client.email}) opened ticket #${ticket.id}\n\n${body}`,
    link: `/admin/support`,
  }).catch((err) => req.log.error({ err }, "notifyScopedAdmins failed"));
});

// ============ SUPPORT THREAD: client read + reply ============

router.get("/me/support", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const rows = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.clientId, client.id))
    .orderBy(desc(supportTicketsTable.lastMessageAt));
  res.json(rows.map((t) => ({
    id: t.id,
    subject: t.subject,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  })));
});

router.get("/me/support/:id", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id) { res.status(400).json({ error: "Bad id" }); return; }
  const detail = await loadTicketDetail(id);
  if (!detail || detail.ticket.clientId !== client.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const t = detail.ticket;
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

// Client rates a resolved ticket. Two 1-5 scores: how well the issue was
// resolved, and how the experience getting there felt. Re-submitting
// updates the existing row so a client can change their mind.
router.post("/me/support/:id/rating", async (req: Request, res: Response): Promise<void> => {
  // Ratings are first-person sentiment from the client; an admin previewing
  // must not be able to write one and skew intelligence dashboards.
  const client = await requireClient(req, res, { allowImpersonation: false });
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id) { res.status(400).json({ error: "Bad id" }); return; }
  const resolution = Number(req.body?.resolutionRating);
  const process = Number(req.body?.processRating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim().slice(0, 4000) : "";
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > 5 ||
      !Number.isInteger(process) || process < 1 || process > 5) {
    res.status(400).json({ error: "Ratings must be integers 1-5" });
    return;
  }
  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket || ticket.clientId !== client.id) { res.status(404).json({ error: "Not found" }); return; }
  if (ticket.status !== "resolved") {
    res.status(400).json({ error: "Only resolved tickets can be rated" });
    return;
  }
  await db
    .insert(supportTicketRatingsTable)
    .values({ ticketId: id, clientId: client.id, resolutionRating: resolution, processRating: process, comment })
    .onConflictDoUpdate({
      target: supportTicketRatingsTable.ticketId,
      set: { resolutionRating: resolution, processRating: process, comment, createdAt: new Date() },
    });
  await db.insert(activityEventsTable).values({
    kind: "support_rating",
    message: `Rated ticket #${id}: ${resolution}/5 resolution, ${process}/5 process`,
    clientId: client.id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    metadata: { ticketId: id, resolutionRating: resolution, processRating: process },
  });
  res.json({ ok: true });
});

router.post("/me/support/:id/messages", async (req: Request, res: Response): Promise<void> => {
  // Mutation: an admin previewing as a client should not be able to post
  // support messages on the client's behalf (it would email staff and
  // reopen tickets as if the client did it).
  const client = await requireClient(req, res, { allowImpersonation: false });
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  if (!id) { res.status(400).json({ error: "Bad id" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 8000) : "";
  const attachments = sanitizeAttachments(req.body?.attachments);
  if (!body && attachments.length === 0) {
    res.status(400).json({ error: "Message body or attachment required" });
    return;
  }
  const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!ticket || ticket.clientId !== client.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Cross-tenant rebinding guard: every attachment objectPath must be one
  // this client was issued at upload time. Without this check a client
  // could attach a known foreign /objects/<id> path to their own ticket
  // and read another tenant's file via /me/files/*path.
  const paths = attachments.map((a) => a.objectPath).filter((p): p is string => !!p);
  let ownedPaths = new Set<string>();
  if (paths.length > 0) {
    const owners = await db
      .select()
      .from(objectUploadsTable)
      .where(inArray(objectUploadsTable.objectPath, paths));
    ownedPaths = new Set(
      owners
        .filter((o) => o.ownerType === "client" && o.ownerId === client.id)
        .map((o) => o.objectPath),
    );
    const offending = paths.filter((p) => !ownedPaths.has(p));
    if (offending.length > 0) {
      res.status(403).json({ error: "Attachment object paths must belong to the requesting client" });
      return;
    }
  }

  const now = new Date();
  const [msg] = await db.insert(supportTicketMessagesTable).values({
    ticketId: id,
    authorType: "client",
    authorId: client.id,
    authorName: `${client.firstName} ${client.lastName}`,
    authorEmail: client.email,
    body: body || "(attachment)",
  }).returning();
  if (attachments.length) {
    await db.insert(supportAttachmentsTable).values(
      attachments.map((a) => ({ messageId: msg.id, ...a })),
    );
  }
  // Reopen if previously resolved; always bump activity timestamp.
  await db.update(supportTicketsTable).set({
    lastMessageAt: now,
    status: ticket.status === "resolved" ? "open" : ticket.status,
    resolvedAt: ticket.status === "resolved" ? null : ticket.resolvedAt,
  }).where(eq(supportTicketsTable.id, id));

  res.json({ id: msg.id });

  void notifyScopedAdmins("support", {
    kind: "support_reply",
    title: `New reply from ${client.firstName} ${client.lastName}: ${ticket.subject}`,
    body: body || "(attachment)",
    link: `/admin/support`,
  }).catch((err) => req.log.error({ err }, "notifyScopedAdmins failed"));
});

// ============ NOTIFICATIONS (client) ============

router.get("/me/notifications", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.audience, "client"), eq(notificationsTable.userId, client.id)))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  const unread = await unreadCount("client", client.id);
  res.json({
    unread,
    items: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

router.post("/me/notifications/:id/read", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  await db.update(notificationsTable).set({ readAt: new Date() }).where(
    and(
      eq(notificationsTable.id, id),
      eq(notificationsTable.audience, "client"),
      eq(notificationsTable.userId, client.id),
    ),
  );
  res.json({ ok: true });
});

router.post("/me/notifications/read-all", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  await db.update(notificationsTable).set({ readAt: new Date() }).where(
    and(
      eq(notificationsTable.audience, "client"),
      eq(notificationsTable.userId, client.id),
      sql`${notificationsTable.readAt} IS NULL`,
    ),
  );
  res.json({ ok: true });
});

router.post("/me/agreements/:id/page-view", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true });
  if (!client) return;
  const id = parseInt(String(req.params.id), 10);
  const page = Number(req.body?.page);
  if (!id || !Number.isFinite(page) || page < 1) {
    res.status(400).json({ error: "Bad request" });
    return;
  }
  const [a] = await db.select().from(agreementAssignmentsTable)
    .where(and(eq(agreementAssignmentsTable.id, id), eq(agreementAssignmentsTable.clientId, client.id)));
  if (!a) { res.status(404).json({ error: "Not found" }); return; }
  const ctx = getReqContext(req);
  await db.insert(agreementEventsTable).values({
    assignmentId: id,
    actorType: "client",
    actorId: client.id,
    actorEmail: client.email,
    kind: "page_view",
    ip: ctx.ip,
    metadata: { page },
  });
  res.json({ ok: true });
});

// 22-day sprint window. The countdown is "locked" until the client has
// signed an agreement, submitted ICP, and finished every published episode.
// At the moment all three are true we stamp `sprintStartedAt` and never
// reset it; the countdown then runs Day 1 → Day 22.
const SPRINT_LENGTH_DAYS = 22;

router.get("/me/dashboard", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res);
  if (!client) return;
  // Self-heal: if an admin deleted the client's only assignment (cascade
  // from a template wipe), give them a fresh one so they aren't stuck
  // behind the now-closed zero-assignment gate.
  await ensureClientHasAgreementAssignment(client.id, req.log);
  const allAssignments = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(eq(agreementAssignmentsTable.clientId, client.id));
  // "agreementSigned" on the prereq checklist means "at least one signed",
  // which matches the visual state of the checklist row. The sprint gate
  // is stricter and is the single source of truth for unlocking content —
  // delegate it to `getAgreementGateOpen` so dashboard, modules, episode
  // writes and ICP submit all agree (no assignments == closed).
  const agreementSigned = allAssignments.some(
    (a) => !!a.clientSignedAt || !!a.completedAt || a.status === "signed" || a.status === "completed",
  );
  const agreementGateOpen = await getAgreementGateOpen(client.id);
  const modules = await buildClientModules(client, { agreementGateOpen });
  const allEpisodes = modules.flatMap((m) => m.episodes);
  const completed = allEpisodes.filter((e) => e.completed).length;
  const total = allEpisodes.length;
  const [icp] = await db
    .select()
    .from(icpResponsesTable)
    .where(eq(icpResponsesTable.clientId, client.id));
  const icpSubmitted = !!icp?.submitted;

  const episodesComplete = total > 0 && completed === total;
  const prerequisitesMet = agreementSigned && icpSubmitted && episodesComplete;

  // The 22-day window only starts once an admin has reviewed the client's
  // submitted work and explicitly hit "Start sprint" (which sets
  // `sprintStartedAt`). Until then the client sees an "awaiting review"
  // state if all prerequisites are met.
  const sprintStartedAt = client.sprintStartedAt;
  const awaitingReview = prerequisitesMet && !sprintStartedAt;

  let sprintDayNumber: number | null = null;
  let sprintDaysRemaining: number | null = null;
  let sprintComplete = false;
  if (sprintStartedAt) {
    const elapsedMs = Date.now() - new Date(sprintStartedAt).getTime();
    const elapsedDays = Math.floor(elapsedMs / 86400000);
    sprintDayNumber = Math.min(SPRINT_LENGTH_DAYS, Math.max(1, elapsedDays + 1));
    sprintDaysRemaining = Math.max(0, SPRINT_LENGTH_DAYS - elapsedDays);
    sprintComplete = elapsedDays >= SPRINT_LENGTH_DAYS;
  }

  res.json({
    client: clientProfileFor(client),
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    completedEpisodes: completed,
    totalEpisodes: total,
    icpSubmitted,
    // Legacy field kept so older builds don't break — represents days
    // remaining once the sprint is active, or null when locked.
    sprintCountdownDays: sprintDaysRemaining,
    sprint: {
      length: SPRINT_LENGTH_DAYS,
      started: !!sprintStartedAt,
      startedAt: sprintStartedAt ? new Date(sprintStartedAt).toISOString() : null,
      dayNumber: sprintDayNumber,
      daysRemaining: sprintDaysRemaining,
      complete: sprintComplete,
      awaitingReview,
      prerequisites: {
        agreementSigned,
        icpSubmitted,
        episodesComplete,
        completedEpisodes: completed,
        totalEpisodes: total,
        allMet: prerequisitesMet,
      },
    },
    modules,
  });
});

router.get("/me/modules", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res);
  if (!client) return;
  res.json(await buildClientModules(client));
});

router.get("/me/episodes/:episodeId", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res);
  if (!client) return;
  const id = parseInt(String(req.params.episodeId), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  const modules = await buildClientModules(client);
  for (const m of modules) {
    for (const e of m.episodes) {
      if (e.id === id) {
        res.json(e);
        return;
      }
    }
  }
  res.status(404).json({ error: "Episode not found" });
});

// Verifies the given episode belongs to a published module whose course is
// on the caller's assigned course list. Returns true on success; on failure
// it has already sent a 404 (we do NOT leak existence to clients who can't
// see the content). Use this BEFORE any episode_progress write so a client
// can't mutate progress for content they aren't entitled to.
async function ensureEpisodeVisible(
  client: Client,
  episodeId: number,
  res: Response,
  opts?: { allowLocked?: boolean },
): Promise<boolean> {
  const assignments = await db
    .select({ courseId: clientCoursesTable.courseId })
    .from(clientCoursesTable)
    .where(eq(clientCoursesTable.clientId, client.id));
  const assignedCourseIds = assignments.map((a) => a.courseId).filter((n): n is number => n != null);
  if (assignedCourseIds.length === 0) {
    res.status(404).json({ error: "Episode not found" });
    return false;
  }
  const [row] = await db
    .select({ id: episodesTable.id })
    .from(episodesTable)
    .innerJoin(modulesTable, eq(episodesTable.moduleId, modulesTable.id))
    .where(
      and(
        eq(episodesTable.id, episodeId),
        eq(episodesTable.published, true),
        eq(modulesTable.published, true),
        inArray(modulesTable.courseId, assignedCourseIds),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "Episode not found" });
    return false;
  }

  // Lock enforcement: writes (complete / progress / checklist) must respect
  // the same gate the read-side returns. Without this a client could POST
  // /me/episodes/:id/complete for a locked episode (agreement pending,
  // previous module not done, requirePrevious not met) and bypass the
  // intended sprint flow. `allowLocked` is reserved for read paths that
  // legitimately need to render locked metadata.
  if (!opts?.allowLocked) {
    const modules = await buildClientModules(client);
    const ep = modules.flatMap((m) => m.episodes).find((e) => e.id === episodeId);
    if (ep?.locked) {
      // Match the not-visible response shape (404, same body) so a probe can't
      // distinguish "exists but locked" from "not in your courses". Without
      // this an attacker could enumerate episode IDs by checking which return
      // 403 vs 404.
      res.status(404).json({ error: "Episode not found" });
      return false;
    }
  }
  return true;
}

router.post("/me/episodes/:episodeId/complete", async (req: Request, res: Response): Promise<void> => {
  // Allow admins previewing as a client to mark episodes complete so they can
  // walk the entire flow. requireOnboarded is off because onboarding is not
  // yet shipped — gating on it would silently block every existing client.
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  const id = parseInt(String(req.params.episodeId), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  if (!(await ensureEpisodeVisible(client, id, res))) return;
  await db
    .insert(episodeProgressTable)
    .values({ clientId: client.id, episodeId: id, completedAt: new Date() })
    .onConflictDoUpdate({
      target: [episodeProgressTable.clientId, episodeProgressTable.episodeId],
      set: { completedAt: new Date() },
    });

  const modules = await buildClientModules(client);
  const ep = modules.flatMap((m) => m.episodes).find((e) => e.id === id);
  const completedModule = ep ? modules.find((m) => m.id === ep.moduleId) : null;
  const moduleJustCompleted =
    !!completedModule &&
    completedModule.episodes.length > 0 &&
    completedModule.episodes.every((e) => e.completed);

  // first-login email is handled at login; check all-complete
  const total = modules.flatMap((m) => m.episodes).length;
  const completed = modules.flatMap((m) => m.episodes).filter((e) => e.completed).length;
  if (total > 0 && total === completed) {
    // Idempotency guard: two parallel completions could each see themselves
    // as "the last one" and double-fire. Only the first all_complete activity
    // event for this client wins; we skip notifications + logging on dupes.
    const [existing] = await db
      .select({ id: activityEventsTable.id })
      .from(activityEventsTable)
      .where(and(
        eq(activityEventsTable.clientId, client.id),
        eq(activityEventsTable.kind, "all_complete"),
      ))
      .limit(1);
    if (!existing) {
      const settings = await getOrCreateSettings();
      if (settings.notifyOnAllComplete && settings.notifyAllCompleteEmail) {
        await notify(
          settings.notifyAllCompleteEmail,
          `${client.firstName} ${client.lastName} completed all modules`,
          `${client.businessName} has finished the ${BRAND_APP_NAME} training.`,
        );
      }
      void notifyScopedAdmins("clients", {
        kind: "all_complete",
        title: `All modules complete: ${client.firstName} ${client.lastName}`,
        body: `${client.businessName} has finished every published module. Time to review and start their sprint.`,
        link: `/admin/clients/${client.id}`,
      }).catch((err) => req.log.error({ err }, "notifyScopedAdmins(all_complete) failed"));
      await logActivity("all_complete", `${client.firstName} ${client.lastName} completed all modules`, client.id);
    }
  } else if (moduleJustCompleted && completedModule) {
    // Same idempotency pattern for module-complete (per module).
    const [existing] = await db
      .select({ id: activityEventsTable.id })
      .from(activityEventsTable)
      .where(and(
        eq(activityEventsTable.clientId, client.id),
        eq(activityEventsTable.kind, "module_complete"),
        sql`${activityEventsTable.metadata}->>'moduleId' = ${String(completedModule.id)}`,
      ))
      .limit(1);
    if (!existing) {
      void notifyScopedAdmins("clients", {
        kind: "module_complete",
        title: `Module complete: ${client.firstName} ${client.lastName}`,
        body: `${client.businessName} finished "${completedModule.title}".`,
        link: `/admin/clients/${client.id}`,
      }).catch((err) => req.log.error({ err }, "notifyScopedAdmins(module_complete) failed"));
      await db.insert(activityEventsTable).values({
        kind: "module_complete",
        message: `${client.firstName} ${client.lastName} completed module "${completedModule.title}"`,
        clientId: client.id,
        metadata: { moduleId: completedModule.id, moduleTitle: completedModule.title },
      });
    }
  } else {
    await logActivity("episode_complete", `${client.firstName} ${client.lastName} completed an episode`, client.id);
  }

  if (!ep) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }
  res.json(ep);
});

router.patch("/me/episodes/:episodeId/progress", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  const id = parseInt(String(req.params.episodeId), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  if (!(await ensureEpisodeVisible(client, id, res))) return;
  const positionSeconds = Math.max(0, Math.floor(Number(req.body?.positionSeconds ?? 0)));
  const durationSeconds = Math.max(0, Math.floor(Number(req.body?.durationSeconds ?? 0)));
  const incrementWatch = !!req.body?.incrementWatchCount;
  const now = new Date();
  await db
    .insert(episodeProgressTable)
    .values({
      clientId: client.id,
      episodeId: id,
      positionSeconds,
      durationSeconds,
      watchCount: incrementWatch ? 1 : 0,
      lastWatchedAt: now,
    })
    .onConflictDoUpdate({
      target: [episodeProgressTable.clientId, episodeProgressTable.episodeId],
      set: {
        positionSeconds,
        durationSeconds: durationSeconds || undefined,
        lastWatchedAt: now,
        ...(incrementWatch ? { watchCount: sql`${episodeProgressTable.watchCount} + 1` } : {}),
      },
    });
  res.json({ ok: true });
});

router.patch("/me/episodes/:episodeId/checklist", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  const id = parseInt(String(req.params.episodeId), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Bad id" });
    return;
  }
  if (!(await ensureEpisodeVisible(client, id, res))) return;
  const checked = Array.isArray(req.body?.checked) ? (req.body.checked as number[]) : undefined;
  const rawResponses = req.body?.responses;
  const responses: Record<string, string> | undefined =
    rawResponses && typeof rawResponses === "object" && !Array.isArray(rawResponses)
      ? Object.fromEntries(
          Object.entries(rawResponses as Record<string, unknown>)
            .filter(([, v]) => typeof v === "string")
            .map(([k, v]) => [String(k), String(v).slice(0, 4000)]),
        )
      : undefined;
  if (checked === undefined && responses === undefined) {
    res.status(400).json({ error: "Provide checked[] and/or responses{}" });
    return;
  }
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(episodeProgressTable)
      .where(and(eq(episodeProgressTable.clientId, client.id), eq(episodeProgressTable.episodeId, id)));
    const mergedResponses =
      responses !== undefined
        ? { ...(existing?.checklistResponses ?? {}), ...responses }
        : existing?.checklistResponses ?? {};
    const mergedChecked = checked !== undefined ? checked : existing?.checklistChecked ?? [];
    if (existing) {
      await tx
        .update(episodeProgressTable)
        .set({ checklistChecked: mergedChecked, checklistResponses: mergedResponses })
        .where(eq(episodeProgressTable.id, existing.id));
    } else {
      await tx.insert(episodeProgressTable).values({
        clientId: client.id,
        episodeId: id,
        checklistChecked: mergedChecked,
        checklistResponses: mergedResponses,
      });
    }
  });
  const modules = await buildClientModules(client);
  const ep = modules.flatMap((m) => m.episodes).find((e) => e.id === id);
  if (!ep) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }
  res.json(ep);
});

router.get("/me/icp", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res);
  if (!client) return;
  const [icp] = await db.select().from(icpResponsesTable).where(eq(icpResponsesTable.clientId, client.id));
  res.json({
    answers: icp?.answers ?? {},
    submitted: !!icp?.submitted,
    submittedAt: icp?.submittedAt?.toISOString() ?? null,
    savedAt: icp?.savedAt?.toISOString() ?? null,
  });
});

router.patch("/me/icp", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  const answers = (req.body?.answers ?? {}) as Record<string, string>;
  const now = new Date();
  const [row] = await db
    .insert(icpResponsesTable)
    .values({ clientId: client.id, answers, savedAt: now })
    .onConflictDoUpdate({
      target: icpResponsesTable.clientId,
      set: { answers, savedAt: now },
    })
    .returning();
  res.json({
    answers: row.answers ?? {},
    submitted: row.submitted,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    savedAt: row.savedAt?.toISOString() ?? null,
  });
});

const REQUIRED_ICP_KEYS = [
  "q1_business_in_one_sentence","q2_years_in_business","q3_core_service","q4_unique_mechanism",
  "q5_biggest_competitor","q6_why_choose_you","q7_current_mrr","q8_target_mrr",
  "q9_ideal_client_demographic","q10_biggest_pain_point","q11_false_beliefs","q12_previous_solutions",
  "q13_trigger_event","q14_dream_outcome","q15_objections","q16_where_they_hang_out","q17_decision_maker",
  "q18_offer_name","q19_offer_price","q20_payment_terms","q21_guarantee","q22_bonuses","q23_time_delay",
  "q24_effort_required","q25_case_study_1","q26_case_study_2",
  "q27_primary_goal","q28_secondary_goal","q29_current_cac","q30_target_cac","q31_monthly_budget",
  "q32_capacity","q33_sales_process","q34_anything_else",
];

router.post("/me/icp/submit", async (req: Request, res: Response): Promise<void> => {
  const client = await requireClient(req, res, { allowImpersonation: true, requireOnboarded: false });
  if (!client) return;
  // Defense in depth: the dashboard hides the ICP CTA behind the agreement
  // gate, but a client could still hit this endpoint directly via the legacy
  // `/icp` route or a stale link. Refuse the submit (and surface a clear
  // message) when the agreement isn't signed so we never collect ICP data
  // from a client who hasn't agreed to the contract.
  const gateOpen = await getAgreementGateOpen(client.id);
  if (!gateOpen) {
    res.status(403).json({
      error: "Agreement required",
      message: "Please sign your service agreement before submitting the ICP.",
    });
    return;
  }
  const answers = (req.body?.answers ?? {}) as Record<string, string>;
  const missing = REQUIRED_ICP_KEYS.filter(
    (k) => !answers[k] || String(answers[k]).trim() === "",
  );
  if (missing.length > 0) {
    res.status(400).json({
      error: "Incomplete ICP",
      missing,
      message: `Please answer all 34 questions before submitting (${missing.length} remaining).`,
    });
    return;
  }
  const now = new Date();
  const [row] = await db
    .insert(icpResponsesTable)
    .values({ clientId: client.id, answers, submitted: true, submittedAt: now, savedAt: now })
    .onConflictDoUpdate({
      target: icpResponsesTable.clientId,
      set: { answers, submitted: true, submittedAt: now, savedAt: now },
    })
    .returning();
  const settings = await getOrCreateSettings();
  if (settings.notifyOnIcp && settings.notifyIcpEmail) {
    await notify(
      settings.notifyIcpEmail,
      `ICP submitted: ${client.firstName} ${client.lastName}`,
      `${client.businessName} just submitted their ICP questionnaire.`,
    );
  }
  await logActivity("icp_submitted", `${client.firstName} ${client.lastName} submitted the ICP`, client.id);
  // Mark every published `icp`-kind episode as completed for this client. The
  // ICP page is wired into the modules tree as a special episode kind, so a
  // submission must propagate to episodeProgress — otherwise the modules page
  // keeps showing "needs to start" even after a successful submission.
  const icpEpisodes = await db
    .select()
    .from(episodesTable)
    .where(and(eq(episodesTable.published, true), eq(episodesTable.kind, "icp")));
  for (const ep of icpEpisodes) {
    await db
      .insert(episodeProgressTable)
      .values({ clientId: client.id, episodeId: ep.id, completedAt: now })
      .onConflictDoUpdate({
        target: [episodeProgressTable.clientId, episodeProgressTable.episodeId],
        set: { completedAt: now },
      });
  }
  res.json({
    answers: row.answers ?? {},
    submitted: row.submitted,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    savedAt: row.savedAt?.toISOString() ?? null,
  });
});

export default router;
