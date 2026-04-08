# PermitPulse

Internal lead intelligence and outreach operating system for MetroGlass Pro.

PermitPulse is optimized for one real operator workflow today:

1. pull permit data and other lead signals
2. enrich and resolve the right company
3. discover and score contact routes
4. generate drafts
5. send carefully
6. track replies, follow-ups, and outcomes
7. keep enough CRM memory to run the business

The codebase is workspace-ready in architecture, but it is not pretending to be a polished public SaaS yet.

## Canonical Architecture

### Frontend

- `src/App.tsx`
- `src/features/operator-console`
- `src/features/prospect-workspace`
- `src/features/auth`
- `src/features/onboarding`

### Worker

- `worker/permit-pulse/index.mjs`
- `worker/permit-pulse/api.mjs`
- `worker/permit-pulse/pipeline/*`
- `worker/permit-pulse/lib/*`

### Database

Use the `v2_*` schema and current migrations in `supabase/migrations`.

Most important migrations:

- `006_permit_pulse_v2.sql`
- `012_outbound_crm_hardening.sql`
- `013_workspace_accounts.sql`
- `015_tenantize_crm_data.sql`
- `016_growth_ready_productization.sql`

## Product Spine

The canonical lifecycle is:

1. ingest
2. normalize
3. resolve company
4. discover contacts
5. trust score
6. route
7. draft
8. send
9. follow up
10. outcome
11. audit and memory

Permit leads and imported prospect outreach both run on top of this same spine.

## Current Product Mode

What is true right now:

- internal MetroGlass operator system first
- workspace/account boundaries exist in architecture
- invite-only access exists
- workspace files, config, audit, and mailbox state exist
- self-serve Gmail connect is disabled by default
- self-serve billing is intentionally not an active product surface

What is intentionally not true yet:

- polished public onboarding
- mature commercial billing workflow
- generalized CRM product for everyone
- fully abstract multi-tenant platform work

## Legacy Code

Historical code lives under:

- `legacy/monolith`
- `legacy/worker-monolith`
- `legacy/frontend-prototype`

Do not treat those folders as the live product path.

## Running the App

### Frontend

```bash
pnpm install
pnpm build
```

### Worker

```bash
npx wrangler deploy
```

### Optional compatibility scan trigger

`npm run scan` now uses the root `permit-scanner.mjs` compatibility shim.

If you want it to hit the live worker directly, provide:

- `PERMIT_PULSE_SCAN_URL`
- `PERMIT_PULSE_ACCESS_TOKEN`

Otherwise, use the operator console or call `POST /api/scan` manually.

## Environment Notes

Core worker secrets and vars typically include:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `BRAVE_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `FIRECRAWL_API_KEY`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `WORKSPACE_TOKEN_ENCRYPTION_KEY`

Optional product-mode flags:

- `MAILBOX_SELF_SERVE_CONNECT`
- `BILLING_SELF_SERVE_ENABLED`

Both product-mode flags are expected to remain disabled for internal-first operation unless you intentionally open those flows.

## Recommended Docs

- `docs/current-state-audit.md`
- `docs/target-architecture.md`
- `docs/refactor-plan.md`
- `docs/operator-workflow.md`

## License

Private repository for MetroGlass Pro.
