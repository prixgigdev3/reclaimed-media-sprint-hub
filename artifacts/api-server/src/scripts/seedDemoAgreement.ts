/**
 * One-off seed: upload a sample agreement PDF, create a template with sign
 * fields placed over the visible blanks, and assign it to client #1 (Mira).
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/seedDemoAgreement.ts \
 *     "../../attached_assets/Executive_Success_Coaching_Arrangement_1777789879947.pdf" 1
 */
import path from "node:path";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  db,
  agreementTemplatesTable,
  agreementAssignmentsTable,
  agreementEventsTable,
  activityEventsTable,
  clientsTable,
  type AgreementField,
} from "@workspace/db";
import { uploadPdfBuffer, getPdfPageCount } from "../lib/agreements.js";

async function main() {
  const pdfArg = process.argv[2];
  const clientIdArg = parseInt(process.argv[3] ?? "1", 10);
  if (!pdfArg) {
    throw new Error("Usage: tsx seedDemoAgreement.ts <pdfPath> [clientId]");
  }
  const pdfPath = path.resolve(process.cwd(), pdfArg);
  const buf = await fs.readFile(pdfPath);
  const filename = path.basename(pdfPath);

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientIdArg));
  if (!client) throw new Error(`Client id ${clientIdArg} not found`);

  console.log(`Uploading ${filename} (${buf.length} bytes) to object storage...`);
  const objectKey = await uploadPdfBuffer(buf, "system-seed");
  const pageCount = await getPdfPageCount(buf);
  console.log(`Uploaded -> ${objectKey} (${pageCount} pages)`);

  // Field placement (fractions 0..1 from top-left).
  // Page 1 contains the visible blanks for the client's name and address;
  // we place the signature + date on the last page.
  const fields: AgreementField[] = [
    {
      id: "client-name",
      page: 1,
      x: 0.34,
      y: 0.215,
      width: 0.4,
      height: 0.028,
      type: "name",
      role: "client",
      label: "Client name",
      required: true,
    },
    {
      id: "client-address",
      page: 1,
      x: 0.43,
      y: 0.255,
      width: 0.45,
      height: 0.028,
      type: "text",
      role: "client",
      label: "Principal place of business",
      required: true,
    },
    {
      id: "client-signature",
      page: pageCount,
      x: 0.1,
      y: 0.78,
      width: 0.35,
      height: 0.07,
      type: "signature",
      role: "client",
      label: "Client signature",
      required: true,
    },
    {
      id: "client-date",
      page: pageCount,
      x: 0.55,
      y: 0.79,
      width: 0.25,
      height: 0.04,
      type: "date",
      role: "client",
      label: "Date",
      required: true,
    },
    {
      id: "client-initial",
      page: 2,
      x: 0.86,
      y: 0.92,
      width: 0.1,
      height: 0.04,
      type: "initial",
      role: "client",
      label: "Initial — refund policy",
      required: true,
    },
  ];

  console.log(`Inserting agreement template...`);
  const [tpl] = await db
    .insert(agreementTemplatesTable)
    .values({
      title: "Executive Success Coaching Membership Enrolment",
      description: "Monthly coaching/consulting agreement (demo template).",
      pdfObjectKey: objectKey,
      originalFilename: filename,
      pageCount,
      fields,
    })
    .returning();
  console.log(`Template id=${tpl.id}`);

  console.log(`Assigning template ${tpl.id} -> client ${client.id} (${client.email})`);
  const [asn] = await db
    .insert(agreementAssignmentsTable)
    .values({
      templateId: tpl.id,
      clientId: client.id,
      status: "pending",
      fieldValues: [],
    })
    .returning();

  await db.insert(agreementEventsTable).values({
    assignmentId: asn.id,
    actorType: "admin",
    kind: "assigned",
    metadata: { templateId: tpl.id, source: "seedDemoAgreement" },
  });
  await db.insert(activityEventsTable).values({
    kind: "agreement_assigned",
    message: `${client.firstName} ${client.lastName}: assigned "${tpl.title}"`,
    clientId: client.id,
  });

  console.log(`Assignment id=${asn.id} status=pending`);
  console.log(`Done. Client can sign at /agreements/${asn.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
