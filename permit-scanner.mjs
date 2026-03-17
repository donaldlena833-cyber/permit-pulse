/**
 * PermitPulse — Automated DOB Permit Scanner
 * 
 * Runs twice daily (8am + 6pm ET) via cron.
 * Queries NYC DOB Open Data API, scores permits against tenant profiles,
 * and sends email digest of hot/warm leads.
 * 
 * DEPLOYMENT OPTIONS:
 * 1. Cloudflare Worker + Cron Trigger (recommended — free tier covers this)
 * 2. Supabase Edge Function + pg_cron
 * 3. GitHub Actions scheduled workflow
 * 4. Simple VPS cron job (node permit-scanner.mjs)
 * 
 * ENV VARS NEEDED:
 * - RESEND_API_KEY (or SENDGRID_API_KEY) for email
 * - SUPABASE_URL + SUPABASE_KEY (if storing leads in DB)
 * - NOTIFY_EMAIL (where to send the digest)
 */

const API_BASE = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TENANT PROFILES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TENANTS = {
  metroglasspro: {
    id: 'metroglasspro',
    name: 'MetroGlassPro LLC',
    email: 'info@metroglasspro.com',  // UPDATE: your actual email
    color: '#D4691A',

    directKeywords: [
      'glass', 'mirror', 'glazing', 'storefront', 'shower door', 'shower enclosure',
      'glass partition', 'glass railing', 'curtain wall', 'glass door', 'glass panel',
      'frameless', 'tempered glass', 'glass shelf', 'glass backsplash',
      'window replacement', 'new windows', 'replace window', 'new storefront',
      'replace storefront', 'glass wall', 'sliding glass', 'pivot door',
      'glass balcony', 'glass stair', 'glass divider',
    ],

    inferredKeywords: [
      'bathroom renovation', 'bathroom remodel', 'gut renovation', 'full renovation',
      'master bathroom', 'master bath', 'en-suite', 'ensuite',
      'interior renovation', 'interior alteration', 'interior demo',
      'buildout', 'build-out', 'fit-out', 'fitout', 'tenant improvement',
      'new finishes', 'new fixtures', 'remove and replace', 'complete renovation',
      'luxury renovation', 'high-end renovation', 'condo renovation',
      'apartment renovation', 'residential renovation', 'kitchen and bath',
      'penthouse', 'duplex renovation', 'brownstone renovation',
    ],

    commercialSignals: [
      'restaurant', 'hotel', 'boutique hotel', 'gym', 'fitness', 'pilates',
      'yoga studio', 'spa', 'salon', 'medical office', 'dental office',
      'clinic', 'retail', 'boutique', 'gallery', 'showroom',
      'bar', 'lounge', 'cafe', 'bakery', 'studio',
    ],

    buildingSignals: [
      'high-rise', 'high rise', 'condo', 'co-op', 'luxury', 'penthouse',
      'brownstone', 'townhouse', 'loft', 'pre-war', 'prewar',
    ],

    excludeKeywords: [
      'demolition only', 'full demolition', 'asbestos', 'abatement',
      'sidewalk shed', 'construction fence', 'scaffolding only',
      'boiler replacement', 'elevator', 'fire escape', 'roofing only',
    ],

    workTypes: ['General Construction'],
    minCost: 25000,
    sweetSpotMin: 50000,
    sweetSpotMax: 2000000,
    primaryBoroughs: ['MANHATTAN'],
    secondaryBoroughs: ['BROOKLYN', 'QUEENS'],
    targetNeighborhoods: [
      'upper east side', 'upper west side', 'midtown', 'chelsea',
      'greenwich village', 'soho', 'tribeca', 'financial district',
      'gramercy', 'murray hill', 'east village', 'park slope',
      'williamsburg', 'dumbo', 'brooklyn heights', 'cobble hill',
      'astoria', 'long island city',
    ],
  },

  // ADD MORE TENANTS HERE:
  // tile_guy: { ... },
  // hvac_specialist: { ... },
  // plumber: { ... },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCORING ENGINE (mirrors the frontend exactly)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function scorePermit(permit, tenant) {
  const desc = (permit.job_description || '').toLowerCase();
  const reasons = [];
  let directKeyword = 0, inferredNeed = 0, costSignal = 0;
  let commercialSignal = 0, buildingTypeSignal = 0, recencyBonus = 0, locationBonus = 0;

  // Exclude
  for (const ex of tenant.excludeKeywords) {
    if (desc.includes(ex.toLowerCase())) return { score: 0, reasons: ['excluded'] };
  }

  // Direct keywords (max 40)
  const directHits = tenant.directKeywords.filter(kw => desc.includes(kw.toLowerCase()));
  if (directHits.length >= 3) { directKeyword = 40; reasons.push(`Direct: ${directHits.slice(0,3).join(', ')}`); }
  else if (directHits.length === 2) { directKeyword = 32; reasons.push(`Direct: ${directHits.join(', ')}`); }
  else if (directHits.length === 1) { directKeyword = 22; reasons.push(`Direct: ${directHits[0]}`); }

  // Inferred (max 20)
  const inferredHits = tenant.inferredKeywords.filter(kw => desc.includes(kw.toLowerCase()));
  if (inferredHits.length >= 2) { inferredNeed = 20; reasons.push(`Inferred: ${inferredHits.slice(0,2).join(', ')}`); }
  else if (inferredHits.length === 1) { inferredNeed = 12; reasons.push(`Inferred: ${inferredHits[0]}`); }

  // Cost (max 15)
  const cost = parseInt(permit.estimated_job_costs) || 0;
  if (cost >= tenant.sweetSpotMin && cost <= tenant.sweetSpotMax) { costSignal = 15; }
  else if (cost >= tenant.sweetSpotMax) { costSignal = 10; }
  else if (cost >= tenant.minCost) { costSignal = 5; }

  // Commercial (max 10)
  for (const sig of tenant.commercialSignals) {
    if (desc.includes(sig.toLowerCase())) { commercialSignal = 10; reasons.push(`Commercial: ${sig}`); break; }
  }

  // Building type (max 8)
  for (const sig of tenant.buildingSignals) {
    if (desc.includes(sig.toLowerCase())) { buildingTypeSignal = 8; reasons.push(`Building: ${sig}`); break; }
  }

  // Recency (max 10)
  if (permit.issued_date) {
    const days = Math.floor((Date.now() - new Date(permit.issued_date).getTime()) / 86400000);
    if (days <= 3) recencyBonus = 10;
    else if (days <= 7) recencyBonus = 7;
    else if (days <= 14) recencyBonus = 4;
  }

  // Location (max 7)
  if (tenant.primaryBoroughs.includes(permit.borough)) {
    locationBonus += 4;
    const nta = (permit.nta || '').toLowerCase();
    if (tenant.targetNeighborhoods.some(n => nta.includes(n))) { locationBonus += 3; }
  } else if (tenant.secondaryBoroughs.includes(permit.borough)) {
    locationBonus += 2;
  }

  const score = Math.min(directKeyword + inferredNeed + costSignal + commercialSignal + buildingTypeSignal + recencyBonus + locationBonus, 100);
  const tier = score >= 45 ? 'hot' : score >= 25 ? 'warm' : 'cold';

  return { score, tier, reasons };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FETCH PERMITS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchPermits(tenant, daysBack = 3) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const dateStr = dateFrom.toISOString().split('T')[0] + 'T00:00:00';

  const allBoroughs = [...tenant.primaryBoroughs, ...tenant.secondaryBoroughs];
  const boroughFilter = allBoroughs.map(b => `borough='${b}'`).join(' OR ');
  const workTypeFilter = tenant.workTypes.map(w => `work_type='${w}'`).join(' OR ');

  const where = [
    `issued_date>'${dateStr}'`,
    `estimated_job_costs>'${tenant.minCost}'`,
    `permit_status='Permit Issued'`,
    `filing_reason='Initial Permit'`,
    `(${boroughFilter})`,
    `(${workTypeFilter})`,
  ].join(' AND ');

  const url = `${API_BASE}?$where=${encodeURIComponent(where)}&$order=issued_date DESC&$limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DOB API error: ${res.status}`);
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMAIL DIGEST BUILDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildEmailHTML(tenant, hotLeads, warmLeads) {
  const fmt$ = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(parseInt(v) || 0);
  const now = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const time = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  let html = `
  <div style="font-family: -apple-system, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; background: #0C0C0E; color: #E8E6E3; padding: 24px; border-radius: 12px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 24px; margin: 0;">⚡ PermitPulse Daily Digest</h1>
      <p style="color: #8A8A96; font-size: 13px; margin: 4px 0 0 0;">${now} at ${time} ET — ${tenant.name}</p>
    </div>

    <div style="display: flex; gap: 12px; margin-bottom: 24px;">
      <div style="flex: 1; background: rgba(232,69,69,0.08); padding: 16px; border-radius: 8px; text-align: center;">
        <div style="font-size: 28px; font-weight: 700; color: #E84545;">${hotLeads.length}</div>
        <div style="font-size: 12px; color: #8A8A96; text-transform: uppercase;">🔥 Hot Leads</div>
      </div>
      <div style="flex: 1; background: rgba(232,168,62,0.08); padding: 16px; border-radius: 8px; text-align: center;">
        <div style="font-size: 28px; font-weight: 700; color: #E8A83E;">${warmLeads.length}</div>
        <div style="font-size: 12px; color: #8A8A96; text-transform: uppercase;">Warm Leads</div>
      </div>
    </div>`;

  if (hotLeads.length > 0) {
    html += `<h2 style="font-size: 16px; color: #E84545; margin: 20px 0 12px 0;">🔥 HOT LEADS — Act Now</h2>`;
    for (const lead of hotLeads) {
      const gc = lead.permit.applicant_business_name || `${lead.permit.applicant_first_name || ''} ${lead.permit.applicant_last_name || ''}`;
      html += `
      <div style="background: rgba(232,69,69,0.06); border: 1px solid rgba(232,69,69,0.2); border-radius: 8px; padding: 14px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <strong>${lead.permit.house_no} ${lead.permit.street_name}</strong>
          <span style="font-family: monospace; font-weight: 700;">${fmt$(lead.permit.estimated_job_costs)}</span>
        </div>
        <div style="font-size: 12px; color: #D4691A; margin-bottom: 6px;">${lead.permit.borough} · ${lead.permit.nta || ''} · Score: ${lead.score}/100</div>
        <div style="font-size: 13px; color: #8A8A96; margin-bottom: 8px;">${lead.permit.job_description?.slice(0, 200)}${(lead.permit.job_description?.length || 0) > 200 ? '...' : ''}</div>
        <div style="font-size: 13px; margin-bottom: 4px;">📞 <strong>GC:</strong> ${gc}</div>
        <div style="font-size: 13px; margin-bottom: 4px;">🏢 <strong>Owner:</strong> ${lead.permit.owner_business_name || lead.permit.owner_name || '—'}</div>
        <div style="font-size: 12px; color: #5C5C68; margin-top: 6px;">${lead.reasons.join(' · ')}</div>
      </div>`;
    }
  }

  if (warmLeads.length > 0) {
    html += `<h2 style="font-size: 16px; color: #E8A83E; margin: 20px 0 12px 0;">Warm Leads — Worth a Look</h2>`;
    for (const lead of warmLeads.slice(0, 15)) {
      const gc = lead.permit.applicant_business_name || `${lead.permit.applicant_first_name || ''} ${lead.permit.applicant_last_name || ''}`;
      html += `
      <div style="background: rgba(232,168,62,0.04); border: 1px solid rgba(232,168,62,0.12); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between;">
          <strong style="font-size: 14px;">${lead.permit.house_no} ${lead.permit.street_name}</strong>
          <span style="font-family: monospace;">${fmt$(lead.permit.estimated_job_costs)}</span>
        </div>
        <div style="font-size: 12px; color: #8A8A96; margin: 4px 0;">${lead.permit.borough} · GC: ${gc} · Score: ${lead.score}</div>
        <div style="font-size: 12px; color: #5C5C68;">${lead.permit.job_description?.slice(0, 150)}...</div>
      </div>`;
    }
    if (warmLeads.length > 15) {
      html += `<p style="color: #5C5C68; font-size: 12px;">+${warmLeads.length - 15} more warm leads. Open PermitPulse to view all.</p>`;
    }
  }

  if (hotLeads.length === 0 && warmLeads.length === 0) {
    html += `<div style="text-align: center; padding: 40px 0; color: #5C5C68;">
      <div style="font-size: 36px; margin-bottom: 12px;">📋</div>
      <p>No new leads in the last scan window. We'll check again soon.</p>
    </div>`;
  }

  html += `
    <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #2A2A32; font-size: 11px; color: #5C5C68;">
      PermitPulse — NYC Construction Lead Intelligence<br>
      Data from NYC Open Data (DOB NOW Approved Permits)
    </div>
  </div>`;

  return html;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEND EMAIL (via Resend — swap for SendGrid/SES as needed)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendEmail(to, subject, html, apiKey) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: 'PermitPulse <leads@permitpulse.com>',  // UPDATE: your verified domain
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Email send failed: ${err}`);
  }
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN SCANNER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runScan(env = {}) {
  const results = {};

  for (const [tenantId, tenant] of Object.entries(TENANTS)) {
    console.log(`\n🔍 Scanning for ${tenant.name}...`);

    try {
      // Fetch last 3 days of permits (for twice-daily runs, some overlap is fine)
      const permits = await fetchPermits(tenant, 3);
      console.log(`  Fetched ${permits.length} permits`);

      // Score all permits
      const scored = permits.map(p => {
        const result = scorePermit(p, tenant);
        return { permit: p, ...result };
      }).filter(s => s.score > 0);

      const hotLeads = scored.filter(s => s.tier === 'hot').sort((a, b) => b.score - a.score);
      const warmLeads = scored.filter(s => s.tier === 'warm').sort((a, b) => b.score - a.score);

      console.log(`  🔥 ${hotLeads.length} hot leads`);
      console.log(`  🟡 ${warmLeads.length} warm leads`);

      // Print hot leads to console
      for (const lead of hotLeads) {
        const gc = lead.permit.applicant_business_name || '?';
        console.log(`  → [${lead.score}] ${lead.permit.house_no} ${lead.permit.street_name}, ${lead.permit.borough} | $${lead.permit.estimated_job_costs} | GC: ${gc}`);
        console.log(`    ${lead.permit.job_description?.slice(0, 120)}`);
        console.log(`    Reasons: ${lead.reasons.join(', ')}`);
      }

      // Send email if there are leads and we have an API key
      if ((hotLeads.length > 0 || warmLeads.length > 0) && env.RESEND_API_KEY) {
        const subject = hotLeads.length > 0
          ? `🔥 ${hotLeads.length} hot lead${hotLeads.length > 1 ? 's' : ''} + ${warmLeads.length} warm — PermitPulse`
          : `${warmLeads.length} warm lead${warmLeads.length > 1 ? 's' : ''} — PermitPulse`;

        const html = buildEmailHTML(tenant, hotLeads, warmLeads);
        const emailTo = env.NOTIFY_EMAIL || tenant.email;
        await sendEmail(emailTo, subject, html, env.RESEND_API_KEY);
        console.log(`  📧 Email sent to ${emailTo}`);
      }

      results[tenantId] = { hot: hotLeads.length, warm: warmLeads.length, total: permits.length };
    } catch (err) {
      console.error(`  ❌ Error scanning for ${tenant.name}:`, err.message);
      results[tenantId] = { error: err.message };
    }
  }

  return results;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLOUDFLARE WORKER EXPORT (if deploying as Worker)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default {
  async scheduled(event, env) {
    await runScan(env);
  },

  async fetch(request, env) {
    // Manual trigger endpoint
    const url = new URL(request.url);
    if (url.pathname === '/scan') {
      const results = await runScan(env);
      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('PermitPulse Scanner — POST /scan to trigger manually', { status: 200 });
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLI MODE (node permit-scanner.mjs)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const isNode = typeof process !== 'undefined' && process.argv;
if (isNode && process.argv[1]?.includes('permit-scanner')) {
  runScan({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NOTIFY_EMAIL: process.env.NOTIFY_EMAIL,
  }).then(results => {
    console.log('\n✅ Scan complete:', JSON.stringify(results, null, 2));
  }).catch(err => {
    console.error('❌ Scan failed:', err);
    process.exit(1);
  });
}
