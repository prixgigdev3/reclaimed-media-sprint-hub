# Overview

This project is a pnpm workspace monorepo utilizing TypeScript, designed to serve as a comprehensive sprint management and client engagement platform. It includes an API server, an admin dashboard, and a client portal. The platform facilitates client onboarding, module-based learning with progress tracking, digital agreement management, and client intelligence features.

Key capabilities include:
- Client and admin management with role-based access control.
- Dynamic content delivery (modules, episodes) assignable via courses.
- Robust digital agreement signing with customizable templates.
- Real-time activity tracking and client health analytics.
- Secure document management with client-specific isolation.
- Integration with external services for email (Resend) and AI (OpenAI).

The business vision is to provide a streamlined, efficient, and scalable solution for managing client-centric educational and service delivery processes, enhancing client engagement, and providing actionable insights for administrators.

# User Preferences

I prefer iterative development, with clear communication at each major step. Please ask before making any significant architectural changes or introducing new dependencies. Ensure that any proposed changes maintain the existing coding style and project structure. I value detailed explanations for complex solutions.

# System Architecture

The project is structured as a pnpm workspace monorepo.

## UI/UX Decisions

- **Admin Dashboard & Client Portal:** Built with React and Vite.
- **Branding:** Reclaimed Media. Inter UI font with a color palette of deep indigo (`#4451A0`) and periwinkle (`#7D99DE`). The wordmark is the name "Reclaimed Media" in script lettering — assets live at `artifacts/sprint-hub/src/assets/reclaimed-media-wordmark-blue.png` (light surfaces) and `-white.png` (dark surfaces); `artifacts/api-server/assets/reclaimed_media_logo.png` heads every signed PDF.
- **To rebrand for a new client (one-edit remix):** Set `BRAND_NAME` (backend) and `VITE_BRAND_NAME` (frontend) environment variables to the new business name. `BRAND_APP_NAME` / `VITE_BRAND_APP_NAME` default to `"<BRAND_NAME> Sprint Hub"` but can be overridden independently. These two env vars drive every email subject, email body, PDF footer/stamp, page `<title>`, alt texts, and UI copy strings. Brand constants live at `artifacts/api-server/src/lib/brand.ts` and `artifacts/sprint-hub/src/lib/brand.ts`; both default to `"Reclaimed Media"` when the vars are unset. Wordmark image assets still need to be swapped manually.
- **Design Patterns:** Role-based routing, real-time toast feedback for mutations, and a component-based UI.
- **Charts:** Uses `recharts` for data visualization (e.g., GrowthChartCard).

## Technical Implementations

- **Monorepo:** pnpm workspaces.
- **Language:** TypeScript 5.9.
- **API Framework:** Express 5.
- **Database:** PostgreSQL with Drizzle ORM.
- **Validation:** Zod for schema validation.
- **API Codegen:** Orval generates API hooks and Zod schemas from an OpenAPI specification.
- **Build Tool:** esbuild for CJS bundling.
- **Authentication:** Replit OIDC for user authentication, with role-based authorization (`super_admin`, `admin`, `viewer`, `client`). Admin scopes (e.g. `support`, `clients`, `content`) further restrict in-role visibility, but the operator-management surfaces (`/admin/admins`, `/admin/settings`) are gated to `super_admin` only on both the backend (`requireAdmin(req,res,["super_admin"])`) and the frontend (wouter route guard that redirects non-super_admin to `/admin`).
- **Agreement Management:** Supports `uploaded` (PDF/DOCX with drag-drop fields) and `builder` (markdown with inline tokens) templates. DOCX conversion uses `libreoffice-convert`. PDF rendering and manipulation use `pdf-lib` and `pdfjs-dist`. Fields are position-agnostic (0..1 fractions). Status transitions are atomic.
- **Activity & Analytics:** `activity_events` table tracks user actions. `episode_progress` tracks client learning. Client health summaries are generated using AI, cached, and updated periodically.
- **Client Data Isolation:** All `/api/me/*` routes are strictly scoped to the authenticated client's ID, preventing cross-tenant data access. Impersonation features for admins are carefully managed to prevent unintended writes.
- **Courses:** Modules can be grouped into courses, and clients are assigned specific courses, acting as the primary content-isolation mechanism.
- **Client Documents:** `client_documents` table stores per-client files or external links, with secure access via signed URLs and object storage streaming.
- **Checklist Input Fields:** Episode checklists support `check`, `url`, and `text` input types, with responses stored in a JSONB column and managed via atomic updates.
- **Client Intelligence:** Implements `support_ticket_ratings` and `client_health_summaries` tables. `clientHealth.ts` loads signals, computes scores, and narrates client health using OpenAI.

## Feature Specifications

- **API Server:** Provides routes for client portal (`me.ts`), admin functionalities (`admin.ts`), and shared resources (e.g., `agreements.ts`, `documents.ts`). Includes a dev-only login backdoor for local development.
- **Admin Dashboard:** KPI cards, hero engagement growth chart (Mercury-style: single soft area, big headline number, half-vs-half momentum delta, component breakdowns as colored chips), client health overview, engagement detail card, support response card, recent activity feed, client and content CRUD, and agreement template management. Layout follows the "one number, one place" rule — every metric is sourced and rendered exactly once across the page (e.g. active client count lives only as a hint under the Total Clients KPI).
- **Client Portal:** Provides access to dashboard, learning modules, episode progress, ICP forms with autosave, and client-specific documents/agreements.
- **Agreement Flow:** Two-party signing process (`pending → viewed → client_signed → completed`).
- **Content Management:** Unified `/admin/content` page combines courses + modules + episodes into one course→module→episode editor (left rail = courses + an "Unattached" bucket for modules without a course; right pane = the active selection). The legacy `/admin/courses` route now redirects to `/admin/content`. AI course drafting (`/admin/courses/ai-draft`, `/admin/courses/ai-create`) lives in this page and is rate-limited per admin.
- **ICP as a lesson:** ICP is no longer a standalone client nav item. It renders inline as an episode of `kind === "icp"`. Submitting the ICP form auto-completes the episode via `/me/icp/submit`.
- **Notifications:** In-app + email fan-out via `notify`/`notifyScopedAdmins`. Triggered on: support reply (both directions), agreement signed (both regular + builder), per-module completion, all-modules completion, and ticket status changes. The single source of truth for `POST /admin/support/:id/messages` and `PATCH /admin/support/:id` lives in `routes/admin.ts` (registered before `routes/threads.ts`).
- **Support System:** Clients can rate resolved support tickets.
- **Security:** Open-redirect validation, input length capping, robust checks against cross-tenant data access. AI endpoints are rate-limited per admin (`lib/rateLimit.ts`, in-memory token bucket). Drizzle queries use `inArray()` rather than raw `= ANY(...)` to prevent malformed parameter binding.
- **Performance:** Hot-path indexes on `modules(course_id, position)`, `episodes(module_id, position)`, `support_tickets(client_id, last_message_at)`, `support_tickets(status, last_message_at)`, `support_ticket_messages(ticket_id, created_at)`, `agreement_assignments(client_id, assigned_at)`, `agreement_assignments(template_id)`, `agreement_events(assignment_id, created_at)`, plus the existing `notifications(audience, user_id, read_at)` and `episode_progress(client_id, episode_id)`. The `/admin/clients` list endpoint uses `buildAdminClientCtx` to batch the per-client `episode_progress` / `icp_responses` / `agreement_assignments` lookups into 3 `inArray()` queries instead of 3*N — see `artifacts/api-server/src/routes/admin.ts`. Single-client callers go through the back-compat `shapeAdminClient(c)` wrapper.
- **Episode-lock enforcement:** `ensureEpisodeVisible(client, id, res)` runs `buildClientModules` and rejects writes (`/me/episodes/:id/complete`, `/progress`, `/checklist`) with `403` when the episode is locked, mirroring the read-side gate. Pass `{ allowLocked: true }` for read paths that legitimately need locked metadata.
- **Agreement gate:** `getAgreementGateOpen(clientId)` is the single source of truth for sprint-content unlocking — it returns true ONLY when the client has at least one assignment AND every assignment is signed/completed. Zero assignments == CLOSED (a freshly onboarded client must not jump past the agreement). `/me/dashboard`, `/me/modules`, episode writes and `/me/icp/submit` all delegate to this helper. To prevent zero-assignment lockout, `ensureClientHasAgreementAssignment(clientId, log)` runs inside a transaction (so concurrent terms-accept double-taps can't double-insert) at terms-accept AND at the top of `/me/dashboard`, picking the most recently updated non-archived `agreement_templates` row. `buildClientModules` accepts `{ agreementGateOpen }` and locks every episode (including the auto-unlocked first episode) when the gate is closed; already-completed episodes are never relocked. The Modules page surfaces an amber banner with a `/agreements` CTA when the gate is closed. The dashboard's "Sign your service agreement" hero card replaces the old standalone "Start ICP Questionnaire" CTA — ICP is now reached via the unlocked module lesson.
- **Agreement PDF rendering (`lib/agreements.ts`):** Default Reclaimed Media wordmark is bundled into the api-server build via esbuild's `base64` loader (`build.mjs` → `loader: { ".png": "base64" }`, decoded once at module load with `Buffer.from(b64, "base64")`). Header logo (template-uploaded or fallback wordmark) is centered at the top of page 1, capped at 180×56 with ratio preservation, with a 24px gap before the title. `renderBuilderPdf` supports `#`/`##`/`###`/`#### ` heading levels (h3/h4 added because the default service agreement uses `### 2.1 Action Deposit` style numbering). `buildParagraphAtoms` does two-stage substitution: plain-text placeholder values (name/businessName/date/text) are inlined into the paragraph source BEFORE bold tokenization, so a `**…{{date}}…**` span no longer loses its `**` pair across segments and renders properly bold instead of with literal asterisks. Only drawn-initial images and unfilled placeholders use sentinels (`\u2063SP{i}\u2063`). The frontend `AgreementSign.tsx` preview also renders the centered Reclaimed Media wordmark above the title so on-screen and exported PDF match.
- **Cross-module gating:** Module N's episodes stay locked until every published episode in module N-1 is complete. Empty modules are treated as complete so they don't block downstream content.
- **Brand lockup:** Both `AdminLayout` and `ClientLayout` render a `BrandLockup` (Reclaimed Media wordmark) in three spots each (mobile top bar, mobile drawer, desktop sidebar). The wordmark asset is imported via the `@assets` alias.
- **Body caps:** `express.json({ limit: "5mb" })` and `express.urlencoded({ limit: "5mb" })` — generous enough for AI course-draft prompts and large agreement-builder templates while still cutting off JSON-bomb style DoS. Large binary uploads always go through dedicated multer routes (25–50MB caps).
- **Episode-lock probe protection:** When a write hits a locked episode, `ensureEpisodeVisible` returns `404` (not `403`) so an attacker can't distinguish "exists but locked" from "not in your courses" by ID-probing.
- **BrandLockup:** Single shared component at `artifacts/sprint-hub/src/components/BrandLockup.tsx` consumed by both `AdminLayout` and `ClientLayout`.

# External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **Email Service:** Resend (API Key: `RESEND_API_KEY`, configurable `RESEND_FROM` address)
- **AI Service:** OpenAI (for client health narration, specifically `gpt-5.4` via `lib/openai.ts`)
- **Object Storage:** Replit Object Storage (`PRIVATE_OBJECT_DIR`) for files, agreements, and logos.
- **PDF Libraries:** `pdf-lib` for PDF manipulation, `pdfjs-dist` for PDF rendering.
- **Document Conversion:** `libreoffice-convert` for DOCX to PDF conversion.
- **Charting Library:** `recharts` for graphical data representation.
- **OpenAPI Codegen:** Orval
- **Type Validation:** Zod (`zod/v4`), `drizzle-zod`