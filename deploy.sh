#!/bin/bash
# PermitPulse — Deploy the multi-tenant frontend to Cloudflare Pages
#
# PREREQUISITES:
# 1. npm install -g wrangler
# 2. wrangler login (one-time browser auth)
# 3. Set VITE_SUPABASE_ANON_KEY in .env.local or your shell
#
# USAGE: bash deploy.sh

set -e

echo "⚡ Building PermitPulse..."
corepack pnpm install
corepack pnpm build

echo "🚀 Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist \
  --project-name=permit-pulse-leads \
  --branch=main

echo ""
echo "✅ Frontend deployed!"
echo ""
echo "🌐 Current production URL:"
echo "  https://leads.metroglasspro.com"
echo ""
echo "📦 Pages project:"
echo "  permit-pulse-leads"
echo ""
echo "🤖 To deploy the scanner cron worker:"
echo "  npx wrangler deploy"
echo "  npx wrangler secret put GMAIL_TOKEN_ENCRYPTION_KEY"
echo ""
echo "🧭 New tenant onboarding checklist:"
echo "  1. Insert tenant + tenant user rows in Supabase"
echo "  2. Run node scripts/gmail-oauth-setup.mjs --tenant <slug> --email <workspace-email>"
echo "  3. Run node scripts/upload-attachment.mjs --tenant <slug> --file \"/absolute/path/About Us.pdf\""
echo "  4. Verify /api/tenant/me, Settings templates, and Gmail status after login"
echo ""
echo "  Worker stays on its workers.dev URL and keeps the scheduled jobs."
