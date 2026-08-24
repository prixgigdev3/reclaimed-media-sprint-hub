import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  apiKey: text("api_key").notNull().default(""),
  businessManagerId: text("business_manager_id").notNull().default(""),
  notifyOnIcp: boolean("notify_on_icp").notNull().default(true),
  notifyOnFirstLogin: boolean("notify_on_first_login").notNull().default(true),
  notifyOnAllComplete: boolean("notify_on_all_complete").notNull().default(true),
  notifyIcpEmail: text("notify_icp_email").notNull().default(""),
  notifyFirstLoginEmail: text("notify_first_login_email").notNull().default(""),
  notifyAllCompleteEmail: text("notify_all_complete_email").notNull().default(""),
  supportEmail: text("support_email").notNull().default(""),
  curriculumVersion: text("curriculum_version").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Settings = typeof settingsTable.$inferSelect;
