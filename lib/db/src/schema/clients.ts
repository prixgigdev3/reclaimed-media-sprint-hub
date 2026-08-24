import { pgTable, serial, text, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"),
  email: varchar("email").notNull().unique(),
  firstName: varchar("first_name").notNull(),
  lastName: varchar("last_name").notNull(),
  businessName: varchar("business_name").notNull(),
  phone: varchar("phone"),
  sprintStartDate: date("sprint_start_date"),
  // Set automatically the first time the client meets the prerequisites for
  // the 22-day sprint countdown (agreement signed + ICP submitted + every
  // published episode marked complete). Once set it never moves backwards.
  sprintStartedAt: timestamp("sprint_started_at", { withTimezone: true }),
  // Set by an admin once the 22-day sprint window has elapsed. Tracks what
  // happens next: "monthly" (continuing on retainer), "offboarded", or
  // "paused". Null while the sprint is still active or pending review.
  postSprintStatus: varchar("post_sprint_status"),
  status: varchar("status").notNull().default("invited"),
  inviteSentAt: timestamp("invite_sent_at", { withTimezone: true }).defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  inviteToken: varchar("invite_token"),
  tutorialCompletedAt: timestamp("tutorial_completed_at", { withTimezone: true }),
  acceptedTermsAt: timestamp("accepted_terms_at", { withTimezone: true }),
  consentIp: varchar("consent_ip"),
  consentUserAgent: text("consent_user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Client = typeof clientsTable.$inferSelect;
export type InsertClient = typeof clientsTable.$inferInsert;
