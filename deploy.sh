#!/bin/bash
# PermitPulse — Deploy the V2 frontend to Cloudflare Pages
#
# PREREQUISITES:
# 1. npm install -g wrangler
# 2. wrangler login (one-time browser auth)
#
# USAGE: bash deploy.sh

set -e

echo "⚡ Building PermitPulse..."
pnpm install
pnpm build

echo "🚀 Deploying to Cloudflare Pages..."
npx wrangler pages deploy dist \
  --project-name=permit-pulse-leads \
  --branch=main

echo ""
echo "✅ Frontend deployed!"
echo ""
echo "🌐 Production URL:"
echo "  https://leads.metroglasspro.com"
echo ""
echo "📦 Pages project:"
echo "  permit-pulse-leads"
echo ""
echo "🤖 To deploy the scanner cron worker:"
echo "  npx wrangler deploy"
echo "  npx wrangler secret put RESEND_API_KEY"
echo ""
echo "  Worker stays on its workers.dev URL and keeps the scheduled scan jobs."
