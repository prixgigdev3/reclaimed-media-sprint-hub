import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  subject: varchar("subject").notNull(),
  body: text("body").notNull(),
  status: varchar("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // Updated whenever a new message is posted, so admin inboxes can sort by
  // most-recent activity rather than original creation date.
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("support_tickets_client_idx").on(t.clientId, t.lastMessageAt),
  index("support_tickets_status_idx").on(t.status, t.lastMessageAt),
]);

export const supportTicketMessagesTable = pgTable("support_ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
  // 'client' or 'admin'. We keep the actor's display name + email at write
  // time so the thread is readable even if the underlying user record
  // changes later (rename, deletion, etc).
  authorType: varchar("author_type").notNull(),
  authorId: integer("author_id"),
  authorName: varchar("author_name").notNull(),
  authorEmail: varchar("author_email").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("support_messages_ticket_idx").on(t.ticketId, t.createdAt),
]);

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type SupportTicketMessage = typeof supportTicketMessagesTable.$inferSelect;
