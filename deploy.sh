#!/bin/bash
# PermitPulse — Deploy to Cloudflare Pages
# 
# PREREQUISITES:
# 1. npm install -g wrangler
# 2. wrangler login (one-time browser auth)
# 3. In Cloudflare dashboard: add CNAME record for leads.metroglasspro.com
#
# USAGE: bash deploy.sh

set -e

echo "⚡ Building PermitPulse..."
pnpm install
pnpm build

echo "🚀 Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist \
  --project-name=permit-pulse \
  --branch=main

echo ""
echo "✅ Dashboard deployed!"
echo ""
echo "📋 NEXT STEPS:"
echo "  1. Go to Cloudflare Dashboard → Pages → permit-pulse → Custom domains"
echo "  2. Add: leads.metroglasspro.com"
echo "  3. Cloudflare will auto-provision SSL"
echo ""
echo "🤖 To deploy the scanner cron worker:"
echo "  npx wrangler deploy"
echo "  npx wrangler secret put RESEND_API_KEY"
echo ""
echo "  Scanner will run at 8am + 6pm ET daily."
