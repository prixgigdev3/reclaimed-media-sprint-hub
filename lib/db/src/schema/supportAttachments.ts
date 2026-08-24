import { pgTable, serial, integer, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { supportTicketMessagesTable } from "./support";

/**
 * Attachments to a support ticket message: pasted links (e.g. Loom),
 * uploaded screenshots, or other files. Files are stored in object storage
 * and served back via the /me/files/* proxy.
 */
export const supportAttachmentsTable = pgTable("support_attachments", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id")
    .notNull()
    .references(() => supportTicketMessagesTable.id, { onDelete: "cascade" }),
  // 'image' | 'file' | 'link'
  kind: varchar("kind").notNull(),
  // Display name (filename or link label / hostname).
  name: varchar("name").notNull(),
  // For uploads: the object storage path. For links: null.
  objectPath: text("object_path"),
  // For links: the URL. For uploads: null (use objectPath).
  url: text("url"),
  contentType: varchar("content_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SupportAttachment = typeof supportAttachmentsTable.$inferSelect;
