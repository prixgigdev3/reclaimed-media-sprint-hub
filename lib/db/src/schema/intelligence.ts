import {
  pgTable,
  serial,
  integer,
  text,
  varchar,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { supportTicketsTable } from "./support";

/**
 * One row per resolved support ticket once the client has rated their
 * experience. Two scores so we can separate "did the answer actually solve
 * the problem?" from "was the experience getting there pleasant?".
 *
 *  - resolutionRating: 1-5, did this resolve your issue?
 *  - processRating:    1-5, how was the experience working with us?
 *  - comment:          optional free-text feedback (capped at 4kB).
 *
 * Unique on ticketId so re-rating the same ticket replaces the row via
 * onConflictDoUpdate at write time.
 */
export const supportTicketRatingsTable = pgTable("support_ticket_ratings", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .unique()
    .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  resolutionRating: integer("resolution_rating").notNull(),
  processRating: integer("process_rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupportTicketRating = typeof supportTicketRatingsTable.$inferSelect;

/**
 * Cached "client health" snapshot used by the admin intelligence dashboard.
 * Recomputed on demand (TTL ~6 hours, or on explicit refresh) because the
 * raw signal data is cheap but the AI-generated narrative isn't.
 *
 *  - score:    0-100 heuristic from deterministic signals
 *  - tone:     "green" | "amber" | "red"
 *  - headline: one-sentence summary suitable for table rows
 *  - narrative: longer, AI-written analysis for the per-client view
 *  - signals:  raw signal bag the score was computed from (for transparency
 *              and debugging — UI surfaces a "why this score" breakdown)
 */
export const clientHealthSummariesTable = pgTable("client_health_summaries", {
  clientId: integer("client_id")
    .primaryKey()
    .references(() => clientsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  tone: varchar("tone").notNull(),
  headline: text("headline").notNull().default(""),
  narrative: text("narrative").notNull().default(""),
  signals: jsonb("signals").notNull().default({}),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ClientHealthSummary = typeof clientHealthSummariesTable.$inferSelect;
