import { pgTable, serial, integer, timestamp, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export const icpResponsesTable = pgTable(
  "icp_responses",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    submitted: boolean("submitted").notNull().default(false),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    savedAt: timestamp("saved_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("icp_responses_client_idx").on(t.clientId)],
);

export type IcpResponse = typeof icpResponsesTable.$inferSelect;
