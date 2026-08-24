import { pgTable, serial, integer, text, varchar, timestamp, index } from "drizzle-orm/pg-core";

/**
 * In-app notifications surfaced via the bell icon in both client and admin
 * portals. `audience` + `userId` together identify the recipient.
 *
 *   audience = 'client' → userId references clientsTable.id
 *   audience = 'admin'  → userId references adminUsersTable.id
 *
 * `link` is a frontend route the bell click should navigate to (e.g.
 * "/support" for clients, "/admin/support" for admins).
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  audience: varchar("audience").notNull(),
  userId: integer("user_id").notNull(),
  kind: varchar("kind").notNull(),
  title: varchar("title").notNull(),
  body: text("body"),
  link: varchar("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byRecipient: index("notifications_by_recipient_idx").on(t.audience, t.userId, t.readAt),
}));

export type Notification = typeof notificationsTable.$inferSelect;
