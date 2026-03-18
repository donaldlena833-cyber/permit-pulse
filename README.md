# ⚡ PermitPulse

**NYC construction lead intelligence and outbound automation for MetroGlass Pro**

PermitPulse now runs as a permit scanner, enrichment engine, contact resolver, channel selector, and Gmail sender for MetroGlass Pro's permit-driven outbound workflow.

## Architecture

- **Frontend** (`src/`) — React + TypeScript + Tailwind + shadcn/ui, deployed to Cloudflare Pages
- **Automation Worker** (`permit-scanner.mjs`) — Cloudflare Worker with cron triggers and `/api/v2/*` automation routes
- **Primary database** (`supabase/migrations/001_permit_pulse_automation.sql`) — Supabase/Postgres schema for leads, enrichment, contacts, outreach, and activity logs
- **Public data + enrichment** — NYC Open Data, Google Maps, Brave Search, Firecrawl, ZeroBounce, Gmail OAuth

## Automation Flow

1. Scan DOB permits from `rbx6-tga4`
2. Normalize address, borough, cost, work type, and description
3. Enrich property context from PLUTO, HPD, ACRIS links, and Google Maps
4. Resolve owner or applicant company with Brave Search
5. Scrape high-value websites with Firecrawl
6. Collect public emails and phones, then generate guessed email patterns
7. Verify high-value emails with ZeroBounce before send
8. Score lead fit, contactability, outreach readiness, and best channel
9. Generate rotating email drafts with the project address inserted automatically
10. Auto-send via Gmail when confidence, throttling, duplicate, and business-hour rules all pass

## Scoring Engine

Each permit is scored on 7 dimensions (max 100):
| Signal | Max Pts | Description |
|--------|---------|-------------|
| Direct Keyword | 40 | Permit description explicitly mentions trade terms |
| Inferred Need | 20 | Renovation type that typically requires this trade |
| Budget Fit | 15 | Job cost falls in the trade's sweet spot range |
| Commercial | 10 | Business type that commonly needs this trade |
| Building Type | 8 | Building characteristics matching target clients |
| Recency | 10 | Permits issued in last 3 days score highest |
| Location | 7 | Priority borough + neighborhood match |

**Lead Tiers:** Hot (≥45), Warm (≥25), Cold (<25)

## Deployment

### Frontend (Cloudflare Pages)
```bash
pnpm install
pnpm build
bash deploy.sh
```

### Worker + Automation APIs (Cloudflare Worker)
```bash
npx wrangler deploy
```

Cron triggers: 7am ET and 6pm ET.

## Required Env Vars

Worker secrets or vars:

- `BRAVE_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `ZEROBOUNCE_API_KEY`
- `FIRECRAWL_API_KEY`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Optional frontend build var:

- `PERMIT_PULSE_WORKER_URL`

## Supabase Schema

Apply the migration in:

- `supabase/migrations/001_permit_pulse_automation.sql`

Core tables:

- `leads`
- `property_profiles`
- `company_profiles`
- `contacts`
- `enrichment_facts`
- `outreach`
- `activity_log`

## License

Private — MetroGlassPro LLC
