import { pgTable, serial, integer, text, varchar, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { adminUsersTable } from "./admins";

export const clientDocumentsTable = pgTable("client_documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  // Self-referential parent for nested folders. Null = lives at the client's
  // documents root. We do recursive cascade in code on delete (not DB-level)
  // so we can also clean up object storage entries for any descendant files.
  parentId: integer("parent_id").references((): AnyPgColumn => clientDocumentsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // "folder" — container only, no file/link
  // "file"   — uploaded asset stored in object storage
  // "link"   — external URL
  kind: varchar("kind").notNull().default("file"),
  fileObjectKey: text("file_object_key"),
  linkUrl: text("link_url"),
  originalFilename: text("original_filename"),
  mimeType: varchar("mime_type"),
  sizeBytes: integer("size_bytes"),
  uploadedByAdminId: integer("uploaded_by_admin_id").references(() => adminUsersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ClientDocument = typeof clientDocumentsTable.$inferSelect;
