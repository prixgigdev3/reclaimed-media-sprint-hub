import {
  db,
  modulesTable,
  episodesTable,
  adminUsersTable,
  clientsTable,
  settingsTable,
  activityEventsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import crypto from "crypto";

async function main() {
  // Settings
  const [existingSettings] = await db.select().from(settingsTable);
  if (!existingSettings) {
    await db.insert(settingsTable).values({
      apiKey: "phk_" + crypto.randomBytes(24).toString("hex"),
      businessManagerId: "",
      notifyOnIcp: true,
      notifyOnFirstLogin: true,
      notifyOnAllComplete: true,
      notifyIcpEmail: "ops@reclaimedmedia.com",
      notifyFirstLoginEmail: "ops@reclaimedmedia.com",
      notifyAllCompleteEmail: "ops@reclaimedmedia.com",
    });
    console.log("seeded settings");
  }

  // Admin user (the operator)
  await db
    .insert(adminUsersTable)
    .values({
      email: "founder@reclaimedmedia.com",
      name: "Reclaimed Media Founder",
      role: "super_admin",
    })
    .onConflictDoNothing();
  console.log("seeded super admin (founder@reclaimedmedia.com)");

  // Modules
  const existing = await db.select().from(modulesTable);
  if (existing.length === 0) {
    const seedModules = [
      {
        title: "Module 1 — Foundations",
        description: "Set up your account, define your sprint, and align with the Reclaimed Media playbook.",
      },
      {
        title: "Module 2 — Your Ideal Customer",
        description: "Lock in who you're hunting. Complete the 34-question ICP questionnaire.",
      },
      {
        title: "Module 3 — Your Offer & Creative",
        description: "Sharpen the offer, hooks, and creative angles we'll test in week one.",
      },
      {
        title: "Module 4 — Launch & Optimize",
        description: "Pixel, audiences, and the launch checklist for going live.",
      },
    ];
    for (let i = 0; i < seedModules.length; i++) {
      const m = seedModules[i];
      const [mod] = await db.insert(modulesTable).values({ ...m, position: i + 1 }).returning();

      if (i === 0) {
        await db.insert(episodesTable).values([
          {
            moduleId: mod.id,
            title: "Welcome to the Reclaimed Media Sprint",
            copy:
              "This is your home base for the next four weeks. Watch this episode end-to-end, then mark it complete to unlock the next step.",
            videoUrl: null,
            position: 1,
            published: true,
            requirePrevious: false,
            kind: "standard",
            checklistItems: [],
          },
          {
            moduleId: mod.id,
            title: "How the Sprint Works",
            copy:
              "Your sprint runs across four modules. Each unlocks as the previous completes. Daily check-ins happen inside Slack — the link is in your welcome email.",
            videoUrl: null,
            position: 2,
            published: true,
            requirePrevious: true,
            kind: "standard",
            checklistItems: [],
          },
          {
            moduleId: mod.id,
            title: "Account Access Checklist",
            copy:
              "Use this checklist to give us access to the assets we'll need before launch.",
            videoUrl: null,
            position: 3,
            published: true,
            requirePrevious: true,
            kind: "checklist",
            checklistItems: [
              { id: 1, label: "Add us as Admin on your Meta Business Manager" },
              { id: 2, label: "Share GA4 view-only access" },
              { id: 3, label: "Provide the website / funnel URL" },
              { id: 4, label: "Confirm payment gateway is live" },
            ],
          },
        ]);
      } else if (i === 1) {
        await db.insert(episodesTable).values([
          {
            moduleId: mod.id,
            title: "Why ICP is the most important hour you'll spend",
            copy:
              "Watch this short walkthrough of why we go deep on ICP, then move to the questionnaire.",
            videoUrl: null,
            position: 1,
            published: true,
            requirePrevious: false,
            kind: "standard",
            checklistItems: [],
          },
          {
            moduleId: mod.id,
            title: "The 34-Question ICP Questionnaire",
            copy:
              "Answer every question carefully. Save as you go — your answers auto-save.",
            videoUrl: null,
            position: 2,
            published: true,
            requirePrevious: true,
            kind: "icp",
            checklistItems: [],
          },
        ]);
      } else if (i === 2) {
        await db.insert(episodesTable).values([
          {
            moduleId: mod.id,
            title: "Sharpening your offer",
            copy: "How we structure offers that convert cold traffic at scale.",
            videoUrl: null,
            position: 1,
            published: true,
            requirePrevious: false,
            kind: "standard",
            checklistItems: [],
          },
          {
            moduleId: mod.id,
            title: "Creative angles & hooks",
            copy: "The four hook frameworks we'll test in week one.",
            videoUrl: null,
            position: 2,
            published: true,
            requirePrevious: true,
            kind: "standard",
            checklistItems: [],
          },
          {
            moduleId: mod.id,
            title: "Asset upload checklist",
            copy: "Drop the raw assets we'll cut from in the shared drive.",
            videoUrl: null,
            position: 3,
            published: true,
            requirePrevious: true,
            kind: "checklist",
            checklistItems: [
              { id: 1, label: "Upload 10+ raw photos" },
              { id: 2, label: "Upload 3+ raw video clips" },
              { id: 3, label: "Provide brand guidelines / fonts" },
              { id: 4, label: "Confirm offer details" },
            ],
          },
        ]);
      } else if (i === 3) {
        await db.insert(episodesTable).values([
          {
            moduleId: mod.id,
            title: "Pixel & audience setup",
            copy: "Walkthrough of the pixel events and audiences we configure before launch.",
            videoUrl: null,
            position: 1,
            published: true,
            requirePrevious: false,
            kind: "standard",
            checklistItems: [],
          },
          {
            moduleId: mod.id,
            title: "Launch day playbook",
            copy: "What happens on launch day, how we read week-one signal, and what to expect.",
            videoUrl: null,
            position: 2,
            published: true,
            requirePrevious: true,
            kind: "standard",
            checklistItems: [],
          },
        ]);
      }
    }
    console.log("seeded modules + episodes");
  }

  // Sample clients
  const existingClients = await db.select().from(clientsTable);
  if (existingClients.length === 0) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 3);
    const startDateStr = startDate.toISOString().slice(0, 10);
    await db.insert(clientsTable).values([
      {
        firstName: "Mira",
        lastName: "Patel",
        email: "mira@northlightdental.com",
        businessName: "Northlight Dental",
        phone: "+1 415 555 0142",
        sprintStartDate: startDateStr,
        status: "active",
      },
      {
        firstName: "Diego",
        lastName: "Alvarez",
        email: "diego@altohomes.co",
        businessName: "Alto Homes",
        phone: null,
        sprintStartDate: null,
        status: "invited",
      },
      {
        firstName: "Sofia",
        lastName: "Bennett",
        email: "sofia@kerrhealth.com",
        businessName: "Kerr Health",
        phone: "+1 213 555 0193",
        sprintStartDate: startDateStr,
        status: "invited",
      },
    ]).onConflictDoNothing();
    console.log("seeded sample clients");
  }

  const acts = await db.select().from(activityEventsTable);
  if (acts.length === 0) {
    await db.insert(activityEventsTable).values([
      { kind: "client_invited", message: "Mira Patel (Northlight Dental) was invited", clientId: null },
      { kind: "client_invited", message: "Diego Alvarez (Alto Homes) was invited", clientId: null },
      { kind: "system", message: "Reclaimed Media Sprint Hub initialized", clientId: null },
    ]);
  }

  // Touch all rows to bump updated_at and silence sql<number> usage
  void sql;
  console.log("Seed complete.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
