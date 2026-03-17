# ⚡ PermitPulse

**NYC Construction Lead Intelligence Platform**

Scans NYC DOB permit data in real-time, scores leads against trade profiles, and surfaces hot opportunities for glass, tile, HVAC, plumbing, and other specialty subcontractors.

## Architecture

- **Dashboard** (`src/`) — React + TypeScript + Tailwind + shadcn/ui, deployed to Cloudflare Pages
- **Scanner** (`permit-scanner.mjs`) — Cloudflare Worker with cron triggers, runs 2x daily
- **API** — NYC Open Data SODA API (DOB NOW Approved Permits, dataset `rbx6-tga4`)

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

### Dashboard (Cloudflare Pages)
```bash
pnpm install
pnpm build
# Deploy dist/ to Cloudflare Pages
```

### Scanner (Cloudflare Worker)
```bash
npx wrangler deploy
npx wrangler secret put RESEND_API_KEY
```

Cron triggers: 8am ET + 6pm ET daily.

## Multi-Tenant

Built for multiple trade profiles. Currently configured:
- 🪟 **MetroGlassPro LLC** — Glass, mirrors, shower doors, storefronts
- 🧱 Tile & Stone (ready to configure)
- ❄️ HVAC (ready to configure)
- 🔧 Plumbing (ready to configure)

## License

Private — MetroGlassPro LLC
