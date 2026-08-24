import { eq, sql, inArray, and, isNotNull } from "drizzle-orm";
import {
  db,
  clientsTable,
  icpResponsesTable,
  agreementAssignmentsTable,
  episodeProgressTable,
  episodesTable,
  supportTicketsTable,
  supportTicketRatingsTable,
  clientHealthSummariesTable,
  type Client,
} from "@workspace/db";
import { openai, aiAvailable } from "./openai";
import { logger } from "./logger";

/**
 * Per-client raw signal bag. All fields are populated even if the source
 * data is missing — `null` means "no data yet" and is treated differently
 * from a 0 by the scoring function.
 */
export interface ClientSignals {
  daysSinceInvite: number | null;
  daysSinceLastLogin: number | null;
  tutorialCompleted: boolean;
  termsAccepted: boolean;

  icpSubmitted: boolean;
  icpDaysToSubmit: number | null;

  agreements: {
    assigned: number;
    signed: number;
    avgDaysToSign: number | null;
    maxDaysWaiting: number | null;
  };

  episodes: {
    total: number;
    completed: number;
    percentComplete: number;
    daysSinceLastWatch: number | null;
    everStarted: boolean;
  };

  support: {
    totalTickets: number;
    openTickets: number;
    ratedTickets: number;
    avgResolutionRating: number | null;
    avgProcessRating: number | null;
  };

  sprint: {
    started: boolean;
    daysSinceStart: number | null;
    postSprintStatus: string | null;
  };
}

export interface ScoredHealth {
  score: number;
  tone: "green" | "amber" | "red";
  headline: string;
  flags: string[];
  positives: string[];
  signals: ClientSignals;
}

const DAY = 1000 * 60 * 60 * 24;
const daysBetween = (a: Date, b: Date): number => Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY));

/**
 * Pull every behavioural signal we have for a single client. Six small
 * indexed queries — fast even on a cold cache.
 */
export async function loadSignals(client: Client, now: Date = new Date()): Promise<ClientSignals> {
  const id = client.id;

  const [icp] = await db.select().from(icpResponsesTable).where(eq(icpResponsesTable.clientId, id));
  const assignments = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(eq(agreementAssignmentsTable.clientId, id));

  const totalEpisodesRow = await db.select({ n: sql<number>`count(*)::int` }).from(episodesTable);
  const totalEpisodes = Number(totalEpisodesRow[0]?.n ?? 0);
  const progress = await db
    .select()
    .from(episodeProgressTable)
    .where(eq(episodeProgressTable.clientId, id));

  const tickets = await db
    .select()
    .from(supportTicketsTable)
    .where(eq(supportTicketsTable.clientId, id));
  const ratings = tickets.length
    ? await db
        .select()
        .from(supportTicketRatingsTable)
        .where(inArray(supportTicketRatingsTable.ticketId, tickets.map((t) => t.id)))
    : [];

  // ---- Compute derived values ----
  const daysSinceInvite = client.inviteSentAt ? daysBetween(client.inviteSentAt, now) : null;
  const daysSinceLastLogin = client.lastLoginAt ? daysBetween(client.lastLoginAt, now) : null;

  const icpSubmitted = !!icp?.submitted;
  const icpDaysToSubmit =
    icpSubmitted && icp?.submittedAt && client.inviteSentAt
      ? daysBetween(client.inviteSentAt, icp.submittedAt)
      : null;

  const signedAssignments = assignments.filter((a) => a.clientSignedAt);
  const signDelays = signedAssignments
    .map((a) => (a.clientSignedAt && a.assignedAt ? daysBetween(a.assignedAt, a.clientSignedAt) : null))
    .filter((n): n is number => n !== null);
  const unsignedDelays = assignments
    .filter((a) => !a.clientSignedAt)
    .map((a) => daysBetween(a.assignedAt, now));

  const completedEpisodes = progress.filter((p) => p.completedAt).length;
  const lastWatchTimes = progress
    .map((p) => p.lastWatchedAt)
    .filter((d): d is Date => d instanceof Date);
  const lastWatchAt = lastWatchTimes.length
    ? lastWatchTimes.reduce((a, b) => (a > b ? a : b))
    : null;

  const openTickets = tickets.filter((t) => t.status === "open").length;
  const resolutionRatings = ratings.map((r) => r.resolutionRating);
  const processRatings = ratings.map((r) => r.processRating);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const sprintStartedAt = client.sprintStartedAt;
  const daysSinceStart = sprintStartedAt ? daysBetween(sprintStartedAt, now) : null;

  return {
    daysSinceInvite,
    daysSinceLastLogin,
    tutorialCompleted: !!client.tutorialCompletedAt,
    termsAccepted: !!client.acceptedTermsAt,
    icpSubmitted,
    icpDaysToSubmit,
    agreements: {
      assigned: assignments.length,
      signed: signedAssignments.length,
      avgDaysToSign: signDelays.length ? Math.round(avg(signDelays) as number) : null,
      maxDaysWaiting: unsignedDelays.length ? Math.max(...unsignedDelays) : null,
    },
    episodes: {
      total: totalEpisodes,
      completed: completedEpisodes,
      percentComplete: totalEpisodes ? Math.round((completedEpisodes / totalEpisodes) * 100) : 0,
      daysSinceLastWatch: lastWatchAt ? daysBetween(lastWatchAt, now) : null,
      everStarted: progress.length > 0,
    },
    support: {
      totalTickets: tickets.length,
      openTickets,
      ratedTickets: ratings.length,
      avgResolutionRating: avg(resolutionRatings),
      avgProcessRating: avg(processRatings),
    },
    sprint: {
      started: !!sprintStartedAt,
      daysSinceStart,
      postSprintStatus: client.postSprintStatus ?? null,
    },
  };
}

/**
 * Deterministic scoring over the signal bag. Every adjustment is paired
 * with a human-readable flag (negative) or positive note so admins can
 * see the "why" behind the number, not just the number.
 *
 * Score is anchored at 50 (neutral) and clamped to 0-100.
 *  - 70+ green:  strong, low-touch
 *  - 45-69 amber: needs attention
 *  - <45 red:    at risk
 */
export function scoreSignals(s: ClientSignals): ScoredHealth {
  let score = 50;
  const flags: string[] = [];
  const positives: string[] = [];

  // ----- Login activity -----
  if (s.daysSinceLastLogin === null) {
    score -= 15;
    flags.push("Has never logged in");
  } else if (s.daysSinceLastLogin > 21) {
    score -= 12;
    flags.push(`Hasn't logged in for ${s.daysSinceLastLogin} days`);
  } else if (s.daysSinceLastLogin > 7) {
    score -= 4;
    flags.push(`Last login ${s.daysSinceLastLogin} days ago`);
  } else {
    score += 5;
    positives.push("Logging in regularly");
  }

  // ----- Onboarding (tutorial + terms) -----
  if (s.daysSinceInvite !== null && s.daysSinceInvite > 3 && !s.tutorialCompleted) {
    score -= 3;
    flags.push("Has not completed the welcome tutorial");
  }

  // ----- ICP submission -----
  if (!s.icpSubmitted) {
    if (s.daysSinceInvite !== null && s.daysSinceInvite > 14) {
      score -= 12;
      flags.push(`ICP not submitted ${s.daysSinceInvite} days after invite`);
    } else if (s.daysSinceInvite !== null && s.daysSinceInvite > 7) {
      score -= 5;
      flags.push("ICP still outstanding (1+ week)");
    }
  } else if (s.icpDaysToSubmit !== null) {
    if (s.icpDaysToSubmit <= 3) {
      score += 8;
      positives.push(`Completed ICP in ${s.icpDaysToSubmit} day${s.icpDaysToSubmit === 1 ? "" : "s"}`);
    } else if (s.icpDaysToSubmit <= 7) {
      score += 4;
      positives.push("ICP submitted within a week");
    }
  }

  // ----- Agreements -----
  const a = s.agreements;
  if (a.assigned > 0) {
    if (a.signed === a.assigned) {
      if (a.avgDaysToSign !== null && a.avgDaysToSign <= 2) {
        score += 8;
        positives.push("Signs agreements quickly");
      } else if (a.avgDaysToSign !== null && a.avgDaysToSign <= 7) {
        score += 3;
      }
    } else if (a.maxDaysWaiting !== null) {
      if (a.maxDaysWaiting > 14) {
        score -= 12;
        flags.push(`Agreement unsigned for ${a.maxDaysWaiting} days`);
      } else if (a.maxDaysWaiting > 7) {
        score -= 5;
        flags.push(`Agreement waiting on signature (${a.maxDaysWaiting}d)`);
      }
    }
  }

  // ----- Episode progress -----
  const ep = s.episodes;
  if (ep.total > 0) {
    if (!ep.everStarted) {
      score -= 6;
      flags.push("Has not started any episodes");
    } else if (ep.daysSinceLastWatch !== null && ep.daysSinceLastWatch > 14) {
      score -= 10;
      flags.push(`No content activity for ${ep.daysSinceLastWatch} days`);
    } else if (ep.daysSinceLastWatch !== null && ep.daysSinceLastWatch > 7) {
      score -= 4;
    }
    if (ep.percentComplete >= 90) {
      score += 14;
      positives.push(`${ep.percentComplete}% through the program`);
    } else if (ep.percentComplete >= 60) {
      score += 8;
      positives.push(`${ep.percentComplete}% through the program`);
    } else if (ep.percentComplete >= 30) {
      score += 3;
    }
  }

  // ----- Support intensity -----
  const sup = s.support;
  if (sup.totalTickets > 8) {
    score -= 6;
    flags.push(`${sup.totalTickets} support tickets — high volume`);
  } else if (sup.totalTickets > 4) {
    score -= 2;
  }
  if (sup.openTickets > 2) {
    score -= 4;
    flags.push(`${sup.openTickets} open support tickets`);
  }

  // ----- Support sentiment -----
  if (sup.avgResolutionRating !== null) {
    const r = sup.avgResolutionRating;
    if (r >= 4.5) {
      score += 10;
      positives.push(`Loves our support (${r.toFixed(1)}/5 resolution)`);
    } else if (r >= 3.5) {
      score += 4;
    } else if (r < 2.5) {
      score -= 12;
      flags.push(`Low resolution satisfaction (${r.toFixed(1)}/5)`);
    } else if (r < 3) {
      score -= 5;
      flags.push(`Mediocre resolution satisfaction (${r.toFixed(1)}/5)`);
    }
  }
  if (sup.avgProcessRating !== null) {
    const r = sup.avgProcessRating;
    if (r >= 4.5) {
      score += 6;
    } else if (r < 2.5) {
      score -= 8;
      flags.push(`Unhappy with process (${r.toFixed(1)}/5)`);
    }
  }

  // ----- Continuity -----
  switch (s.sprint.postSprintStatus) {
    case "monthly":
      score += 15;
      positives.push("Continued onto the monthly retainer");
      break;
    case "paused":
      score -= 4;
      flags.push("Currently paused");
      break;
    case "offboarded":
      score -= 20;
      flags.push("Offboarded");
      break;
  }

  // Clamp + classify.
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tone: ScoredHealth["tone"] = score >= 70 ? "green" : score >= 45 ? "amber" : "red";

  // One-sentence headline. Pulls the most salient flag/positive.
  let headline: string;
  if (tone === "red") {
    headline = flags[0] ?? "Multiple risk signals — needs attention";
  } else if (tone === "green") {
    headline = positives[0] ?? "Engaged and on track";
  } else {
    headline = flags[0] ?? positives[0] ?? "Mixed signals — keep an eye on this one";
  }

  return { score, tone, headline, flags, positives, signals: s };
}

/**
 * Compose a short admin-facing narrative using the LLM. Falls back to a
 * deterministic summary if AI isn't available so the dashboard still
 * works offline / without the integration.
 */
export async function narrateHealth(client: Client, health: ScoredHealth): Promise<string> {
  if (!aiAvailable()) return fallbackNarrative(client, health);
  const name = `${client.firstName} ${client.lastName}`.trim();
  const facts = [
    `Status: ${health.tone.toUpperCase()} (${health.score}/100)`,
    `Login: ${health.signals.daysSinceLastLogin === null ? "never" : `${health.signals.daysSinceLastLogin}d ago`}`,
    `ICP: ${health.signals.icpSubmitted ? `submitted in ${health.signals.icpDaysToSubmit ?? "?"}d` : "not submitted"}`,
    `Agreements: ${health.signals.agreements.signed}/${health.signals.agreements.assigned} signed${health.signals.agreements.maxDaysWaiting !== null ? `, oldest waiting ${health.signals.agreements.maxDaysWaiting}d` : ""}`,
    `Content: ${health.signals.episodes.percentComplete}% complete (${health.signals.episodes.completed}/${health.signals.episodes.total}), last watched ${health.signals.episodes.daysSinceLastWatch ?? "never"}${health.signals.episodes.daysSinceLastWatch === null ? "" : "d ago"}`,
    `Support: ${health.signals.support.totalTickets} tickets (${health.signals.support.openTickets} open), avg resolution rating ${health.signals.support.avgResolutionRating?.toFixed(1) ?? "n/a"}/5, avg process rating ${health.signals.support.avgProcessRating?.toFixed(1) ?? "n/a"}/5`,
    `Sprint: ${health.signals.sprint.started ? `started ${health.signals.sprint.daysSinceStart}d ago` : "not started"}${health.signals.sprint.postSprintStatus ? `, post-sprint=${health.signals.sprint.postSprintStatus}` : ""}`,
    `Flags: ${health.flags.join("; ") || "none"}`,
    `Positives: ${health.positives.join("; ") || "none"}`,
  ].join("\n");

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-5.4",
      messages: [
        {
          role: "system",
          content:
            "You are an account-management analyst for a coaching agency. Given a client's behavioural signals, write a calm, factual 3-4 sentence assessment for the agency's admin team. Cover (1) overall health, (2) the strongest positive or risk signal, (3) one concrete next action. Plain prose — no bullets, no headings, no emojis. Do not invent facts not in the signals. Refer to the client by first name.",
        },
        {
          role: "user",
          content: `Client: ${name}\n\nSignals:\n${facts}`,
        },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim();
    return text || fallbackNarrative(client, health);
  } catch (err) {
    logger.warn({ err, clientId: client.id }, "narrateHealth: AI call failed, falling back");
    return fallbackNarrative(client, health);
  }
}

function fallbackNarrative(client: Client, h: ScoredHealth): string {
  const name = client.firstName || "This client";
  const intro =
    h.tone === "green"
      ? `${name} is in good shape (${h.score}/100).`
      : h.tone === "amber"
        ? `${name}'s engagement is mixed (${h.score}/100).`
        : `${name} is showing risk signals (${h.score}/100).`;
  const detail = h.flags.length ? ` Watch: ${h.flags.slice(0, 2).join("; ")}.` : "";
  const good = h.positives.length ? ` Positives: ${h.positives.slice(0, 2).join("; ")}.` : "";
  return `${intro}${detail}${good}`.trim();
}

/**
 * High-level entry point. Loads signals, scores them, and (optionally)
 * generates an AI narrative. The narrative is cached in
 * client_health_summaries; pass `forceRefresh: true` to bypass the cache.
 */
export async function computeClientHealth(
  client: Client,
  opts: { withNarrative?: boolean; forceRefresh?: boolean } = {},
): Promise<ScoredHealth & { narrative: string; generatedAt: string }> {
  const signals = await loadSignals(client);
  const scored = scoreSignals(signals);

  let narrative = "";
  let generatedAt = new Date().toISOString();

  if (opts.withNarrative) {
    const [cached] = await db
      .select()
      .from(clientHealthSummariesTable)
      .where(eq(clientHealthSummariesTable.clientId, client.id));
    const ageMs = cached ? Date.now() - cached.generatedAt.getTime() : Infinity;
    const stale = ageMs > 6 * 60 * 60 * 1000; // 6h TTL
    const scoreDrift = cached ? Math.abs(cached.score - scored.score) >= 5 : true;

    if (cached && !opts.forceRefresh && !stale && !scoreDrift) {
      narrative = cached.narrative;
      generatedAt = cached.generatedAt.toISOString();
    } else {
      narrative = await narrateHealth(client, scored);
      generatedAt = new Date().toISOString();
      await db
        .insert(clientHealthSummariesTable)
        .values({
          clientId: client.id,
          score: scored.score,
          tone: scored.tone,
          headline: scored.headline,
          narrative,
          signals: scored.signals as unknown as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: clientHealthSummariesTable.clientId,
          set: {
            score: scored.score,
            tone: scored.tone,
            headline: scored.headline,
            narrative,
            signals: scored.signals as unknown as Record<string, unknown>,
            generatedAt: new Date(),
          },
        });
    }
  }

  return { ...scored, narrative, generatedAt };
}

/**
 * Bulk version for the dashboard list. Skips the AI narrative entirely
 * (cheap — pure DB + arithmetic). Returns a lightweight row per client.
 */
export interface HealthRow {
  clientId: number;
  firstName: string;
  lastName: string;
  email: string;
  businessName: string;
  status: string;
  score: number;
  tone: "green" | "amber" | "red";
  headline: string;
  topFlag: string | null;
}

export async function loadAllClientHealth(): Promise<HealthRow[]> {
  const clients = await db.select().from(clientsTable);
  // Parallelise per-client signal loading — each call is several small
  // indexed queries, so fanning out keeps the dashboard snappy at the
  // hundreds-of-clients scale we expect.
  const out = await Promise.all(
    clients.map(async (c): Promise<HealthRow> => {
      const signals = await loadSignals(c);
      const scored = scoreSignals(signals);
      return {
        clientId: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        businessName: c.businessName,
        status: c.status,
        score: scored.score,
        tone: scored.tone,
        headline: scored.headline,
        topFlag: scored.flags[0] ?? null,
      };
    }),
  );
  // Worst-first so admins see who needs attention immediately.
  out.sort((a, b) => a.score - b.score);
  return out;
}

void and;
void isNotNull;
