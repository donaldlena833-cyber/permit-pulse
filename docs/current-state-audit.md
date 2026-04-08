# Current State Audit

## Product Reality

PermitPulse is no longer just a permit scraper.

Today it is an internal operator system for MetroGlass Pro that combines:

1. Permit ingestion
2. Lead enrichment
3. Company and contact resolution
4. Outbound routing and draft generation
5. Semi-automated sending and follow-up handling
6. Prospect list imports for non-permit outreach
7. Lightweight CRM memory and outcome tracking

The repo had drifted into two competing stories:

- an older monolithic architect-outreach engine
- a newer modular permit and outbound workflow platform

This refactor makes the modular path canonical and isolates the legacy paths.

## Canonical System

### Frontend

The live app shell is:

- `src/App.tsx`

The canonical feature areas are:

- `src/features/operator-console`
- `src/features/prospect-workspace`
- `src/features/auth`
- `src/features/onboarding`

What these do:

- `operator-console`: permit leads, lead detail, settings, metrics, audit, send controls
- `prospect-workspace`: imported outreach contacts, suppressions, reply handling, campaign-style follow-up queues
- `auth`: workspace sign-in, invite acceptance
- `onboarding`: internal-first workspace setup

### Worker

The live worker is:

- `worker/permit-pulse/index.mjs`
- `worker/permit-pulse/api.mjs`

The canonical pipeline is:

- `worker/permit-pulse/pipeline/ingest.mjs`
- `worker/permit-pulse/pipeline/resolve.mjs`
- `worker/permit-pulse/pipeline/contacts.mjs`
- `worker/permit-pulse/pipeline/score.mjs`
- `worker/permit-pulse/pipeline/route.mjs`
- `worker/permit-pulse/pipeline/draft.mjs`
- `worker/permit-pulse/pipeline/send.mjs`
- `worker/permit-pulse/pipeline/follow-up.mjs`
- `worker/permit-pulse/pipeline/outcomes.mjs`
- `worker/permit-pulse/pipeline/engine.mjs`
- `worker/permit-pulse/pipeline/scheduler.mjs`

The canonical support layer is:

- `worker/permit-pulse/lib/account.mjs`
- `worker/permit-pulse/lib/config.mjs`
- `worker/permit-pulse/lib/tenant-db.mjs`
- `worker/permit-pulse/lib/prospects.mjs`
- `worker/permit-pulse/lib/reply-sync.mjs`
- `worker/permit-pulse/lib/gmail.mjs`
- `worker/permit-pulse/lib/audit.mjs`

### Database

The active schema spine is the `v2_*` model, especially:

- `006_permit_pulse_v2.sql`
- `012_outbound_crm_hardening.sql`
- `013_workspace_accounts.sql`
- `015_tenantize_crm_data.sql`
- `016_growth_ready_productization.sql`

Core canonical tables now include:

- `v2_leads`
- `v2_company_candidates`
- `v2_email_candidates`
- `v2_lead_events`
- `v2_follow_ups`
- `v2_email_outcomes`
- `v2_domain_reputation`
- `v2_prospects`
- `v2_prospect_events`
- `v2_prospect_follow_ups`
- `v2_prospect_outcomes`
- `v2_prospect_suppressions`
- `v2_tenants`
- `v2_tenant_users`
- `v2_tenant_app_config`
- `v2_workspace_onboarding`
- `v2_workspace_attachments`
- `v2_workspace_mailboxes`
- `v2_audit_events`

## Legacy System

Legacy code is now isolated under:

- `legacy/monolith`
- `legacy/worker-monolith`
- `legacy/frontend-prototype`

This code is historical context only. It should not be treated as the future product path.

### Legacy Contents

- `legacy/monolith/permit-scanner.mjs`
- `legacy/monolith/gmail-integration.mjs`
- `legacy/worker-monolith/automation.mjs`
- `legacy/frontend-prototype/permit-pulse/*`

## Runtime Paths

### Auth Path

1. User signs in with Supabase Auth
2. Worker authenticates the bearer token against Supabase
3. `resolveTenantContext` resolves workspace membership
4. Invite-only access is enforced through `v2_tenant_users`
5. The app routes to onboarding or `/app/*` depending on workspace readiness

### App Path

1. `src/App.tsx` routes between login, signup, invite, onboarding, and `/app/*`
2. `useOperatorConsole` loads health, today, leads, prospects, config, and system state
3. Screens operate against the worker API only
4. Lead and prospect detail drawers drive manual actions and exceptions

### Worker Path

1. `handlePermitPulseRequest` receives HTTP traffic
2. Request auth is validated
3. Workspace context is resolved
4. `createTenantScopedDb` applies workspace scoping
5. API routes call either:
   - permit pipeline modules
   - prospect workflow modules
   - workspace/account modules
   - config/audit/reporting modules

### Scheduled Path

1. Cloudflare scheduled event hits `worker/permit-pulse/index.mjs`
2. `runScheduledWork` enumerates active workspaces
3. Each workspace gets its own scoped DB view
4. Permit and prospect automation run against workspace config and workspace mailbox state

## Data Flow

The current canonical data flow is:

1. Source signal
   - DOB permit data or imported prospect CSV
2. Ingested record
   - raw permit is normalized into `v2_leads`
3. Company resolution
   - candidate companies stored in `v2_company_candidates`
4. Contact discovery
   - email candidates stored in `v2_email_candidates`
5. Trust and readiness
   - candidate trust, route choice, and review state calculated in pipeline modules
6. Draft generation
   - subject/body stored on lead or prospect records
7. Sending
   - Gmail sender uses workspace mailbox if connected
8. Follow-up
   - queued in `v2_follow_ups` or `v2_prospect_follow_ups`
9. Outcome
   - replies, bounces, opt-outs, wins, losses
10. Memory
   - timeline events, audit events, suppressions, and run history

## Auth Flow

The auth story is now mostly correct for an internal-first workspace app:

- Supabase Auth handles identity
- `v2_tenant_users` handles workspace membership
- invite acceptance is explicit
- domain auto-join is no longer the canonical behavior

What is still intentionally internal-first:

- owner signup still exists, but the product is not being positioned as public self-serve SaaS
- mailbox connection is now treated as manual-by-default
- billing exists in the worker but is intentionally not a primary product surface

## Frontend Flow

The main UI now supports a coherent operator workflow:

- `Today`: throughput, send budget, automation backlog, follow-ups, reply sync
- `Leads`: permit lead queue with state explanation
- `Lead Detail`: route choice, trust evidence, timeline, follow-ups, outcomes
- `Outreach`: imported prospect workflow and suppression handling
- `Settings`: workspace profile, files, mailbox status, invites, safety controls, audit trail

The frontend is still MetroGlass-friendly in tone, but the underlying structure is no longer MetroGlass-only.

## Worker Flow

The worker is now centered around the product spine:

1. ingest
2. resolve
3. discover
4. score
5. route
6. draft
7. send
8. follow up
9. outcome
10. audit

This is the right backbone to keep.

## Database Flow

The schema direction is ahead of the runtime in the right places:

- workspace/account/config tables exist
- tenant scoping exists for live CRM tables
- attachments and mailboxes are modeled as workspace resources
- audit and metrics have workspace-aware endpoints

The main remaining challenge is not missing tables. It is keeping runtime behavior and repo story aligned with the schema.

## Major Risks

### 1. Legacy Narrative Drift

The repo still had top-level docs and scripts describing a deprecated worker and outdated routes. That created architecture confusion even when the runtime code was already better.

### 2. Internal vs SaaS Messaging Drift

The code had started exposing billing and self-serve mailbox flows that do not match the current product maturity. This was misleading for both users and future contributors.

### 3. Manual Mailbox Reality

Workspace mailbox support exists in the data model and worker, but self-serve Gmail connect is not reliable enough for new users. Treating it as manual is the safer, more honest current state.

### 4. Two Outbound Systems in One Repo

Permit leads and imported prospects now coexist successfully, but the repo still needed a cleaner narrative that they are both part of one operator system, not unrelated products.

### 5. Legacy Entry Point Drift

`permit-scanner.mjs` and older monolith files were still referenced conceptually even though the real worker now lives under `worker/permit-pulse`.

## Keep / Move / Deprecate / Remove

### Keep

- `worker/permit-pulse/*` modular worker and pipeline
- `src/App.tsx` router shell
- `src/features/operator-console/*`
- `src/features/prospect-workspace/*`
- workspace-aware schema and scoped DB wrapper
- invite-only membership model
- attachments, audit, reply sync, and safety controls

### Move

- old monolith code into `legacy/*`
- old frontend prototype into `legacy/frontend-prototype`
- MetroGlass-specific lead profile naming toward generic product naming in canonical runtime code

### Deprecate

- top-level monolithic worker narrative
- public-facing SaaS assumptions in README and UI copy
- self-serve Gmail connect as a default product path
- billing as an active operator feature

### Remove

- duplicate canonical stories
- docs that describe the wrong system as current
- manual-password user-creation thinking as the preferred path

## Refactor Recommendations

1. Keep one canonical runtime path and keep archiving legacy instead of reusing it.
2. Keep MetroGlass branding in presentation, not in the architecture spine.
3. Treat workspace readiness as a boundary, not as full SaaS.
4. Keep sending conservative until mailbox setup is manual and verified.
5. Continue improving explainability so every lead state has an operator-readable reason.
6. Keep documentation aligned with the code every time the product story changes.

## Canonical Decision

PermitPulse should be treated as:

An operator-first lead intelligence and outreach operating system for specialty contractors, optimized for MetroGlass Pro today, with workspace-ready boundaries for future commercialization.
