# ⚡ PermitPulse — Setup & Operations Guide

## What This Does

PermitPulse now runs as two separate Cloudflare surfaces:

- Frontend: `https://leads.metroglasspro.com` via the `permit-pulse-leads` Pages project
- Scanner worker: `https://permit-pulse-scanner.donaldlena833.workers.dev` for cron jobs and worker-only endpoints

Worker schedule:

**7:00 AM ET** — Full scan + reply check + follow-ups
**6:00 PM ET** — Reply check + follow-ups only

Dashboard: https://leads.metroglasspro.com

---

## Gmail Setup (OAuth2 Refresh Token)

Since Google Workspace org policy blocks service account key creation, use OAuth2 refresh tokens instead.

### Prerequisites

Your OAuth client (already created):
- Client ID: `272556579487-un45g92vfltmu3e2o0ipq3j4rcahr18l.apps.googleusercontent.com`
- Client Secret: `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`

### Step 1: Add redirect URI to OAuth client

1. Google Cloud Console → APIs & Services → Credentials
2. Click your OAuth client
3. Under **Authorized redirect URIs**, add: `http://localhost:8080`
4. Save

### Step 2: Get authorization code

Open this URL in your browser:

```
https://accounts.google.com/o/oauth2/v2/auth?client_id=272556579487-un45g92vfltmu3e2o0ipq3j4rcahr18l.apps.googleusercontent.com&redirect_uri=http://localhost:8080&response_type=code&scope=https://www.googleapis.com/auth/gmail.send%20https://www.googleapis.com/auth/gmail.readonly&access_type=offline&prompt=consent
```

Sign in with `operations@metroglasspro.com`, click Allow.

Browser redirects to `http://localhost:8080?code=SOME_CODE_HERE` (page won't load — that's fine). Copy the `code` value from the URL bar.

### Step 3: Exchange code for refresh token

```bash
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "code=PASTE_AUTH_CODE" \
  -d "client_id=272556579487-un45g92vfltmu3e2o0ipq3j4rcahr18l.apps.googleusercontent.com" \
  -d "client_secret=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" \
  -d "redirect_uri=http://localhost:8080" \
  -d "grant_type=authorization_code"
```

Returns JSON with `refresh_token`. Save it.

### Step 4: Store secrets

```bash
npx wrangler secret put GMAIL_REFRESH_TOKEN
# Paste the refresh_token

npx wrangler secret put GMAIL_CLIENT_ID
# Paste: 272556579487-un45g92vfltmu3e2o0ipq3j4rcahr18l.apps.googleusercontent.com

npx wrangler secret put GMAIL_CLIENT_SECRET
# Paste: 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
```

### Default outreach attachment

PermitPulse is configured to attach a default PDF to every sent outreach email. To load the current LOKEIL one-pager:

```bash
npx wrangler kv key put --binding=PERMIT_PULSE default_outreach_attachment --path "/Users/donaldlena/Desktop/MetroGlass Pro - About Us.pdf"
```

### Step 5: Deploy + test the worker

```bash
npx wrangler deploy
curl -X POST https://permit-pulse-scanner.donaldlena833.workers.dev/gmail-test
```

---

## All Secrets

| Secret | Required | How to set |
|--------|----------|-----------|
| `GMAIL_REFRESH_TOKEN` | Yes (for Gmail) | OAuth flow above |
| `GMAIL_CLIENT_ID` | Yes (for Gmail) | OAuth client ID |
| `GMAIL_CLIENT_SECRET` | Yes (for Gmail) | OAuth client secret |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes, preferred | Worker-only database access, required before enabling RLS hardening |
| `SUPABASE_ANON_KEY` | Temporary fallback | Only keep during migration, then remove once service role is set |
| `RESEND_API_KEY` | Optional | For digest notification emails |
| `APOLLO_API_KEY` | Optional | For contact enrichment (free 10K/mo) |

## Supabase Security Hardening

PermitPulse now expects the worker to use `SUPABASE_SERVICE_ROLE_KEY` before you enable RLS on the lead tables.

1. Set the worker secret:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

2. Apply:

- `supabase/migrations/001_permit_pulse_automation.sql`
- `supabase/migrations/002_security_hardening.sql`

3. Redeploy the worker:

```bash
npx wrangler deploy
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Worker landing response |
| `/scan` | GET | Run full pipeline |
| `/drafts` | GET | List all drafts |
| `/drafts/:id/edit` | POST | Edit draft |
| `/drafts/:id/approve` | POST | Send via Gmail |
| `/drafts/:id/skip` | POST | Skip draft |
| `/drafts/:id/status` | POST | Update pipeline status |
| `/analytics` | GET | Funnel analytics |
| `/crm` | GET | All architect CRM records |
| `/crm/:license` | GET | Single architect history |
| `/check-replies` | POST | Check Gmail for replies |
| `/generate-followups` | POST | Generate follow-ups |
| `/gmail-test` | POST | Test Gmail send |
