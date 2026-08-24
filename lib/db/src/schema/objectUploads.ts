import { pgTable, text, varchar, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Registry of every object-storage path issued via /storage/uploads/request-url.
 *
 * Recording the issuer at upload time is the *only* way to safely authorize
 * later access to a private object: it lets us reject "rebinding" attacks
 * where a malicious client takes another tenant's known objectPath and
 * attaches it to a row they own (e.g. a support attachment, a client upload),
 * which would otherwise pass any per-row ownership check.
 *
 * Every client-supplied objectPath in /me/* writes must be validated against
 * this table (owner == requesting client). /me/files/*path serves files
 * authoritatively from this registry, not from the join row.
 */
export const objectUploadsTable = pgTable("object_uploads", {
  // The canonical "/objects/<id>" path returned by ObjectStorageService.
  objectPath: text("object_path").primaryKey(),
  // 'client' or 'admin' — who requested the upload URL.
  ownerType: varchar("owner_type").notNull(),
  // Their row id in clients/admin_users respectively.
  ownerId: integer("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ObjectUpload = typeof objectUploadsTable.$inferSelect;
