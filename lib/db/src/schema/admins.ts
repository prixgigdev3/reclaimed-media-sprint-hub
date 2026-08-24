import { pgTable, serial, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const adminUsersTable = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  email: varchar("email").notNull().unique(),
  name: text("name"),
  role: varchar("role").notNull().default("admin"),
  // Scope allowlist. Empty array (default) = full access. Otherwise the admin
  // can only see/use the listed sections, e.g. ["support"] for a support-only
  // operator like Tom. Valid values mirror the AdminLayout nav keys:
  // "dashboard" | "clients" | "content" | "agreements" | "analytics" |
  // "support" | "settings" | "admins".
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  userId: varchar("user_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminUserRow = typeof adminUsersTable.$inferSelect;
