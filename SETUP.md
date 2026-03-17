# ⚡ PermitPulse — Setup & Deployment Guide

## What You Have

**Repo:** `github.com/donaldlena833-cyber/permit-pulse` (private)

| Component | File | What It Does |
|-----------|------|-------------|
| Dashboard | `src/App.tsx` + `src/index.css` | React app — live DOB permit scanner with scoring |
| Scanner | `permit-scanner.mjs` | Automated cron script — fetches, scores, emails leads |
| Worker Config | `wrangler.toml` | Cloudflare Worker cron schedule (8am + 6pm ET) |
| Deploy Script | `deploy.sh` | One-command deploy to Cloudflare Pages |

---

## Step 1: Deploy the Dashboard (5 minutes)

On your Mac, open Terminal:

```bash
# Clone the repo
git clone https://x-access-token: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@github.com/donaldlena833-cyber/permit-pulse.git
cd permit-pulse

# Install dependencies
pnpm install

# Build
pnpm build

# Login to Cloudflare (opens browser — use your MetroGlassPro account)
npx wrangler login

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=permit-pulse --branch=main
```

After the first deploy, Cloudflare gives you a URL like `permit-pulse-xxx.pages.dev`. You can use that immediately.

### Add Custom Domain: `leads.metroglasspro.com`

1. Go to **Cloudflare Dashboard → Pages → permit-pulse → Custom Domains**
2. Click **Set up a custom domain**
3. Enter: `leads.metroglasspro.com`
4. Cloudflare auto-provisions SSL since metroglasspro.com is already on Cloudflare

---

## Step 2: Set Up Email Alerts (10 minutes)

### Create a Resend Account (free tier = 100 emails/day)

1. Go to [resend.com](https://resend.com) → Sign up
2. **Add your domain:** Settings → Domains → Add `metroglasspro.com`
   - Add the DNS records Resend gives you (2 TXT records in Cloudflare DNS)
   - Wait for verification (~5 min)
3. **Get your API key:** Settings → API Keys → Create

### Deploy the Scanner Worker

```bash
cd permit-pulse

# Deploy the worker
npx wrangler deploy

# Add your Resend API key as a secret
npx wrangler secret put RESEND_API_KEY
# (paste your Resend API key when prompted)
```

### Update Email Address

In `permit-scanner.mjs`, find this line near the top of the `TENANTS` object:

```javascript
email: 'info@metroglasspro.com',  // UPDATE: your actual email
```

Change it to your preferred email. Commit + push + redeploy:

```bash
git add -A && git commit -m "Update email" && git push
npx wrangler deploy
```

### Test It

```bash
# Trigger a manual scan
curl https://permit-pulse-scanner.YOUR_SUBDOMAIN.workers.dev/scan
```

You should get a JSON response with lead counts, and an email in your inbox within 30 seconds.

---

## Step 3: Daily Operation

### What Happens Automatically

- **8:00 AM ET** — Scanner pulls last 3 days of permits, scores them, emails you hot + warm leads
- **6:00 PM ET** — Same thing, catches any permits issued during the day

### What You Do

When you get the email digest:

1. **🔥 Hot Leads** — These have explicit glass/mirror/storefront mentions OR are high-value renovations in your target area. **Call the GC listed** — they're the one managing the project and hiring subs.

2. **Warm Leads** — Big renovations that likely need glass but didn't explicitly mention it. Worth a quick call to the GC: *"Hey, I saw you pulled a permit for [address]. We're MetroGlassPro — we do custom shower doors and glass for Manhattan projects. Do you need a glass sub on this one?"*

3. **Dashboard** — Open `leads.metroglasspro.com` anytime to run a fresh scan, search by GC name, filter by borough, or dig into a specific lead's full details (DOB BIS link, Google Maps, owner info).

---

## Adding Other Trades (Your Revenue Play)

When you're ready to add your tile guy, HVAC guy, plumber:

### 1. Add Their Profile to `permit-scanner.mjs`

In the `TENANTS` object, add a new entry:

```javascript
tile_specialist: {
  id: 'tile_specialist',
  name: 'ABC Tile Co',
  email: 'guy@abctile.com',
  // ... keywords, boroughs, etc.
}
```

### 2. The Business Model

**Option A — Sell Leads ($50-200/lead)**
You run PermitPulse, surface hot leads for their trade, and charge per lead delivered.

**Option B — Revenue Share (5-10%)**
Free leads, but you take a cut when they close the job.

**Option C — Monthly Subscription ($200-500/mo)**
Flat fee for daily lead emails + dashboard access.

### 3. Multi-Tenant Dashboard (Phase 2)

When you have 3+ paying trades, we add:
- Supabase auth — each trade gets a login
- Separate dashboards with their own profile/keywords
- Lead status tracking (new → contacted → quoted → won → lost)
- Revenue tracking per lead source

---

## How the Scoring Works

Each permit gets scored 0-100 based on your MetroGlassPro profile:

| Signal | Points | Example |
|--------|--------|---------|
| Direct keyword match | Up to 40 | "install new storefront glass" |
| Inferred need | Up to 20 | "gut renovation" (almost always needs glass) |
| Budget sweet spot | Up to 15 | $50K-$2M projects |
| Commercial signal | Up to 10 | "pilates studio", "restaurant" |
| Building type | Up to 8 | "luxury condo", "brownstone" |
| Recency | Up to 10 | Issued within 3 days |
| Location | Up to 7 | Manhattan + target neighborhood |

**Hot ≥ 45** — Call immediately
**Warm ≥ 25** — Worth investigating
**Cold < 25** — Background noise

---

## Troubleshooting

**Scanner not sending emails?**
- Check: `npx wrangler tail` to see live logs
- Verify Resend domain is verified
- Check Resend dashboard for delivery status

**No leads showing up?**
- Expand the date range (try 30 days instead of 14)
- Lower the minimum cost
- Check that the DOB API is responding: visit `https://data.cityofnewyork.us/resource/rbx6-tga4.json?$limit=1` in your browser

**Want to update keywords?**
- Edit the `directKeywords` or `inferredKeywords` arrays in both `src/App.tsx` (dashboard) and `permit-scanner.mjs` (cron)
- Rebuild + redeploy both
