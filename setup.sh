#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PermitPulse — One-Command Setup
# Run this on your Mac after cloning the repo
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -e
echo ""
echo "⚡ PermitPulse Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js not found. Install it: https://nodejs.org"; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "❌ npx not found. Install Node.js: https://nodejs.org"; exit 1; }

# Step 1: Install wrangler globally if needed
echo "📦 Step 1: Checking wrangler..."
if ! command -v wrangler &> /dev/null; then
  echo "   Installing wrangler..."
  npm install -g wrangler
fi
echo "   ✅ wrangler ready"

# Step 2: Login to Cloudflare
echo ""
echo "🔐 Step 2: Cloudflare login"
echo "   This will open your browser. Log in with your Cloudflare account."
echo "   (If you're already logged in, it'll skip this)"
echo ""
wrangler whoami 2>/dev/null || wrangler login

# Step 3: Create KV namespace
echo ""
echo "📁 Step 3: Creating KV namespace for architect tracking..."
KV_OUTPUT=$(wrangler kv namespace create PERMIT_PULSE 2>&1)
echo "$KV_OUTPUT"

# Extract the KV ID from output
KV_ID=$(echo "$KV_OUTPUT" | grep -o 'id = "[^"]*"' | grep -o '"[^"]*"' | tr -d '"')
if [ -z "$KV_ID" ]; then
  echo ""
  echo "⚠️  Couldn't auto-detect KV namespace ID."
  echo "   Look at the output above — find the line that says id = \"...\""
  echo "   Then manually edit wrangler.toml and replace YOUR_KV_NAMESPACE_ID_HERE"
  echo ""
  read -p "   Paste the KV namespace ID here (or press Enter to skip): " KV_ID
fi

if [ -n "$KV_ID" ]; then
  # Update wrangler.toml with the KV ID
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/YOUR_KV_NAMESPACE_ID_HERE/$KV_ID/" wrangler.toml
  else
    sed -i "s/YOUR_KV_NAMESPACE_ID_HERE/$KV_ID/" wrangler.toml
  fi
  echo "   ✅ KV namespace ID set in wrangler.toml"
fi

# Step 4: Set Resend API key
echo ""
echo "📧 Step 4: Resend API key (for daily digest notification emails)"
echo ""
echo "   You need a Resend account for the daily digest email."
echo "   1. Go to https://resend.com and sign up (free)"
echo "   2. Add your domain: metroglasspro.com"
echo "   3. Get your API key from Settings → API Keys"
echo ""
read -p "   Do you have a Resend API key ready? (y/n): " HAS_RESEND
if [ "$HAS_RESEND" = "y" ] || [ "$HAS_RESEND" = "Y" ]; then
  echo "   Setting Resend API key as secret..."
  wrangler secret put RESEND_API_KEY
else
  echo "   ⏭️  Skipping Resend for now. You can add it later with:"
  echo "      npx wrangler secret put RESEND_API_KEY"
fi

# Step 5: Gmail setup
echo ""
echo "📨 Step 5: Gmail API (for sending outreach emails)"
echo ""
echo "   This is optional but recommended. It lets the dashboard"
echo "   send emails directly from operations@metroglasspro.com."
echo ""
echo "   Setup steps (do this in your browser):"
echo "   1. Google Cloud Console → create project → enable Gmail API"
echo "   2. Create Service Account → download JSON key"
echo "   3. Google Workspace Admin → Security → API Controls"
echo "      → Domain-wide Delegation → add service account client_id"
echo "      → scope: https://www.googleapis.com/auth/gmail.send"
echo ""
read -p "   Do you have the Google Service Account JSON ready? (y/n): " HAS_GMAIL
if [ "$HAS_GMAIL" = "y" ] || [ "$HAS_GMAIL" = "Y" ]; then
  echo "   Setting Google Service Account as secret..."
  echo "   (paste the ENTIRE JSON content, then press Enter)"
  wrangler secret put GOOGLE_SERVICE_ACCOUNT
else
  echo "   ⏭️  Skipping Gmail for now. You can add it later with:"
  echo "      npx wrangler secret put GOOGLE_SERVICE_ACCOUNT"
  echo "   Without this, the dashboard will draft emails but you'll"
  echo "   need to copy-paste them into Gmail manually."
fi

# Step 6: Deploy the worker
echo ""
echo "🚀 Step 6: Deploying PermitPulse worker..."
wrangler deploy

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ PermitPulse is live!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Your worker URL should be printed above (something like:"
echo "  https://permit-pulse-scanner.xxxxx.workers.dev)"
echo ""
echo "📋 What to do now:"
echo ""
echo "  1. TEST IT: Open the URL above + /scan in your browser"
echo "     This runs the full pipeline and emails you the first 5 picks."
echo ""
echo "  2. DASHBOARD: Open the URL above (just the root /) to see"
echo "     the review/approve dashboard where you edit + send emails."
echo ""
echo "  3. AUTOMATIC: The scanner runs every day at 7am ET."
echo "     You'll get a digest email, then open the dashboard to approve."
echo ""
echo "  4. GMAIL (if not set up yet): Follow the steps above to"
echo "     enable sending directly from operations@metroglasspro.com."
echo "     Until then, copy-paste drafts from the dashboard into Gmail."
echo ""
