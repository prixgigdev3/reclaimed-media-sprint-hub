import { pgTable, serial, text, integer, varchar, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

export type AgreementFieldType = "signature" | "initial" | "date" | "text" | "name";
export type AgreementFieldRole = "admin" | "client";

export type AgreementField = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: AgreementFieldType;
  role: AgreementFieldRole;
  label?: string;
  required?: boolean;
};

/**
 * Builder agreements are authored inside the platform. The body is a lightly
 * marked-up text (markdown-ish) string that may embed placeholder tokens like
 *   {{name}}                     – client's full name
 *   {{businessName}}             – client's business name
 *   {{date}}                     – signature date (filled at sign-time)
 *   {{initial:section}}          – a small initial box
 *   {{text:Where do you live?}}  – a free-text input with a label
 * Placeholders are extracted from the body server-side so the admin doesn't
 * have to declare them twice.
 */
export type AgreementPlaceholder = {
  key: string;
  label: string;
  type: "text" | "name" | "businessName" | "date" | "initial";
  required?: boolean;
  /**
   * Who fills this placeholder. Defaults to "client" for backward compat.
   * Admin-role placeholders are pre-filled from `defaultValue` and shown
   * read-only to the client at sign time.
   */
  role?: "admin" | "client";
  /**
   * Optional default value. For admin-role placeholders this is the value
   * baked into the document at sign time. For client-role placeholders it
   * pre-populates the input.
   */
  defaultValue?: string;
};

export type AgreementKind = "uploaded" | "builder";

export const agreementTemplatesTable = pgTable("agreement_templates", {
  id: serial("id").primaryKey(),
  kind: varchar("kind").notNull().default("uploaded").$type<AgreementKind>(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  // For uploaded templates these point at the original PDF in object storage.
  // For builder templates they're empty strings (the PDF is rendered at sign-time).
  pdfObjectKey: text("pdf_object_key").notNull().default(""),
  originalFilename: text("original_filename").notNull().default(""),
  pageCount: integer("page_count").notNull().default(1),
  // Uploaded-template overlay fields (drag/drop on the PDF).
  fields: jsonb("fields").$type<AgreementField[]>().notNull().default([]),
  // Builder-template body + extracted placeholders + optional brand logo.
  bodyMarkdown: text("body_markdown").notNull().default(""),
  placeholders: jsonb("placeholders").$type<AgreementPlaceholder[]>().notNull().default([]),
  logoObjectKey: text("logo_object_key"),
  archived: boolean("archived").notNull().default(false),
  createdByAdminId: integer("created_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AgreementTemplate = typeof agreementTemplatesTable.$inferSelect;

export type AgreementFieldValue = {
  fieldId: string;
  type: AgreementFieldType;
  value: string;
  signatureMethod?: "drawn" | "typed";
  signedAt?: string;
};

export const agreementAssignmentsTable = pgTable("agreement_assignments", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => agreementTemplatesTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  status: varchar("status").notNull().default("pending"),
  fieldValues: jsonb("field_values").$type<AgreementFieldValue[]>().notNull().default([]),
  // Builder-only: filled placeholder values keyed by placeholder.key, plus the
  // single signature captured at submit time.
  placeholderValues: jsonb("placeholder_values").$type<Record<string, string>>().notNull().default({}),
  signatureDataUrl: text("signature_data_url"),
  signatureMethod: varchar("signature_method"),
  signedPdfKey: text("signed_pdf_key"),
  clientSignedAt: timestamp("client_signed_at", { withTimezone: true }),
  adminSignedAt: timestamp("admin_signed_at", { withTimezone: true }),
  adminSignedById: integer("admin_signed_by_id"),
  assignedByAdminId: integer("assigned_by_admin_id"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("agreement_assignments_client_idx").on(t.clientId, t.assignedAt),
  index("agreement_assignments_template_idx").on(t.templateId),
]);

export type AgreementAssignment = typeof agreementAssignmentsTable.$inferSelect;

export const agreementEventsTable = pgTable("agreement_events", {
  id: serial("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull().references(() => agreementAssignmentsTable.id, { onDelete: "cascade" }),
  actorType: varchar("actor_type").notNull(),
  actorId: integer("actor_id"),
  actorEmail: varchar("actor_email"),
  kind: varchar("kind").notNull(),
  ip: varchar("ip"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agreement_events_assignment_idx").on(t.assignmentId, t.createdAt),
]);

export type AgreementEvent = typeof agreementEventsTable.$inferSelect;
