# ⚡ PermitPulse v3 — Setup Guide

## What This Does

Every morning at 7am ET, PermitPulse:

1. Scans all new DOB Job Application Filings from the last 72 hours
2. Filters to architect-filed luxury residential alterations in Manhattan, Brooklyn, Queens ($75K+)
3. Scores each architect based on: neighborhood fit, project cost, building type, filing history volume, Manhattan focus
4. Removes anyone already picked (never repeats)
5. Picks the **top 5 new architects** of the day
6. Drafts a personalized outreach email for each one referencing their specific project
7. Emails you the digest at operations@metroglasspro.com

You review the 5 drafts over coffee, edit to your voice, and send from your Gmail. 10 minutes, 5 high-quality architect contacts per day, ~25 per week.

---

## Quick Deploy (20 minutes)

### 1. Clone the repo

```bash
git clone https://x-access-token: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@github.com/donaldlena833-cyber/permit-pulse.git
cd permit-pulse
```

### 2. Login to Cloudflare

```bash
npm install -g wrangler
wrangler login
```

### 3. Create KV namespace (stores picked architects)

```bash
npx wrangler kv namespace create PERMIT_PULSE
```

This outputs an ID like `abc123def456`. Open `wrangler.toml` and replace `YOUR_KV_NAMESPACE_ID_HERE` with that ID.

### 4. Set up Resend (email delivery)

1. Go to [resend.com](https://resend.com) → Sign up (free)
2. Add domain: `metroglasspro.com` → add the DNS records in Cloudflare
3. Get your API key

```bash
npx wrangler secret put RESEND_API_KEY
# paste your Resend API key
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Test it

```bash
curl https://permit-pulse-scanner.YOUR_SUBDOMAIN.workers.dev/scan
```

You should see the pipeline run and get an email within 30 seconds with your first 5 architect picks.

---

## Daily Workflow

**7:00 AM** — PermitPulse runs automatically

**~7:05 AM** — You get an email with 5 architect cards, each showing:
- Architect name + RA license + filing history
- The specific project that triggered the pick (address, cost, building, floor)
- Why they scored high (reasons)
- Their recent project list
- A **draft outreach email** ready to edit
- Links: Google search (find their firm), Maps, DOB BIS

**Your 10-minute routine:**
1. Open the digest email
2. For each of the 5 picks:
   - Click "Find firm + email" to Google the architect and find their contact
   - Copy the draft email, paste into Gmail, edit to your voice
   - Send from operations@metroglasspro.com
3. Done. 5 new architect contacts made.

---

## How Scoring Works

Each architect gets scored 0-100 on two dimensions:

### Current Filing Score (project quality)
| Signal | Points | What it means |
|--------|--------|--------------|
| Tier 1 neighborhood | +15 | UES, UWS, Tribeca, SoHo, Chelsea, Park Slope, etc. |
| Tier 2 neighborhood | +8 | Harlem, Astoria, LIC, Hudson Yards, etc. |
| Sweet spot cost ($150K-$2M) | +12 | Luxury apartment renovation range |
| Mega project ($2M+) | +8 | Large-scale, multi-trade project |
| High-rise (10+ stories) | +6 | Co-op/condo building |
| Residential building | +8 | Has dwelling units |
| Penthouse | +5 | Premium unit, high-end client |

### Architect History Score (practice quality)
| Signal | Points | What it means |
|--------|--------|--------------|
| 10+ filings in 2 years | +30 | High-volume practice — ideal partner |
| 5-9 filings in 2 years | +20 | Established practice |
| 3-4 filings | +10 | Active |
| 70%+ Manhattan-focused | +10 | Works your territory |
| 3+ target neighborhoods | +5 | Diverse across your areas |
| Avg project $150K+ | +8 | Consistent high-end work |

---

## No Repeats

The system uses Cloudflare KV to track every architect it has ever picked. Once picked, an architect won't appear again for 180 days. This means:

- Week 1: 25 new architects
- Month 1: ~100 new architects
- Month 3: ~300 architects in your network pipeline

After 6 months, an architect becomes eligible again — by then you either have a relationship or it's worth a re-introduction.

To see everyone who's been picked:
```bash
curl https://permit-pulse-scanner.YOUR_SUBDOMAIN.workers.dev/picked
```

---

## Troubleshooting

**No picks showing up?**
The system needs at least 1 new qualifying filing in the last 3 days that hasn't been picked before. On slow filing days (weekends, holidays), you might get fewer than 5.

**Want to reset the picked list?**
```bash
npx wrangler kv key list --binding PERMIT_PULSE | jq -r '.[].name' | while read key; do
  npx wrangler kv key delete --binding PERMIT_PULSE "$key"
done
```

**Want to change the number of daily picks?**
Edit `DAILY_PICKS` at the top of `permit-scanner.mjs` and redeploy.
