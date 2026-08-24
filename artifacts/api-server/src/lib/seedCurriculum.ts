import { and, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  coursesTable,
  modulesTable,
  episodesTable,
  episodeProgressTable,
  settingsTable,
  type ChecklistItem,
} from "@workspace/db";
import { logger } from "./logger";
import { BRAND_NAME } from "./brand";

/**
 * Bump this every time the curriculum copy / checklist / structure in this
 * file changes and you want production to pick up the change automatically
 * on the next deploy.
 *
 * On boot, if the version stored in `settings.curriculum_version` is older
 * than CURRICULUM_VERSION, the seed force-re-applies and writes the new
 * version. This means dev → prod for curriculum content is just "publish".
 *
 * Format: YYYY.MM.N (year.month.bump-within-month). Strictly increasing
 * string comparison is fine because of the zero-padded structure.
 */
export const CURRICULUM_VERSION = "2026.08.1";

type EpisodeSeed = {
  position: number;
  title: string;
  copy: string;
  kind: "standard" | "checklist" | "icp";
  checklistItems?: ChecklistItem[];
};

type ModuleSeed = {
  position: number;
  title: string;
  description: string;
  episodes: EpisodeSeed[];
};

const SEED_MARKER_TITLE = "Module 3 — Launch and Optimise";

const M1_E1 = `You're in. Let's make the next 21 days count.

Before we get into the detail, I want to set the tone for how this works — because how you show up over the next three weeks will directly affect what the data tells us at the end of it.

This is not a typical agency engagement. You're not handing something over and waiting. You're an active participant in a live market test. The campaign runs in your market, with your offer, in front of your real audience. That means your input matters. Your content matters. Your responsiveness matters.

Here's what I need from you for this to work:

Watch everything in this platform before your onboarding call. The research we do in Week 1 is built on what you tell us here. If you rush through it or skip it, that shows up in the campaign.

Answer the ICP questionnaire in Module 2 completely and honestly. Do not write what you think we want to hear. Write what's actually true about your clients, your market, and your competitors. Vague answers produce vague campaigns.

When we brief you on content after Week 1, turn it around within 48 hours. Not when it's convenient. Within 48 hours. That window matters because we're building on live data that has a shelf life.

Be reachable. Not available 24 hours a day — just reachable during business hours. If we ask a question, respond the same day.

Show up to the Day 22 review prepared to look at the data and make a decision.

That's the commitment. Everything else is our job.

ACTION: Continue to Episode 2 to understand exactly how the 21 days are structured.`;

const M1_E2 = `The sprint runs for 21 days. Here's what happens inside each of them.

WEEK 1 — RESEARCH AND ANGLE TESTING

Before a single dollar of your ad spend goes live, we do the work.

We research who your best prospects actually are, what your competitors are running, what angles your market responds to, what your audience is afraid of, what they want, and what language they use when they're looking for what you offer.

From that research, we build 15 different ad angles and test them live in your market. These are not guesses. They are hypotheses built from real competitor data and audience intelligence, tested with real money in your real market.

Your job in Week 1: Complete this onboarding platform. Review the brief we send you at the end of the week. Prepare to shoot content based on what the data tells us is working.

WEEK 2 — OPTIMISE AND SCALE THE WINNERS

Non-performers get cut every day. Budget moves behind what is producing results. Your content gets integrated into the campaign. WhatsApp qualification begins if that is part of your funnel.

We are watching the data every single day — not every week, not when we get around to it. Every day. What works gets more budget. What does not work gets cut immediately.

Your job in Week 2: Deliver the content brief we sent you at the end of Week 1, if you have not already. Respond to any questions we send through. Stay reachable.

WEEK 3 — FULL BUDGET BEHIND THE PROVEN ANGLES

By Week 3 we know which angles your market responds to. Full budget goes behind the proven creative. Volume increases. The goal is to generate as many qualified interactions as possible before Day 22 so we have meaningful data to review together.

Your job in Week 3: Stay reachable. Handle the leads or conversations that are coming through. Confirm your Day 22 review time.

DAY 22 — THE MUTUAL REVIEW

We look at the data together. Cost per qualified lead, lead volume, lead quality, what your market responded to, and what it did not. We make a decision based on what the market showed us — not on momentum, not on pressure.

There are three possible outcomes:

The sprint worked and there is a clear path to scaling. We move into the full growth partnership. Your action deposit rolls directly into the first month. You pay nothing additional to continue.

The leads came in and the market responded, but for whatever reason this is not the right time to continue. Your deposit comes back in full. You keep the leads, the market intelligence report, the content calendar, and everything we built.

The market data does not support scaling right now. Your deposit still comes back in full. You walk away with a complete diagnosis — exactly what is standing between your business and a working paid media pipeline, and exactly what to do next.

In every outcome you either move forward or you leave with your deposit back.

ACTION: Continue to Episode 3 to complete the account access checklist.`;

const M1_E3 = `Before your sprint can begin, three things need to be in place.

This episode covers what they are and why each one matters. Do not book your onboarding call until all three are confirmed.

ONE — YOUR ICP RESEARCH BRIEF

Module 2 of this platform contains your ICP questionnaire. This is the most important thing you will complete before the campaign launches.

ICP stands for Ideal Customer Profile. Your answers feed directly into the research we do in Week 1. They tell us who to target, what language to use, what your competitors are doing, and what your market actually responds to.

A strong brief means a strong Week 1. A vague brief means we start Week 1 already behind. Complete it before your onboarding call. Take your time. Be specific.

TWO — FACEBOOK BUSINESS MANAGER ACCESS

We cannot build or run campaigns without access to your ad account.

You need to have a Facebook Business Manager set up with your ad account inside it, and you need to add us as a partner with campaign management permissions.

The next episode walks you through this step by step. If you already have a Business Manager, it should take less than ten minutes. If you need to create one from scratch, set aside about thirty minutes.

If you do not have a tech person who can do this, email support@reclaimedmedia.com and we will arrange for this to be set up for you at our standard hourly rate.

THREE — BRAND ASSETS

We need the following before we can build creative:

Your logo — PNG or SVG, on a transparent background if possible.
Any existing photography of your business, team, or work.
Any existing brand guidelines — colours, fonts — if you have them.
Your website URL and your most active social media handle.

If you do not have professional photography, that is fine. We will brief you on what to capture with a phone camera after Week 1 research is complete. Do not delay access setup waiting to have perfect assets.

ACTION: Confirm all three are either complete or in progress before continuing to the Account Access Checklist.`;

const M1_E4 = `Work through this checklist before your onboarding call. Tick each item as you complete it.

FACEBOOK BUSINESS MANAGER

Go to business.facebook.com. If you do not have a Business Manager account, click Create Account and follow the prompts. Use your business name and business email address.

If you already have one, confirm your ad account is inside it. Go to Business Settings, click Accounts, then Ad Accounts. Your ad account should appear here. If it does not, click Add and follow the steps to add your existing ad account.

PAYMENT METHOD

Inside your Ad Account, confirm there is an active payment method attached. Go to Business Settings, click Payments, and confirm a valid card or direct debit is on file. Your ad spend will be billed directly to this payment method. This is money going to Meta, not to us.

ADD ${BRAND_NAME.toUpperCase()} TO YOUR BUSINESS MANAGER

The cleanest way to grant us access is to add us as a person on your Business Manager. Never share your Facebook login — this flow keeps everything under your ownership and takes about 5 minutes.

Watch this first: your onboarding email includes a step-by-step walkthrough video showing exactly where to click in Business Manager, from sending the friend request through to assigning us on your ad account.

Step 1 — Add us as a friend on Facebook. Send a friend request to the Facebook profile we shared in your welcome email. This makes the next step easier because you can find us by name in the People search instead of typing an email.

Step 2 — Assign us as an Admin on your Facebook Page. Go to business.facebook.com, then Business Settings, then Accounts, then Pages. Select your Page, click Add People, search for ${BRAND_NAME}, and assign Admin / Full control access. Click Save. We will get a notification and accept.

Step 3 — Create your Ad Account (skip if you already have one). Still in Business Settings, go to Accounts, then Ad Accounts, then Add, then Create a new ad account. Name it after your business and double-check the time zone and currency — these cannot be changed later. Open Payments and attach a valid card or direct debit. All ad spend bills directly to this payment method; the money goes to Meta, not to us.

Step 4 — Give us access to your Ad Account. Business Settings, then Ad Accounts, select the ad account, click Add People, find ${BRAND_NAME}, and assign Admin access. Click Save.

Step 5 — Link your Page to the Ad Account. Business Settings, then Ad Accounts, select your ad account, click Pages in the side menu, then Add Pages, and select the Page from Step 2. This is what allows the ads we build to run from your Page.

Step 6 — Confirm. Send a quick email to support@reclaimedmedia.com with the subject line: Business Manager Access Granted — ${BRAND_NAME}. We will confirm within 24 hours and double-check that everything is connected on our end.

BRAND ASSETS

Confirm the following are ready to share: a logo file (PNG with transparent background preferred), at least three photos of your business, team, or work, your website URL, and your primary social media handle.

If assets are ready, upload them to the shared folder link we sent in your invite email, or send them to support@reclaimedmedia.com.

ACTION: Once all items above are confirmed, you are ready to book your onboarding call. Your onboarding call link was sent in your invite email.`;

const M1_E4_CHECKLIST: ChecklistItem[] = [
  { id: 1, label: "Facebook Business Manager created with ad account inside it" },
  { id: 2, label: "Active payment method confirmed on the ad account" },
  { id: 3, label: `Sent a friend request to ${BRAND_NAME} on Facebook` },
  { id: 4, label: `${BRAND_NAME} assigned as Admin on your Facebook Page` },
  { id: 5, label: `${BRAND_NAME} given Admin access to your Ad Account` },
  { id: 6, label: "Facebook Page linked to your Ad Account in Business Settings" },
  { id: 7, label: "Confirmation email sent to support@reclaimedmedia.com" },
  { id: 8, label: "Logo file ready (PNG with transparent background preferred)" },
  { id: 9, label: "At least three photos of your business, team, or work ready" },
  { id: 10, label: "Website URL ready to share" },
  { id: 11, label: "Primary social media handle ready to share" },
];

const M2_E1 = `Most businesses think they know who their best client is.

Most are partially right and mostly wrong. Not because they do not know their business — because they have never had to articulate it precisely enough to build a campaign around it.

Here is the problem. When we say put your message in front of the right person, the algorithm does not know who the right person is. We tell it. And what we tell it is built from what you tell us in the questionnaire that follows this lesson.

If you describe your ideal client in vague terms — business owners, professionals, people in Austin — then we target in vague terms. And vague targeting produces low-quality leads that cost you money and time.

If you describe your ideal client with precision — the specific fears they have, the exact language they use when they search for what you offer, the moment that makes them decide to act, the objections that hold them back — then we can build creative that speaks directly to that person and nobody else. That is what produces qualified leads instead of random enquiries.

THE THREE THINGS YOUR RESEARCH BRIEF MUST TELL US

Who your best clients actually are. Not a demographic. A person.
What keeps them up at night. The specific problem they are trying to solve.
What your competitors are doing. And where the gaps are that we can occupy.

Your answers to the questionnaire in the next episode cover all three of these. Take your time with it. Write in plain language. Do not write what sounds impressive. Write what is actually true.

A note on competitors. We know it can feel uncomfortable to name your competitors directly. Do it anyway. Knowing what they are running means we can avoid fatigued angles and find the gaps they are not covering. That is a competitive advantage.

HOW YOUR ANSWERS GET USED

Every answer you give feeds into the Week 1 research process.

Your client description becomes the audience parameters we build in the ad account. Your pain point language becomes the copy we test in the first round of ads. Your competitor names become the starting point for the angle and creative audit. Your objection list becomes the framework for the WhatsApp qualification sequence.

The questionnaire is not a formality. It is the brief that the first week of your campaign is built on. Treat it like the most important document you will complete this month — because it is.

ACTION: Continue to the next episode to complete your ICP Research Brief.`;

const M3_E1 = `Before any campaign goes live, the tracking foundation has to be correct.

This is the piece that most agencies either skip or set up incorrectly. It is also the reason most business owners have no idea whether their marketing is actually working.

Here is what tracking does. When someone sees your ad and takes an action — clicks, sends a message, fills a form, makes a booking — tracking records that action and ties it back to the specific ad that drove it. Without tracking, you can see that money was spent. You cannot see whether it worked.

With tracking in place, you know exactly which ad produced which lead, what that lead cost, and whether that cost makes sense for your business. That is the number we give you on Day 22.

WHAT WE SET UP BEFORE YOUR CAMPAIGN LAUNCHES

Meta Pixel — a small piece of code that lives on your website and records when someone arrives from your ad and takes an action.

Conversions API — a server-side connection between your website or booking platform and Meta's ad system. This sends conversion data directly from your server, not just from the browser. It is more reliable and more accurate, and it improves the quality of the data Meta uses to find more people like your best leads.

UTM Parameters — tracking tags added to every link in your campaign. These tell your analytics platform exactly which campaign, which ad set, and which specific ad drove each click. Without UTMs, traffic from your ads shows up as unattributed in your analytics.

WHY THIS MATTERS FOR YOUR SPRINT

The 21 days only produces useful data if we can read the data accurately. If the tracking is not in place before Day 1, Week 1 data is unreliable. Week 2 optimisation decisions are built on Week 1 data. Week 3 scaling is built on Week 2 decisions.

A broken tracking foundation does not just affect Day 1. It affects every decision made across all 21 days. This is why we sort it before anything goes live.

Your job here is simple. Complete the account access steps in Module 1 so we can install and verify tracking before the sprint start date.

ACTION: Confirm your Business Manager access is granted before continuing.`;

const M3_E2 = `At the end of Week 1, you will receive a content brief from us.

This brief will be based on what the data is telling us — which angles are getting attention, what the market is responding to, and what type of content will perform best in Week 2 and 3.

You will have 48 hours to supply the content after receiving that brief.

This is not optional and it is not negotiable. The 48-hour window exists because the campaign is live and the data has a shelf life. If we identify a winning angle in Week 1 and cannot get the content to support it, we cannot optimise properly in Week 2. That costs you money and time.

WHAT THE BRIEF WILL INCLUDE

Specific shots or scenarios we need you to capture.
The angle or hook the content needs to support.
Whether we need video, still images, or both.
Any text overlays or captions that need to be visible.
The format — dimensions and orientation for each placement.

WHAT YOU DO NOT NEED

You do not need a studio. You do not need a professional camera. You need a phone with a decent camera and someone who can follow a brief.

Most of the content that performs best in direct response advertising looks like it was filmed by a person, not produced by an agency. Natural lighting, real environments, real people. If you have an office, a clinic, a team, a workspace — that is your set.

HOW TO PREPARE NOW, BEFORE THE BRIEF ARRIVES

Think about who on your team could film content at short notice. It does not have to be you. It has to be someone who can act on a brief within 48 hours and turn around usable footage.

If that person is you, make sure your phone camera is set to the highest resolution available and that you have storage space cleared.

If that person is a team member, brief them now that this is coming. A brief will arrive after Week 1 and they will have 48 hours to deliver.

Make a list of the assets you already have — existing photos, existing video, anything shot inside your business or featuring your team or your work. Send these to support@reclaimedmedia.com or upload them to the shared folder. We may be able to use some of them in the first round of creative.

ACTION: Identify who on your team handles content delivery and confirm they will be available within 48 hours of the Week 1 brief.`;

const M3_E3 = `Your sprint start date is confirmed. Here is what happens on Day 1 and through Week 1.

ON DAY 1

We set the campaigns live. You will not see immediate results and that is normal. Meta's delivery system takes 24 to 48 hours to move through the learning phase — a period where it is calibrating who to show your ads to based on early engagement signals. During this time, costs can be higher and volume can be lower. This is expected. Do not read into early data in the first 48 hours.

What you should do on Day 1: Confirm you can see the campaigns in your ad account. Let us know if anything looks incorrect — ad account access, billing alerts, anything. Then get out of the way and let the system run.

WHAT WE ARE WATCHING DURING WEEK 1

Every day during Week 1 we are monitoring:

Ad delivery — are all ads spending?
Cost per click and cost per result — are these within range for this market?
Click-through rate — is the creative stopping the scroll?
Conversion events — is the tracking recording correctly?
WhatsApp or lead quality — are the right people engaging?

You will not receive a daily update from us during Week 1. That is intentional. Constant reporting creates noise. At the end of Week 1 you will receive a brief that summarises what the data is showing and what content we need from you.

WHAT YOU SHOULD NOT DO DURING WEEK 1

Do not change your offer, your pricing, or your sales process without telling us. Do not pause the ad account or change the payment method. Do not boost other posts or run separate campaigns in the same ad account. This creates noise in the data and makes it harder to read the signals accurately.

If something urgent comes up that affects the business, tell us immediately.

ACTION: Confirm your sprint start date and save the Day 22 date in your calendar. The Day 22 review link was included in your onboarding confirmation email.`;

const M3_E4 = `Day 22 is the most important conversation we will have.

It is not a sales call. It is a mutual review of what the market told us over the previous 21 days. We look at the data together and decide together what the right next step is.

Here is how to prepare for it.

BRING YOUR SALES DATA

We can tell you how many people engaged with your campaign, how many became qualified leads, and what it cost to get each one in front of you. What we cannot tell you is what happened after that.

Bring your numbers. How many conversations did you have? How many of those converted to clients? What is a new client currently worth to your business in the first 12 months? With those numbers and ours, we can calculate whether the campaign is profitable and what scaling looks like.

COME WITH AN OPEN MIND ON THE OUTCOME

The data will tell us one of three things. Either the market responded well and there is a clear path to scaling. Or the market responded but the fit between us is not right for a long-term engagement. Or the data suggests the timing or conditions are not right to scale this now.

All three outcomes have value. Come prepared to hear whichever one the data shows rather than arriving with an expectation of a specific outcome.

HAVE YOUR DECISION MAKER PRESENT

If there is a business partner or anyone else involved in this decision, they need to be on the Day 22 call. We are reviewing 21 days of live data and making a decision based on it. That conversation needs to happen once, not twice.

IF YOU HAVE QUESTIONS BEFORE DAY 22

Send them to support@reclaimedmedia.com. We will answer them before the review call so the call itself is focused on the data and the decision, not on explaining how the model works.

ACTION: Confirm your Day 22 call is in your calendar and that any relevant decision makers are invited to it.`;

const SEED: ModuleSeed[] = [
  {
    position: 1,
    title: "Module 1 — Foundations",
    description:
      "Before the campaign launches, we need to make sure everything is in place. This module covers what the sprint is, how it works, what we need from you, and how to give us access to your ad account. Complete all four episodes before your onboarding call.",
    episodes: [
      { position: 1, title: "Welcome to the Sprint", copy: M1_E1, kind: "standard" },
      { position: 2, title: "How the Sprint Works", copy: M1_E2, kind: "standard" },
      { position: 3, title: "What We Need From You", copy: M1_E3, kind: "standard" },
      {
        position: 4,
        title: "Account Access Checklist",
        copy: M1_E4,
        kind: "checklist",
        checklistItems: M1_E4_CHECKLIST,
      },
    ],
  },
  {
    position: 2,
    title: "Module 2 — Ideal Customer",
    description:
      "The research we do in Week 1 is built on what you tell us here. This module has two parts — first understanding why this matters, then completing the research brief itself. Do not skip the first episode. It will change how you answer the questionnaire.",
    episodes: [
      { position: 1, title: "Why Your Ideal Client Profile Matters", copy: M2_E1, kind: "standard" },
      // Position 2 is reserved for the existing ICP episode (kind='icp').
      // The seeder leaves any pre-existing ICP episode untouched and only
      // creates a placeholder if no ICP episode exists at all.
      {
        position: 2,
        title: "The 34-Question ICP Questionnaire",
        copy: "Complete the ICP questionnaire below to brief your sprint.",
        kind: "icp",
      },
    ],
  },
  {
    position: 3,
    title: "Module 3 — Launch and Optimise",
    description:
      "You are almost ready to launch. This module covers the technical setup, what the first week looks like from your side, how to prepare content, and what to expect on Day 22. Complete this before your sprint start date.",
    episodes: [
      { position: 1, title: "Understanding Tracking and Why It Matters", copy: M3_E1, kind: "standard" },
      { position: 2, title: "Content — What to Prepare", copy: M3_E2, kind: "standard" },
      { position: 3, title: "Launch Day — What to Expect", copy: M3_E3, kind: "standard" },
      { position: 4, title: "Day 22 — How to Prepare for the Review", copy: M3_E4, kind: "standard" },
    ],
  },
];

async function findSprintHubCourseId(): Promise<number | null> {
  const all = await db.select().from(coursesTable);
  const match = all.find((c) => c.title?.toLowerCase().trim() === "sprint hub");
  if (match) return match.id;
  return null;
}

export async function ensureSprintHubCurriculumV2026(opts?: { force?: boolean }): Promise<{
  applied: boolean;
  courseId: number | null;
  reason?: string;
  fromVersion?: string;
  toVersion?: string;
}> {
  const courseId = await findSprintHubCourseId();
  if (!courseId) {
    return { applied: false, courseId: null, reason: "no Sprint Hub course found" };
  }

  // Version-based idempotency: compare the version stored in `settings`
  // against the CURRICULUM_VERSION constant in this file. When dev edits
  // the seed and bumps the version, the next boot in any environment
  // (dev or prod) auto-re-applies the seed and updates the stored version.
  const [settingsRow] = await db.select().from(settingsTable).limit(1);
  const storedVersion = settingsRow?.curriculumVersion ?? "";
  const isFirstRun = storedVersion === "";
  const isUpgrade = !isFirstRun && storedVersion < CURRICULUM_VERSION;
  const isMarkerStyleAlreadySeeded = isFirstRun && (await (async () => {
    // Back-compat: if the legacy SEED_MARKER_TITLE module already exists but
    // we have no stored version yet, treat this as "already on the latest"
    // and just record the version — don't blow away admin edits made before
    // versioning existed.
    const existing = await db
      .select()
      .from(modulesTable)
      .where(and(eq(modulesTable.courseId, courseId), eq(modulesTable.title, SEED_MARKER_TITLE)));
    return existing.length > 0;
  })());

  if (!opts?.force && !isFirstRun && !isUpgrade) {
    return { applied: false, courseId, reason: "already on latest version", fromVersion: storedVersion, toVersion: CURRICULUM_VERSION };
  }

  if (!opts?.force && isMarkerStyleAlreadySeeded) {
    await upsertCurriculumVersion(settingsRow?.id, CURRICULUM_VERSION);
    return { applied: false, courseId, reason: "back-compat: marker found, recorded version without overwrite", fromVersion: storedVersion, toVersion: CURRICULUM_VERSION };
  }

  // SAFETY: load every episode_id that any client has any progress on.
  // These episodes are "live" — a real client has touched them. The seed
  // will refuse to mutate their content, refuse to re-position them, and
  // refuse to unpublish them or their parent module. New content is still
  // inserted alongside; existing client progress is never disrupted.
  const progressRows = await db
    .select({ episodeId: episodeProgressTable.episodeId })
    .from(episodeProgressTable);
  const liveEpisodeIds = new Set<number>(progressRows.map((r) => r.episodeId));
  const liveEpisodes = liveEpisodeIds.size > 0
    ? await db.select().from(episodesTable).where(inArray(episodesTable.id, [...liveEpisodeIds]))
    : [];
  const liveModuleIds = new Set<number>(liveEpisodes.map((e) => e.moduleId));
  if (liveEpisodeIds.size > 0) {
    logger.info(
      { liveEpisodes: liveEpisodeIds.size, liveModules: liveModuleIds.size },
      "Curriculum seed: live client progress detected — content/structure on these episodes will be preserved",
    );
  }

  const courseModules = await db
    .select()
    .from(modulesTable)
    .where(eq(modulesTable.courseId, courseId));
  const byPosition = new Map<number, (typeof courseModules)[number]>();
  for (const m of courseModules) {
    if (!byPosition.has(m.position)) byPosition.set(m.position, m);
  }

  const keptModuleIds: number[] = [];

  for (const modSeed of SEED) {
    let modRow = byPosition.get(modSeed.position) ?? null;

    if (modRow) {
      // SAFETY: if this module contains a live (progress-bearing) episode,
      // leave its visible metadata (title/description/position) alone —
      // changing these underneath a real client would alter their lesson's
      // visible context mid-flight. We still ensure it's published and on
      // the correct course (those can only re-show or re-link, not mutate
      // copy a client is reading).
      if (liveModuleIds.has(modRow.id)) {
        await db
          .update(modulesTable)
          .set({ published: true, courseId })
          .where(eq(modulesTable.id, modRow.id));
      } else {
        await db
          .update(modulesTable)
          .set({
            title: modSeed.title,
            description: modSeed.description,
            published: true,
            position: modSeed.position,
            courseId,
          })
          .where(eq(modulesTable.id, modRow.id));
      }
    } else {
      const [inserted] = await db
        .insert(modulesTable)
        .values({
          title: modSeed.title,
          description: modSeed.description,
          published: true,
          position: modSeed.position,
          courseId,
        })
        .returning();
      modRow = inserted;
    }

    keptModuleIds.push(modRow.id);

    const existingEps = await db
      .select()
      .from(episodesTable)
      .where(eq(episodesTable.moduleId, modRow.id));
    const epsByPosition = new Map<number, (typeof existingEps)[number]>();
    for (const e of existingEps) {
      if (!epsByPosition.has(e.position)) epsByPosition.set(e.position, e);
    }

    const keptEpisodeIds: number[] = [];

    for (const epSeed of modSeed.episodes) {
      const existing = epsByPosition.get(epSeed.position) ?? null;

      if (epSeed.kind === "icp") {
        // Preserve any existing ICP episode untouched (per user request).
        // Look anywhere in the module for an existing ICP-kind episode first.
        const existingIcp = existingEps.find((e) => e.kind === "icp");
        if (existingIcp) {
          // SAFETY: if this ICP episode is live (a real client has progress
          // on it), do not change anything — not even position/published.
          if (liveEpisodeIds.has(existingIcp.id)) {
            keptEpisodeIds.push(existingIcp.id);
            continue;
          }
          // Otherwise just make sure it's at the desired position and published.
          if (existingIcp.position !== epSeed.position || !existingIcp.published) {
            await db
              .update(episodesTable)
              .set({ position: epSeed.position, published: true })
              .where(eq(episodesTable.id, existingIcp.id));
          }
          keptEpisodeIds.push(existingIcp.id);
        } else {
          const [ins] = await db
            .insert(episodesTable)
            .values({
              moduleId: modRow.id,
              title: epSeed.title,
              copy: epSeed.copy,
              position: epSeed.position,
              kind: "icp",
              published: true,
              requirePrevious: true,
              checklistItems: [],
            })
            .returning();
          keptEpisodeIds.push(ins.id);
        }
        continue;
      }

      if (existing && existing.kind === "icp") {
        // Don't overwrite an ICP episode that happens to sit at this position.
        // If it's live (client has progress on it), leave it exactly where it
        // is and skip inserting the seed's version at this slot. Otherwise
        // bump it to a safe position and insert the new content here.
        if (liveEpisodeIds.has(existing.id)) {
          keptEpisodeIds.push(existing.id);
          continue;
        }
        await db
          .update(episodesTable)
          .set({ position: 90 + epSeed.position })
          .where(eq(episodesTable.id, existing.id));
        const [ins] = await db
          .insert(episodesTable)
          .values({
            moduleId: modRow.id,
            title: epSeed.title,
            copy: epSeed.copy,
            position: epSeed.position,
            kind: epSeed.kind,
            published: true,
            requirePrevious: true,
            checklistItems: epSeed.checklistItems ?? [],
          })
          .returning();
        keptEpisodeIds.push(ins.id);
        continue;
      }

      if (existing) {
        // SAFETY: if a real client has progress on this episode, freeze its
        // content. We still keep it in the kept set so it doesn't get
        // unpublished below, but we don't overwrite title/copy/position/
        // checklist — the client would see their lesson change underneath
        // them mid-flight.
        if (liveEpisodeIds.has(existing.id)) {
          keptEpisodeIds.push(existing.id);
          continue;
        }
        await db
          .update(episodesTable)
          .set({
            title: epSeed.title,
            copy: epSeed.copy,
            position: epSeed.position,
            kind: epSeed.kind,
            published: true,
            requirePrevious: true,
            checklistItems: epSeed.checklistItems ?? [],
          })
          .where(eq(episodesTable.id, existing.id));
        keptEpisodeIds.push(existing.id);
      } else {
        const [ins] = await db
          .insert(episodesTable)
          .values({
            moduleId: modRow.id,
            title: epSeed.title,
            copy: epSeed.copy,
            position: epSeed.position,
            kind: epSeed.kind,
            published: true,
            requirePrevious: true,
            checklistItems: epSeed.checklistItems ?? [],
          })
          .returning();
        keptEpisodeIds.push(ins.id);
      }
    }

    // Unpublish any extra episodes in this module that aren't part of the
    // seed and aren't the preserved ICP episode. SAFETY: never unpublish an
    // episode that has client progress on it — that would yank a lesson out
    // from under a real client mid-flight.
    const extras = existingEps
      .filter((e) => !keptEpisodeIds.includes(e.id) && e.kind !== "icp" && !liveEpisodeIds.has(e.id));
    if (extras.length > 0) {
      await db
        .update(episodesTable)
        .set({ published: false })
        .where(inArray(episodesTable.id, extras.map((e) => e.id)));
    }
  }

  // Unpublish any modules in this course beyond the seeded set so they
  // disappear from the client view but are preserved for audit. SAFETY:
  // skip any module that contains a live (progress-bearing) episode.
  const extraModules = courseModules.filter(
    (m) => !keptModuleIds.includes(m.id) && !liveModuleIds.has(m.id),
  );
  if (extraModules.length > 0) {
    await db
      .update(modulesTable)
      .set({ published: false })
      .where(
        and(
          eq(modulesTable.courseId, courseId),
          inArray(modulesTable.id, extraModules.map((m) => m.id)),
        ),
      );
  }

  await upsertCurriculumVersion(settingsRow?.id, CURRICULUM_VERSION);

  logger.info(
    { courseId, seededModules: keptModuleIds.length, fromVersion: storedVersion, toVersion: CURRICULUM_VERSION },
    "Sprint Hub curriculum seeded",
  );
  return { applied: true, courseId, fromVersion: storedVersion, toVersion: CURRICULUM_VERSION };
}

async function upsertCurriculumVersion(existingId: number | undefined, version: string): Promise<void> {
  if (existingId) {
    await db.update(settingsTable).set({ curriculumVersion: version }).where(eq(settingsTable.id, existingId));
  } else {
    await db.insert(settingsTable).values({ curriculumVersion: version });
  }
}

// Suppress unused import warning if `ne` isn't referenced; kept for future use.
void ne;
