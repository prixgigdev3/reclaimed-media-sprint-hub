import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { episodesTable } from "./modules";
import { adminUsersTable } from "./admins";

// Admin-uploaded resources attached to an episode (templates, swipe files,
// reference PDFs). Visible to every client who can see the episode.
export const episodeAssetsTable = pgTable("episode_assets", {
  id: serial("id").primaryKey(),
  episodeId: integer("episode_id").notNull().references(() => episodesTable.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  // /objects/<...> path returned from the storage upload flow.
  objectPath: varchar("object_path").notNull(),
  contentType: varchar("content_type").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  uploadedByAdminId: integer("uploaded_by_admin_id").references(() => adminUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Deliverables the client submits against an episode. Two flavours:
//   kind="file" — uploaded asset stored in object storage (objectPath set,
//                 linkUrl null). Original behaviour, kept as the default.
//   kind="link" — external URL the client wants to share (Google Drive,
//                 Dropbox, Figma, Loom, etc). linkUrl set, objectPath null.
// Optionally tied to a specific checklist item id (matching
// `episodes.checklistItems[].id`) so admins can see exactly which
// deliverable the entry satisfies.
export const clientUploadsTable = pgTable("client_uploads", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  episodeId: integer("episode_id").notNull().references(() => episodesTable.id, { onDelete: "cascade" }),
  checklistItemId: integer("checklist_item_id"),
  name: varchar("name").notNull(),
  // "file" | "link". Default keeps existing rows working without a backfill.
  kind: varchar("kind").notNull().default("file"),
  // Set when kind="file"; null when kind="link".
  objectPath: varchar("object_path"),
  // Set when kind="link"; null when kind="file".
  linkUrl: text("link_url"),
  contentType: varchar("content_type").notNull().default(""),
  sizeBytes: integer("size_bytes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EpisodeAsset = typeof episodeAssetsTable.$inferSelect;
export type ClientUpload = typeof clientUploadsTable.$inferSelect;
