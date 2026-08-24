/**
 * Seed a Reclaimed Media demo: one builder agreement template ("Example
 * Coaching Agreement") and, if a demo client exists, a pending assignment so
 * the full client journey (sign-in → agreement → modules) can be demoed.
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedDemoTemplate.ts
 */
import { eq } from "drizzle-orm";
import {
  db,
  agreementTemplatesTable,
  agreementAssignmentsTable,
  agreementEventsTable,
  activityEventsTable,
  clientsTable,
} from "@workspace/db";
import { BRAND_NAME } from "../lib/brand";
// Local copy of extractPlaceholders (lib/agreements.ts) so this script doesn't
// import the PNG-bundled PDF module under tsx.
type PlaceholderType = "text" | "name" | "businessName" | "date" | "initial";
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
}
function extractPlaceholders(body: string) {
  const TOKEN_RE = /\{\{\s*([a-zA-Z][\w]*)(?::([^}]+))?\s*\}\}/g;
  const out: { key: string; label: string; type: PlaceholderType; required: boolean; role: "client" }[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    const rawKey = m[1];
    const arg = m[2]?.trim();
    let key = rawKey;
    let type: PlaceholderType = "text";
    let label = rawKey;
    if (rawKey === "name") { type = "name"; label = "Full name"; }
    else if (rawKey === "businessName") { type = "businessName"; label = "Business name"; }
    else if (rawKey === "date") { type = "date"; label = "Date"; }
    else if (rawKey === "initial") { type = "initial"; key = arg ? `initial_${slug(arg)}` : "initial"; label = arg ? `Initial — ${arg}` : "Initial"; }
    else if (rawKey === "text") { const lab = arg || "Field"; key = `text_${slug(lab)}`; label = lab; }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label, type, required: type !== "date", role: "client" });
  }
  return out;
}

const BODY = `# Coaching agreement

This agreement is made between **${BRAND_NAME}** (the "Coach") and **{{name}}** of **{{businessName}}** (the "Client"), dated {{date}}.

## 1. Scope of work
${BRAND_NAME} will deliver the agreed coaching programme over a 90-day sprint, including weekly modules, monthly check-ins, and on-demand support.

## 2. Confidentiality
Both parties agree to keep all shared materials, strategies, and business information confidential.

I confirm I have read and understood this section. {{initial:scope}}

## 3. Principal place of business
Client confirms their principal place of business is: {{text:Principal place of business}}

## 4. Acceptance
By signing below, the parties agree to the terms set out in this document.`;

async function main() {
  const [existing] = await db
    .select()
    .from(agreementTemplatesTable)
    .where(eq(agreementTemplatesTable.title, "Example Coaching Agreement"));

  let templateId: number;
  if (existing) {
    templateId = existing.id;
    console.log(`template already exists (id=${templateId}) — reusing`);
  } else {
    const placeholders = extractPlaceholders(BODY);
    const [tpl] = await db
      .insert(agreementTemplatesTable)
      .values({
        kind: "builder",
        title: "Example Coaching Agreement",
        description: "Example builder agreement for demos — replace with your own template.",
        bodyMarkdown: BODY,
        placeholders,
      })
      .returning();
    templateId = tpl.id;
    console.log(`created template id=${templateId}`);
  }

  // Assign to the first demo client so the signing journey is visible.
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, 1));
  if (!client) {
    console.log("no client id=1 found — skipping assignment");
    process.exit(0);
  }
  const [existingAssignment] = await db
    .select()
    .from(agreementAssignmentsTable)
    .where(eq(agreementAssignmentsTable.clientId, client.id));
  if (existingAssignment) {
    console.log(`client ${client.id} already has an assignment — skipping`);
    process.exit(0);
  }
  const [asn] = await db
    .insert(agreementAssignmentsTable)
    .values({ templateId, clientId: client.id, status: "pending", fieldValues: [] })
    .returning();
  await db.insert(agreementEventsTable).values({
    assignmentId: asn.id,
    actorType: "admin",
    kind: "assigned",
    metadata: { templateId, source: "seedDemoTemplate" },
  });
  await db.insert(activityEventsTable).values({
    kind: "agreement_assigned",
    message: `${client.firstName} ${client.lastName}: assigned "Example Coaching Agreement"`,
    clientId: client.id,
  });
  console.log(`assigned template ${templateId} -> client ${client.id} (${client.email}), assignment id=${asn.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
