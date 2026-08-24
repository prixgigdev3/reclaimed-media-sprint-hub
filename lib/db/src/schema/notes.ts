import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export const clientNotesTable = pgTable("client_notes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  authorName: varchar("author_name").notNull().default("Admin"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClientNote = typeof clientNotesTable.$inferSelect;
