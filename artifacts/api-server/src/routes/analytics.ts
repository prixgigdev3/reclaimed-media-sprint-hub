import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  clientsTable,
  episodesTable,
  episodeProgressTable,
  activityEventsTable,
  agreementAssignmentsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/access";

const router: IRouter = Router();

router.get("/admin/clients/:id/analytics", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const clientId = parseInt(String(req.params.id), 10);
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const allEpisodes = await db.select().from(episodesTable).where(eq(episodesTable.published, true));
  const progress = await db
    .select()
    .from(episodeProgressTable)
    .where(eq(episodeProgressTable.clientId, clientId));
  const progressByEp = new Map(progress.map((p) => [p.episodeId, p]));

  const episodeStats = allEpisodes.map((e) => {
    const p = progressByEpisode(e.id, progressByEp);
    return {
      episodeId: e.id,
      title: e.title,
      moduleId: e.moduleId,
      completed: !!p?.completedAt,
      completedAt: p?.completedAt?.toISOString() ?? null,
      positionSeconds: p?.positionSeconds ?? 0,
      durationSeconds: p?.durationSeconds ?? 0,
      watchCount: p?.watchCount ?? 0,
      lastWatchedAt: p?.lastWatchedAt?.toISOString() ?? null,
    };
  });

  const totalWatchSeconds = progress.reduce((sum, p) => sum + (p.positionSeconds || 0), 0);
  const completed = progress.filter((p) => p.completedAt).length;

  // login events
  const logins = await db
    .select()
    .from(activityEventsTable)
    .where(and(eq(activityEventsTable.clientId, clientId), eq(activityEventsTable.kind, "login")))
    .orderBy(desc(activityEventsTable.createdAt))
    .limit(50);

  // recent activity (any kind)
  const recentActivity = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.clientId, clientId))
    .orderBy(desc(activityEventsTable.createdAt))
    .limit(100);

  // agreements summary
  const agreements = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(eq(agreementAssignmentsTable.clientId, clientId));
  const agreementsSummary = {
    total: agreements.length,
    pending: agreements.filter((a) => a.status === "pending" || a.status === "viewed").length,
    clientSigned: agreements.filter((a) => a.status === "client_signed").length,
    completed: agreements.filter((a) => a.status === "completed").length,
  };

  res.json({
    client: {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      lastLoginAt: client.lastLoginAt?.toISOString() ?? null,
      createdAt: client.createdAt.toISOString(),
    },
    summary: {
      loginCount: logins.length,
      lastLoginAt: client.lastLoginAt?.toISOString() ?? null,
      totalEpisodes: allEpisodes.length,
      completedEpisodes: completed,
      progressPercent: allEpisodes.length > 0 ? Math.round((completed / allEpisodes.length) * 100) : 0,
      totalWatchSeconds,
    },
    agreements: agreementsSummary,
    episodes: episodeStats,
    logins: logins.map((l) => ({
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      ip: l.ip ?? null,
      userAgent: l.userAgent ?? null,
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      kind: a.kind,
      message: a.message,
      ip: a.ip ?? null,
      userAgent: a.userAgent ?? null,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
  });
});

router.get("/admin/clients/:id/activity", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const clientId = parseInt(String(req.params.id), 10);
  const limit = Math.min(parseInt(String(req.query.limit ?? "200"), 10) || 200, 500);
  const rows = await db
    .select()
    .from(activityEventsTable)
    .where(eq(activityEventsTable.clientId, clientId))
    .orderBy(desc(activityEventsTable.createdAt))
    .limit(limit);
  res.json(
    rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      message: a.message,
      ip: a.ip ?? null,
      userAgent: a.userAgent ?? null,
      actorType: a.actorType ?? null,
      actorEmail: a.actorEmail ?? null,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
  );
});

router.get("/admin/analytics/overview", async (req: Request, res: Response): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const clients = await db.select().from(clientsTable);
  const progress = await db.select().from(episodeProgressTable);
  const allEpisodes = await db.select().from(episodesTable).where(eq(episodesTable.published, true));

  const totalEpisodes = allEpisodes.length;
  const totalWatchSeconds = progress.reduce((s, p) => s + (p.positionSeconds || 0), 0);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const recentLogins = await db
    .select({ count: sql<number>`count(*)` })
    .from(activityEventsTable)
    .where(and(eq(activityEventsTable.kind, "login"), sql`${activityEventsTable.createdAt} > ${sevenDaysAgo}`));

  const agreements = await db.select().from(agreementAssignmentsTable);

  res.json({
    totalClients: clients.length,
    activeClients: clients.filter((c) => c.lastLoginAt).length,
    loginsLast7Days: Number(recentLogins[0]?.count ?? 0),
    totalEpisodes,
    totalWatchSeconds,
    agreements: {
      total: agreements.length,
      pending: agreements.filter((a) => a.status === "pending" || a.status === "viewed").length,
      completed: agreements.filter((a) => a.status === "completed").length,
    },
  });
});

function progressByEpisode(
  epId: number,
  map: Map<number, typeof episodeProgressTable.$inferSelect>,
): typeof episodeProgressTable.$inferSelect | undefined {
  return map.get(epId);
}

export default router;
