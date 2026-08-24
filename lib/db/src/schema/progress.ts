import { pgTable, serial, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { episodesTable } from "./modules";

export const episodeProgressTable = pgTable(
  "episode_progress",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    episodeId: integer("episode_id").notNull().references(() => episodesTable.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    checklistChecked: jsonb("checklist_checked").$type<number[]>().notNull().default([]),
    checklistResponses: jsonb("checklist_responses").$type<Record<string, string>>().notNull().default({}),
    positionSeconds: integer("position_seconds").notNull().default(0),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    watchCount: integer("watch_count").notNull().default(0),
    lastWatchedAt: timestamp("last_watched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("episode_progress_client_episode_idx").on(t.clientId, t.episodeId)],
);

export type EpisodeProgress = typeof episodeProgressTable.$inferSelect;
