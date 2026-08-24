import { pgTable, serial, text, integer, timestamp, varchar, jsonb, index } from "drizzle-orm/pg-core";

export const activityEventsTable = pgTable(
  "activity_events",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind").notNull(),
    message: text("message").notNull(),
    clientId: integer("client_id"),
    actorType: varchar("actor_type"),
    actorId: integer("actor_id"),
    actorEmail: varchar("actor_email"),
    ip: varchar("ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_events_client_idx").on(t.clientId, t.createdAt),
    index("activity_events_kind_idx").on(t.kind),
  ],
);

export type ActivityEvent = typeof activityEventsTable.$inferSelect;
