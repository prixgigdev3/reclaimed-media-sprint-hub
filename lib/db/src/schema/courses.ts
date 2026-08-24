import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { adminUsersTable } from "./admins";

export const coursesTable = pgTable("courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const clientCoursesTable = pgTable(
  "client_courses",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    courseId: integer("course_id").notNull().references(() => coursesTable.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedByAdminId: integer("assigned_by_admin_id").references(() => adminUsersTable.id, { onDelete: "set null" }),
  },
  (t) => ({
    uniqClientCourse: uniqueIndex("client_courses_client_course_uq").on(t.clientId, t.courseId),
  }),
);

export type Course = typeof coursesTable.$inferSelect;
export type ClientCourse = typeof clientCoursesTable.$inferSelect;
