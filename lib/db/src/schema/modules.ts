import { pgTable, serial, text, integer, boolean, timestamp, jsonb, varchar, index } from "drizzle-orm/pg-core";

export const modulesTable = pgTable("modules", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
  published: boolean("published").notNull().default(true),
  courseId: integer("course_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("modules_course_idx").on(t.courseId, t.position),
]);

export type ChecklistItemKind = "check" | "url" | "text";
export type ChecklistItem = {
  id: number;
  label: string;
  kind?: ChecklistItemKind;
  required?: boolean;
};

export const episodesTable = pgTable("episodes", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  videoUrl: text("video_url"),
  copy: text("copy").notNull().default(""),
  position: integer("position").notNull().default(0),
  published: boolean("published").notNull().default(true),
  requirePrevious: boolean("require_previous").notNull().default(true),
  kind: varchar("kind").notNull().default("standard"),
  checklistItems: jsonb("checklist_items").$type<ChecklistItem[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("episodes_module_idx").on(t.moduleId, t.position),
]);

export type Module = typeof modulesTable.$inferSelect;
export type Episode = typeof episodesTable.$inferSelect;
