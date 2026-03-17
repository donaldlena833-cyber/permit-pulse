/**
 * PermitPulse v4 — Architect Relationship Engine
 * 
 * Runs daily at 7am ET via Cloudflare Worker cron.
 * 
 * Pipeline:
 * 1. Pull new DOB Job Application Filings (architect-filed alterations)
 * 2. Score each architect against MetroGlassPro profile
 * 3. Check "already contacted" list to avoid repeats
 * 4. Pick top 30 new architects of the day (10 tier1 + 20 tier2)
 * 5. Enrich with Apollo (email, phone, LinkedIn, firm)
 * 6. Draft personalized outreach emails + save to queue
 * 7. Check for replies to previously sent emails (Phase 2)
 * 8. Auto-generate follow-ups after 5 business days (Phase 3)
 * 9. Track pipeline: sent → replied → meeting → quoted → won/lost (Phase 1+4)
 * 10. Maintain per-architect CRM records (Phase 5)
 * 11. Smart re-engagement for returning architects (Phase 6)
 * 
 * Dashboard tabs: Drafts | Pipeline | Analytics | CRM
 * 
 * ENV VARS / SECRETS:
 * - RESEND_API_KEY — for sending the digest email
 * - GOOGLE_SERVICE_ACCOUNT — JSON key for Gmail API (domain-wide delegation)
 * - APOLLO_API_KEY — for contact enrichment (free tier: 10K/mo)
 * - NOTIFY_EMAIL — where to send digest (default: operations@metroglasspro.com)
 * - KV namespace PERMIT_PULSE — stores everything (picks, drafts, CRM, analytics)
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FILINGS_API = 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json';
const PERMITS_API = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';

// Tiered daily picks
const TIER1_PICKS = 10;  // Best matches — you review + edit each one
const TIER2_PICKS = 20;  // Good matches — you batch review, light edits
const TOTAL_MAX = 30;    // Max per scan

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// METROGLASSPRO ARCHITECT SCORING PROFILE
// Built from analysis of metroglasspro.com + service areas + project types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PROFILE = {
  // Neighborhoods where MetroGlassPro is strongest (from service areas page)
  tier1Neighborhoods: [
    'upper east side', 'upper west side', 'midtown', 'chelsea', 'greenwich village',
    'soho', 'tribeca', 'financial district', 'gramercy', 'murray hill',
    'east village', 'lower east side', 'west village', 'flatiron',
    'park slope', 'williamsburg', 'dumbo', 'brooklyn heights',
    'cobble hill', 'carroll gardens', 'greenpoint', 'prospect heights',
    'fort greene', 'bed-stuy',
  ],

  tier2Neighborhoods: [
    'harlem', 'hell\'s kitchen', 'hudson yards', 'battery park',
    'astoria', 'long island city', 'flushing', 'forest hills',
    'bushwick', 'crown heights', 'bay ridge', 'sunset park',
  ],

  // Building characteristics that signal residential work needing glass
  highEndSignals: {
    minStories: 3,           // 3+ story buildings
    minCost: 40000,          // $40K+ alterations (lowered to catch more)
    sweetSpotMin: 100000,    // $100K-$2M = luxury apartment reno sweet spot
    sweetSpotMax: 2000000,
    maxDwellingUnits: 300,   // Under 300 units
    minFloorArea: 300,       // 300+ sqft construction area
  },

  // Architect scoring weights
  scoring: {
    // Per-filing scores
    locationTier1: 15,       // Filing in a tier 1 neighborhood
    locationTier2: 8,        // Filing in a tier 2 neighborhood
    costSweetSpot: 12,       // Cost in $150K-$2M range
    costAboveMin: 5,         // Cost above $75K but below sweet spot
    costMega: 8,             // Cost above $2M (mega project)
    highRiseBonus: 6,        // 10+ story building
    residentialBonus: 8,     // Residential building type indicators

    // Architect history scores (applied once, based on full history)
    repeatFiler: 20,         // 5+ filings in last 2 years = established practice
    volumeFiler: 30,         // 10+ filings = high-volume, ideal partner
    manhattanFocused: 10,    // 70%+ of filings in Manhattan
    diverseNeighborhoods: 5, // Works across multiple target neighborhoods
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DATA FETCHING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchRecentFilings(daysBack = 7) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const dateStr = dateFrom.toISOString().split('T')[0] + 'T00:00:00';

  const where = [
    `(applicant_professional_title='RA' OR applicant_professional_title='PE')`,
    `filing_date>'${dateStr}'`,
    `job_type='Alteration'`,
    `general_construction_work_type_='1'`,
    `(borough='MANHATTAN' OR borough='BROOKLYN' OR borough='QUEENS' OR borough='BRONX')`,
  ].join(' AND ');

  const url = `${FILINGS_API}?$where=${encodeURIComponent(where)}&$order=filing_date DESC&$limit=500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Filings API error: ${res.status}`);
  const data = await res.json();

  console.log(`   Raw API returned ${data.length} filings`);
  // Log a sample of costs to debug
  if (data.length > 0) {
    const sample = data.slice(0, 5).map(f => `${f.applicant_first_name} ${f.applicant_last_name}: cost="${f.initial_cost}" parsed=${parseFloat(f.initial_cost)}`);
    console.log(`   Cost samples: ${sample.join(' | ')}`);
  }

  const filtered = data.filter(f => (parseFloat(f.initial_cost) || 0) >= PROFILE.highEndSignals.minCost);
  console.log(`   After $${PROFILE.highEndSignals.minCost} cost filter: ${filtered.length} filings`);
  return filtered;
}

async function fetchArchitectHistory(raLicense, lookbackYears = 2) {
  const dateFrom = new Date();
  dateFrom.setFullYear(dateFrom.getFullYear() - lookbackYears);
  const dateStr = dateFrom.toISOString().split('T')[0] + 'T00:00:00';

  const where = `applicant_license='${raLicense}' AND filing_date>'${dateStr}'`;
  const select = 'job_filing_number,house_no,street_name,borough,nta,initial_cost,filing_date,existing_stories,existing_dwelling_units,work_on_floor,building_type';
  const url = `${FILINGS_API}?$where=${encodeURIComponent(where)}&$select=${select}&$order=filing_date DESC&$limit=50`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

async function fetchPermitForBuilding(bin, borough) {
  const where = `bin='${bin}' AND borough='${borough}' AND permit_status='Permit Issued' AND work_type='General Construction'`;
  const url = `${PERMITS_API}?$where=${encodeURIComponent(where)}&$order=issued_date DESC&$limit=3`;
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// APOLLO ENRICHMENT
// Free tier: 10,000 lookups/month — more than enough for 30 picks/day
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function enrichWithApollo(architect, apiKey) {
  // Try to figure out the firm domain from the filing representative
  // If filing_representative_business_name matches architect name pattern, it might be their firm
  const filingRep = (architect.filings[0]?.filing_representative_business_name || '').trim();
  const archLastName = (architect.lastName || '').toLowerCase();

  // Heuristic: if the filing rep business contains the architect's last name, it's likely their firm
  let firmHint = null;
  if (filingRep && archLastName.length > 2 && filingRep.toLowerCase().includes(archLastName)) {
    firmHint = filingRep;
  }

  // Apollo People Match API
  const payload = {
    first_name: architect.firstName,
    last_name: architect.lastName,
    organization_name: firmHint || undefined,
    title: 'architect',
    // Help Apollo find the right person by giving location context
    person_locations: ['New York, New York, United States'],
    reveal_personal_emails: false,
    reveal_phone_number: true,
  };

  // Clean undefined values
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

  const res = await fetch('https://api.apollo.io/api/v1/people/match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apollo API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const person = data.person;

  if (!person) return null;

  return {
    apolloId: person.id || null,
    email: person.email || null,
    phone: person.phone_numbers?.[0]?.sanitized_number || person.organization?.phone || null,
    linkedin: person.linkedin_url || null,
    title: person.title || null,
    organization: person.organization?.name || null,
    domain: person.organization?.website_url ? new URL(person.organization.website_url).hostname : (person.organization?.primary_domain || null),
    website: person.organization?.website_url || null,
    city: person.city || null,
    state: person.state || null,
    photoUrl: person.photo_url || null,
    headline: person.headline || null,
    employmentHistory: (person.employment_history || []).slice(0, 3).map(e => ({
      title: e.title,
      org: e.organization_name,
      current: e.current,
    })),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NYSED LICENSE VERIFICATION (bonus data layer — free)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// NYSED doesn't have a public API, but we store the verification URL for manual lookup
function getNYSEDVerificationUrl(raLicense) {
  // Pad license to 6 digits
  const padded = String(raLicense).padStart(6, '0');
  return `https://eservices.nysed.gov/professions/verification-search?t=RA&n=${padded}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCORING ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function scoreCurrentFiling(filing) {
  const s = PROFILE.scoring;
  let score = 0;
  const reasons = [];

  // Location scoring
  const nta = (filing.nta || '').toLowerCase();
  if (PROFILE.tier1Neighborhoods.some(n => nta.includes(n))) {
    score += s.locationTier1;
    reasons.push(`Prime area: ${filing.nta}`);
  } else if (PROFILE.tier2Neighborhoods.some(n => nta.includes(n))) {
    score += s.locationTier2;
    reasons.push(`Good area: ${filing.nta}`);
  }

  // Cost scoring
  const cost = parseFloat(filing.initial_cost) || 0;
  if (cost >= PROFILE.highEndSignals.sweetSpotMin && cost <= PROFILE.highEndSignals.sweetSpotMax) {
    score += s.costSweetSpot;
    reasons.push(`Sweet spot budget: $${Math.round(cost).toLocaleString()}`);
  } else if (cost > PROFILE.highEndSignals.sweetSpotMax) {
    score += s.costMega;
    reasons.push(`Mega project: $${Math.round(cost).toLocaleString()}`);
  } else if (cost >= PROFILE.highEndSignals.minCost) {
    score += s.costAboveMin;
  }

  // Building type scoring
  const stories = parseInt(filing.existing_stories) || 0;
  if (stories >= 10) {
    score += s.highRiseBonus;
    reasons.push(`High-rise: ${stories} stories`);
  }

  // Residential indicators
  const units = parseInt(filing.existing_dwelling_units) || 0;
  const floor = (filing.work_on_floor || '').toLowerCase();
  if (units > 0 && units <= PROFILE.highEndSignals.maxDwellingUnits) {
    score += s.residentialBonus;
    reasons.push('Residential building');
  }
  if (floor.includes('penthouse') || floor.includes('ph')) {
    score += 5;
    reasons.push('Penthouse unit');
  }

  return { score, reasons };
}

function scoreArchitectHistory(history) {
  const s = PROFILE.scoring;
  let score = 0;
  const reasons = [];

  const totalFilings = history.length;
  const manhattanFilings = history.filter(f => f.borough === 'MANHATTAN').length;
  const neighborhoods = [...new Set(history.map(f => (f.nta || '').toLowerCase()))];
  const targetNeighborhoods = neighborhoods.filter(n =>
    PROFILE.tier1Neighborhoods.some(t => n.includes(t)) ||
    PROFILE.tier2Neighborhoods.some(t => n.includes(t))
  );

  // Volume scoring
  if (totalFilings >= 10) {
    score += s.volumeFiler;
    reasons.push(`High-volume practice: ${totalFilings} filings in 2yr`);
  } else if (totalFilings >= 5) {
    score += s.repeatFiler;
    reasons.push(`Active practice: ${totalFilings} filings in 2yr`);
  } else if (totalFilings >= 3) {
    score += 10;
    reasons.push(`${totalFilings} filings in 2yr`);
  }

  // Manhattan focus
  if (totalFilings > 0 && (manhattanFilings / totalFilings) >= 0.7) {
    score += s.manhattanFocused;
    reasons.push(`Manhattan-focused (${Math.round(manhattanFilings / totalFilings * 100)}%)`);
  }

  // Diverse neighborhoods
  if (targetNeighborhoods.length >= 3) {
    score += s.diverseNeighborhoods;
    reasons.push(`Works across ${targetNeighborhoods.length} target areas`);
  }

  // Average project cost
  const avgCost = history.reduce((sum, f) => sum + (parseFloat(f.initial_cost) || 0), 0) / Math.max(totalFilings, 1);
  if (avgCost >= PROFILE.highEndSignals.sweetSpotMin) {
    score += 8;
    reasons.push(`Avg project: $${Math.round(avgCost).toLocaleString()}`);
  }

  return { score, reasons, totalFilings, manhattanFilings, avgCost, targetNeighborhoods };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEDUPLICATION — never pick the same architect twice
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Uses Cloudflare KV in production, in-memory Map for testing
class PickTracker {
  constructor(kv = null) {
    this.kv = kv;
    this.mem = new Map();
  }

  async hasBeenPicked(raLicense) {
    if (this.kv) {
      const val = await this.kv.get(`picked:${raLicense}`);
      return val !== null;
    }
    return this.mem.has(raLicense);
  }

  async markPicked(raLicense, architectData) {
    const record = {
      ...architectData,
      pickedDate: new Date().toISOString(),
    };
    if (this.kv) {
      // Store for 180 days — after 6 months, they become eligible again
      await this.kv.put(`picked:${raLicense}`, JSON.stringify(record), { expirationTtl: 180 * 86400 });
    }
    this.mem.set(raLicense, record);
  }

  async getAllPicked() {
    if (this.kv) {
      const list = await this.kv.list({ prefix: 'picked:' });
      const results = [];
      for (const key of list.keys) {
        const val = await this.kv.get(key.name, 'json');
        if (val) results.push(val);
      }
      return results;
    }
    return [...this.mem.values()];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OUTREACH EMAIL DRAFTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function draftOutreachEmail(architect) {
  const name = titleCase(architect.name);
  const firstName = titleCase(architect.firstName);
  const project = architect.triggerProject;
  const addr = `${project.house_no} ${titleCase(cleanStreetName(project.street_name).toLowerCase())}`;
  const neighborhood = titleCase((project.nta || project.borough || '').toLowerCase());
  const cost = formatCost(project.initial_cost);
  const floor = project.work_on_floor || '';

  // Pick the right angle based on the project
  const isPenthouse = floor.toLowerCase().includes('penthouse') || floor.toLowerCase().includes('ph');
  const isHighRise = (parseInt(project.existing_stories) || 0) >= 10;
  const isLuxury = (parseFloat(project.initial_cost) || 0) >= 200000;

  let projectRef = '';
  if (isPenthouse) {
    projectRef = `your penthouse project at ${addr}`;
  } else if (isHighRise && isLuxury) {
    projectRef = `your renovation at ${addr} — a beautiful ${project.existing_stories}-story building`;
  } else {
    projectRef = `your project at ${addr} in ${neighborhood}`;
  }

  let credibility = '';
  if (architect.historyStats.manhattanFilings >= 5) {
    credibility = `We work with several architects across Manhattan and understand co-op/condo coordination, building access, and COI requirements well.`;
  } else {
    credibility = `We specialize in custom frameless shower enclosures and mirrors for Manhattan apartments and work closely with architects to match hardware finishes and glass specifications to the design intent.`;
  }

  const subject = `Custom glass for ${addr} — MetroGlass Pro`;

  const body = `Hi ${firstName},

I came across ${projectRef} and wanted to introduce MetroGlass Pro. We do custom frameless shower doors, mirrors, and glass partitions for high-end residential renovations in NYC.

${credibility}

If glass or mirrors are part of the scope on this project, I'd be happy to share photos of similar work and provide a quick estimate. Our site is metroglasspro.com if you'd like to see recent projects.

Either way, always glad to connect with architects doing great residential work in ${neighborhood}.

Best,
Donald Lena
MetroGlass Pro
(332) 999-3846
operations@metroglasspro.com
metroglasspro.com`;

  return { subject, body };
}

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

// Normalize DOB street names: collapse multiple spaces, trim
function cleanStreetName(raw) {
  return (raw || '').replace(/\s+/g, ' ').trim();
}

function formatCost(val) {
  const num = parseFloat(val) || 0;
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${Math.round(num / 1000)}K`;
  return `$${Math.round(num)}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EMAIL DIGEST BUILDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildDigestHTML(picks, stats) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  let html = `
<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:660px;margin:0 auto;background:#0C0C0E;color:#E8E6E3;padding:28px;border-radius:12px;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="font-size:22px;margin:0;">⚡ PermitPulse — Daily Top 5 Architects</h1>
    <p style="color:#8A8A96;font-size:13px;margin:4px 0 0;">${dateStr} at ${timeStr} ET</p>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:24px;">
    <div style="flex:1;background:rgba(212,105,26,0.1);padding:14px;border-radius:8px;text-align:center;">
      <div style="font-size:24px;font-weight:700;color:#D4691A;">${picks.length}</div>
      <div style="font-size:11px;color:#8A8A96;text-transform:uppercase;">New picks today</div>
    </div>
    <div style="flex:1;background:rgba(138,138,150,0.08);padding:14px;border-radius:8px;text-align:center;">
      <div style="font-size:24px;font-weight:700;">${stats.totalScanned}</div>
      <div style="font-size:11px;color:#8A8A96;text-transform:uppercase;">Filings scanned</div>
    </div>
    <div style="flex:1;background:rgba(138,138,150,0.08);padding:14px;border-radius:8px;text-align:center;">
      <div style="font-size:24px;font-weight:700;">${stats.totalPicked}</div>
      <div style="font-size:11px;color:#8A8A96;text-transform:uppercase;">Architects contacted</div>
    </div>
  </div>`;

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    const p = pick.triggerProject;
    const cost = formatCost(p.initial_cost);
    const stories = p.existing_stories || '?';
    const googleSearch = `https://www.google.com/search?q=${encodeURIComponent(pick.name + ' architect NYC')}`;
    const mapsLink = `https://www.google.com/maps/search/${encodeURIComponent(p.house_no + ' ' + cleanStreetName(p.street_name) + ', ' + p.borough + ', NY')}`;

    html += `
  <div style="background:#151518;border:1px solid #2A2A32;border-radius:10px;padding:18px;margin-bottom:12px;border-left:3px solid #D4691A;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
      <div>
        <div style="font-size:11px;color:#D4691A;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;">Pick #${i + 1} — Score: ${pick.totalScore}/100</div>
        <div style="font-size:18px;font-weight:700;">${titleCase(pick.name)}</div>
        <div style="font-size:13px;color:#8A8A96;">RA #${pick.raLicense} · ${pick.historyStats.totalFilings} filings in 2yr</div>
      </div>
      <div style="text-align:right;">
        <div style="font-family:monospace;font-size:16px;font-weight:700;">${cost}</div>
        <div style="font-size:12px;color:#8A8A96;">${stories} stories</div>
      </div>
    </div>

    <div style="font-size:14px;font-weight:600;margin-bottom:4px;">📍 ${p.house_no} ${cleanStreetName(p.street_name)}, ${p.borough}</div>
    <div style="font-size:12px;color:#8A8A96;margin-bottom:10px;">${p.nta || ''} · Floor: ${p.work_on_floor || '?'} · Filed: ${p.filing_date?.slice(0, 10)}</div>

    <div style="font-size:12px;color:#5C5C68;margin-bottom:10px;">
      ${pick.allReasons.map(r => `<span style="display:inline-block;background:#1E1E24;padding:2px 8px;border-radius:4px;margin:2px 4px 2px 0;border:1px solid #2A2A32;">${r}</span>`).join('')}
    </div>

    ${pick.recentProjects.length > 1 ? `
    <div style="font-size:12px;color:#5C5C68;margin-bottom:10px;">
      <strong style="color:#8A8A96;">Recent projects:</strong>
      ${pick.recentProjects.slice(0, 4).map(rp => `${rp.house_no} ${cleanStreetName(rp.street_name)} (${rp.borough}, ${formatCost(rp.initial_cost)})`).join(' · ')}
    </div>` : ''}

    <div style="margin-bottom:12px;">
      <div style="font-size:11px;color:#D4691A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Draft email</div>
      <div style="font-size:12px;color:#5C5C68;margin-bottom:4px;"><strong>Subject:</strong> ${pick.draftEmail.subject}</div>
      <div style="background:#1E1E24;border:1px solid #2A2A32;border-radius:6px;padding:12px;font-size:13px;color:#8A8A96;white-space:pre-wrap;line-height:1.5;">${pick.draftEmail.body}</div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <a href="${googleSearch}" style="font-size:12px;color:#D4691A;text-decoration:none;background:#1E1E24;padding:6px 12px;border-radius:6px;border:1px solid #2A2A32;">🔍 Find firm + email</a>
      <a href="${mapsLink}" style="font-size:12px;color:#D4691A;text-decoration:none;background:#1E1E24;padding:6px 12px;border-radius:6px;border:1px solid #2A2A32;">📍 View on maps</a>
      <a href="https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${p.borough === 'MANHATTAN' ? '1' : p.borough === 'BROOKLYN' ? '3' : '4'}&block=${p.block}&lot=${p.lot}" style="font-size:12px;color:#D4691A;text-decoration:none;background:#1E1E24;padding:6px 12px;border-radius:6px;border:1px solid #2A2A32;">🔗 DOB BIS</a>
    </div>
  </div>`;
  }

  if (picks.length === 0) {
    html += `
    <div style="text-align:center;padding:40px;color:#5C5C68;">
      <div style="font-size:36px;margin-bottom:12px;">📋</div>
      <p>No new architect picks today. All recent filers have already been picked or didn't score high enough. Check back tomorrow.</p>
    </div>`;
  }

  html += `
  <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #2A2A32;font-size:11px;color:#5C5C68;">
    PermitPulse v3 — Architect Relationship Engine<br>
    Data: NYC Open Data (DOB NOW Job Application Filings + Approved Permits)<br>
    <br>
    <em>Review each draft, edit to your voice, then forward from operations@metroglasspro.com</em>
  </div>
</div>`;

  return html;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SEND EMAIL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendEmail(to, subject, html, apiKey) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: 'PermitPulse <leads@metroglasspro.com>',
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Email failed: ${await res.text()}`);
  return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN PIPELINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runDailyPipeline(env = {}) {
  const tracker = new PickTracker(env.PERMIT_PULSE || null);

  console.log('⚡ PermitPulse v3 — Daily Architect Scan');
  console.log('━'.repeat(50));

  // Step 1: Fetch recent filings (last 14 days for wide coverage)
  console.log('\n📥 Step 1: Fetching recent filings...');
  let filings = [];
  try {
    filings = await fetchRecentFilings(14);
    console.log(`   Found ${filings.length} architect-filed alterations`);
  } catch (err) {
    console.error(`   ❌ Fetch failed: ${err.message}`);
    return { picks: 0, scanned: 0, totalContacted: 0, error: err.message };
  }

  // Step 2: Group by architect (unique RA license)
  console.log('\n🏗️  Step 2: Grouping by architect...');
  const architectMap = new Map();
  for (const f of filings) {
    const license = f.applicant_license;
    if (!license) continue;
    if (!architectMap.has(license)) {
      // DOB API returns names in ALL CAPS — normalize to Title Case immediately
      const rawFirst = (f.applicant_first_name || '').trim();
      const rawLast = (f.applicant_last_name || '').trim();
      const first = titleCase(rawFirst.toLowerCase());
      const last = titleCase(rawLast.toLowerCase());
      architectMap.set(license, {
        raLicense: license,
        firstName: first,
        lastName: last,
        name: `${first} ${last}`.trim(),
        filings: [],
      });
    }
    architectMap.get(license).filings.push(f);
  }
  console.log(`   ${architectMap.size} unique architects`);

  // Step 3: Filter out already-picked architects
  console.log('\n🔄 Step 3: Deduplicating...');
  const candidates = [];
  for (const [license, arch] of architectMap) {
    const picked = await tracker.hasBeenPicked(license);
    if (!picked) {
      candidates.push(arch);
    }
  }
  console.log(`   ${candidates.length} new architects (${architectMap.size - candidates.length} already picked)`);

  // Step 4: Pre-score candidates using filing data only (no extra API calls)
  console.log('\n📊 Step 4: Pre-scoring candidates...');
  const preScored = [];

  for (const candidate of candidates) {
    const bestFiling = candidate.filings.sort((a, b) =>
      (parseFloat(b.initial_cost) || 0) - (parseFloat(a.initial_cost) || 0)
    )[0];

    const filingScore = scoreCurrentFiling(bestFiling);

    preScored.push({
      ...candidate,
      triggerProject: bestFiling,
      filingScore: filingScore.score,
      filingReasons: filingScore.reasons,
    });
  }

  // Sort by filing score, take top candidates only for deep enrichment
  preScored.sort((a, b) => b.filingScore - a.filingScore);
  const topCandidates = preScored.slice(0, TOTAL_MAX + 10); // fetch history for slightly more than we need
  console.log(`   ${preScored.length} candidates pre-scored, deep-enriching top ${topCandidates.length}`);

  // Step 4.5: Fetch history ONLY for top candidates (limits API calls)
  console.log('\n📜 Step 4.5: Fetching architect histories...');
  const scored = [];

  for (const candidate of topCandidates) {
    try {
      const history = await fetchArchitectHistory(candidate.raLicense);
      const historyScore = scoreArchitectHistory(history);

      const totalScore = Math.min(candidate.filingScore + historyScore.score, 100);
      const allReasons = [...candidate.filingReasons, ...historyScore.reasons];

      scored.push({
        ...candidate,
        recentProjects: history.slice(0, 5),
        historyScore: historyScore.score,
        totalScore,
        allReasons,
        historyStats: historyScore,
      });
    } catch (err) {
      // If history fetch fails, still include with filing score only
      scored.push({
        ...candidate,
        recentProjects: [],
        historyScore: 0,
        totalScore: candidate.filingScore,
        allReasons: candidate.filingReasons,
        historyStats: { totalFilings: 0, manhattanFilings: 0, avgCost: 0, targetNeighborhoods: [] },
      });
    }
  }

  // Sort by total score, take tiered picks
  scored.sort((a, b) => b.totalScore - a.totalScore);
  const tier1 = scored.slice(0, TIER1_PICKS);
  const tier2 = scored.slice(TIER1_PICKS, TIER1_PICKS + TIER2_PICKS);
  const topPicks = [...tier1, ...tier2].slice(0, TOTAL_MAX);

  // Assign tier labels
  tier1.forEach(p => p.tier = 'tier1');
  tier2.forEach(p => p.tier = 'tier2');

  console.log(`\n🏆 Step 5: ${topPicks.length} picks (${tier1.length} Tier 1, ${tier2.length} Tier 2):`);
  for (let i = 0; i < Math.min(topPicks.length, 10); i++) {
    const pick = topPicks[i];
    console.log(`   #${i + 1} [${pick.tier}|${pick.totalScore}] ${pick.name} — ${pick.triggerProject.house_no} ${cleanStreetName(pick.triggerProject.street_name)}, ${pick.triggerProject.borough} ($${pick.triggerProject.initial_cost})`);
  }
  if (topPicks.length > 10) console.log(`   ... and ${topPicks.length - 10} more`);

  // Step 5.5: Enrich with Apollo (email, phone, LinkedIn, firm) — tier1 only to stay fast
  console.log('\n🔍 Step 5.5: Enriching tier1 contacts via Apollo...');
  let enriched = 0, enrichFailed = 0;
  for (const pick of tier1) {
    pick.enrichment = null;
    if (env.APOLLO_API_KEY) {
      try {
        const data = await enrichWithApollo(pick, env.APOLLO_API_KEY);
        if (data) {
          pick.enrichment = data;
          enriched++;
          console.log(`   ✅ ${pick.name}: ${data.email || 'no email'} | ${data.linkedin || 'no LinkedIn'} | ${data.organization || 'no firm'}`);
        } else {
          enrichFailed++;
          console.log(`   ⚠️  ${pick.name}: no match in Apollo`);
        }
      } catch (err) {
        enrichFailed++;
        console.log(`   ❌ ${pick.name}: enrichment error — ${err.message}`);
      }
    }
  }
  if (!env.APOLLO_API_KEY) {
    console.log('   ⚠️  No APOLLO_API_KEY set — skipping enrichment. Add it: npx wrangler secret put APOLLO_API_KEY');
  } else {
    console.log(`   ${enriched} enriched, ${enrichFailed} not found`);
  }

  // Step 6: Draft outreach emails + save to queue
  console.log('\n✉️  Step 6: Drafting outreach emails + saving to queue...');
  for (const pick of topPicks) {
    pick.draftEmail = draftOutreachEmail(pick);

    if (env.PERMIT_PULSE) {
      const queue = new DraftQueue(env.PERMIT_PULSE);
      const e = pick.enrichment || {};
      await queue.addDraft({
        architectName: pick.name,
        architectLicense: pick.raLicense,
        recipientEmail: e.email || null,
        subject: pick.draftEmail.subject,
        body: pick.draftEmail.body,
        projectAddress: `${pick.triggerProject.house_no} ${cleanStreetName(pick.triggerProject.street_name)}, ${pick.triggerProject.borough}`,
        score: pick.totalScore,
        tier: pick.tier || 'tier2',
        // Enriched contact data
        phone: e.phone || null,
        linkedin: e.linkedin || null,
        firmName: e.organization || null,
        firmDomain: e.domain || null,
        firmWebsite: e.website || null,
        title: e.title || null,
        apolloId: e.apolloId || null,
        enrichmentSource: e.email ? 'apollo' : 'none',
      });
    }
  }
  console.log(`   ${topPicks.length} drafts saved to queue`);

  // Step 7: Mark as picked (no repeats)
  console.log('\n💾 Step 7: Saving picks to tracker...');
  for (const pick of topPicks) {
    await tracker.markPicked(pick.raLicense, {
      name: pick.name,
      raLicense: pick.raLicense,
      score: pick.totalScore,
      triggerAddress: `${pick.triggerProject.house_no} ${cleanStreetName(pick.triggerProject.street_name)}`,
      borough: pick.triggerProject.borough,
    });
  }

  const allPicked = await tracker.getAllPicked();
  console.log(`   Total architects in database: ${allPicked.length}`);

  // Step 8: Send digest email
  const stats = {
    totalScanned: filings.length,
    totalPicked: allPicked.length,
  };

  if (env.RESEND_API_KEY) {
    console.log('\n📧 Step 8: Sending digest email...');
    const emailTo = env.NOTIFY_EMAIL || 'operations@metroglasspro.com';
    const subject = topPicks.length > 0
      ? `⚡ ${topPicks.length} architect picks today — PermitPulse`
      : '📋 No new architect picks today — PermitPulse';
    const html = buildDigestHTML(topPicks, stats);
    await sendEmail(emailTo, subject, html, env.RESEND_API_KEY);
    console.log(`   Sent to ${emailTo}`);
  } else {
    console.log('\n⚠️  No RESEND_API_KEY — skipping email. Set it to enable daily digest.');
  }

  console.log('\n✅ Pipeline complete.');
  return { picks: topPicks.length, scanned: filings.length, totalContacted: allPicked.length };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GMAIL INTEGRATION IMPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Gmail integration is inlined below (Cloudflare Workers single-file deployment)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GMAIL INTEGRATION — JWT/OAuth2 for Google Workspace Service Account
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function base64UrlEncode(data) {
  if (typeof data === 'string') data = new TextEncoder().encode(data);
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function str2ab(str) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0; i < str.length; i++) bufView[i] = str.charCodeAt(i);
  return buf;
}

async function getGoogleAccessToken(serviceAccountJson, impersonateEmail, scopes) {
  const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  const now = Math.floor(Date.now() / 1000);
  const scopeStr = scopes || 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(JSON.stringify({
    iss: sa.client_email, sub: impersonateEmail,
    scope: scopeStr,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signInput = `${header}.${claimSet}`;
  const pkPem = sa.private_key.replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '').replace(/(\r\n|\n|\r)/gm, '');
  const signingKey = await crypto.subtle.importKey('pkcs8', str2ab(atob(pkPem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey,
    new TextEncoder().encode(signInput));
  const jwt = `${signInput}.${base64UrlEncode(signature)}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Google OAuth failed: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

// OAuth2 refresh token method — for when service account keys are blocked by org policy
async function getAccessTokenFromRefreshToken(clientId, clientSecret, refreshToken) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`,
  });
  if (!tokenRes.ok) throw new Error(`OAuth2 refresh failed: ${await tokenRes.text()}`);
  return (await tokenRes.json()).access_token;
}

// Unified: get Gmail access token using whichever auth method is configured
async function getGmailAccessToken(env) {
  // Method 1: OAuth2 refresh token (preferred — works without service account keys)
  if (env.GMAIL_REFRESH_TOKEN && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET) {
    return getAccessTokenFromRefreshToken(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET, env.GMAIL_REFRESH_TOKEN);
  }
  // Method 2: Service account with domain-wide delegation
  if (env.GOOGLE_SERVICE_ACCOUNT) {
    const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
    return getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT, sender);
  }
  throw new Error('No Gmail auth configured. Set either GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET, or GOOGLE_SERVICE_ACCOUNT.');
}

function hasGmailAuth(env) {
  return !!(env.GMAIL_REFRESH_TOKEN && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET) || !!env.GOOGLE_SERVICE_ACCOUNT;
}

async function sendGmail({ to, subject, body, env }) {
  const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
  const accessToken = await getGmailAccessToken(env);
  // Use 'me' for OAuth refresh token (user is directly authenticated), or sender email for service account
  const gmailUser = (env.GMAIL_REFRESH_TOKEN) ? 'me' : sender;
  const rawEmail = [`From: MetroGlass Pro <${sender}>`, `To: ${to}`, `Subject: ${subject}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${gmailUser}/messages/send`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64UrlEncode(rawEmail) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
  const result = await res.json();
  return { success: true, messageId: result.id, threadId: result.threadId };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 2: REPLY DETECTION — check Gmail threads for architect responses
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function checkForReplies(env) {
  if (!hasGmailAuth(env)) return { checked: 0, replies: 0 };
  const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
  const gmailUser = env.GMAIL_REFRESH_TOKEN ? 'me' : sender;
  const accessToken = await getGmailAccessToken(env);
  const queue = new DraftQueue(env.PERMIT_PULSE);
  const allDrafts = await queue.getAllDrafts();
  const sentDrafts = allDrafts.filter(d => d.status === 'sent' && d.gmailThreadId && !d.replyDetected);

  let checked = 0, replies = 0;
  for (const draft of sentDrafts) {
    try {
      const threadRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/${gmailUser}/threads/${draft.gmailThreadId}?format=metadata&metadataHeaders=From`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (!threadRes.ok) continue;
      const thread = await threadRes.json();
      checked++;

      // If thread has more than 1 message, someone replied
      if (thread.messages && thread.messages.length > 1) {
        const replyMsg = thread.messages.find(m => {
          const from = (m.payload?.headers?.find(h => h.name === 'From')?.value || '').toLowerCase();
          return !from.includes(sender.toLowerCase());
        });
        if (replyMsg) {
          replies++;
          await queue.updateDraft(draft.id, {
            pipelineStatus: 'replied',
            replyDetected: true,
            replyDetectedAt: new Date().toISOString(),
            replyMessageId: replyMsg.id,
          });
          // Also update the architect CRM record
          await updateArchitectCRM(env.PERMIT_PULSE, draft.architectLicense, {
            lastReplyAt: new Date().toISOString(),
            lastStatus: 'replied',
          });
          console.log(`   📬 Reply detected from ${draft.architectName}`);
        }
      }
    } catch (err) {
      console.log(`   ⚠️  Reply check failed for ${draft.architectName}: ${err.message}`);
    }
  }
  return { checked, replies };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 3: FOLLOW-UP SEQUENCES — auto-draft follow-ups after 5 business days
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const MAX_FOLLOWUPS = 2;
const FOLLOWUP_WAIT_DAYS = 5;

function businessDaysSince(dateStr) {
  const sent = new Date(dateStr);
  const now = new Date();
  let days = 0;
  const d = new Date(sent);
  while (d < now) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

function draftFollowUpEmail(draft, followUpNumber) {
  const firstName = (draft.architectName || '').split(' ')[0];
  const addr = draft.projectAddress || '';

  if (followUpNumber === 1) {
    return {
      subject: `Re: ${draft.subject}`,
      body: `Hi ${firstName},

Just circling back on my note about ${addr}. If glass or mirrors are in the scope, I'd love to share some photos of similar work we've done.

Happy to jump on a quick call or send over examples — whatever's easiest.

Best,
Donald Lena
MetroGlass Pro
(332) 999-3846
operations@metroglasspro.com`,
    };
  }

  // Follow-up #2 — final touch, very light
  return {
    subject: `Re: ${draft.subject}`,
    body: `Hi ${firstName},

Last note from me — just wanted to make sure this didn't get buried. If glass work comes up on any of your projects, we'd be glad to help.

Our portfolio: metroglasspro.com

All the best,
Donald Lena
MetroGlass Pro
(332) 999-3846`,
  };
}

async function generateFollowUps(env) {
  const queue = new DraftQueue(env.PERMIT_PULSE);
  const allDrafts = await queue.getAllDrafts();
  const sentDrafts = allDrafts.filter(d =>
    d.status === 'sent' &&
    !d.replyDetected &&
    d.sentAt &&
    (d.followUpCount || 0) < MAX_FOLLOWUPS &&
    d.pipelineStatus !== 'replied' &&
    d.pipelineStatus !== 'meeting' &&
    d.pipelineStatus !== 'quoted' &&
    d.pipelineStatus !== 'won' &&
    d.pipelineStatus !== 'lost' &&
    d.pipelineStatus !== 'cold'
  );

  let generated = 0;
  for (const draft of sentDrafts) {
    const daysSince = businessDaysSince(draft.lastFollowUpAt || draft.sentAt);
    if (daysSince >= FOLLOWUP_WAIT_DAYS) {
      const followUpNum = (draft.followUpCount || 0) + 1;
      const followUp = draftFollowUpEmail(draft, followUpNum);

      // Create a new follow-up draft linked to the original
      const fuId = `draft:fu-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const fuRecord = {
        id: fuId,
        status: 'pending',
        isFollowUp: true,
        followUpNumber: followUpNum,
        originalDraftId: draft.id,
        createdAt: new Date().toISOString(),
        architectName: draft.architectName,
        architectLicense: draft.architectLicense,
        recipientEmail: draft.recipientEmail,
        subject: followUp.subject,
        body: followUp.body,
        projectAddress: draft.projectAddress,
        score: draft.score,
        tier: draft.tier,
        phone: draft.phone,
        linkedin: draft.linkedin,
        firmName: draft.firmName,
        firmWebsite: draft.firmWebsite,
      };
      await env.PERMIT_PULSE.put(fuId, JSON.stringify(fuRecord), { expirationTtl: 30 * 86400 });

      // Mark the original with follow-up tracking
      await queue.updateDraft(draft.id, {
        followUpCount: followUpNum,
        lastFollowUpAt: new Date().toISOString(),
        ...(followUpNum >= MAX_FOLLOWUPS && { pipelineStatus: 'cold' }),
      });

      generated++;
      console.log(`   📝 Follow-up #${followUpNum} drafted for ${draft.architectName}`);
    }
  }
  return { generated };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 5: ARCHITECT CRM — per-architect relationship records
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function updateArchitectCRM(kv, license, updates) {
  if (!kv || !license) return null;
  const key = `crm:${license}`;
  let existing = {};
  try { existing = await kv.get(key, 'json') || {}; } catch (e) { /* new record */ }
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };

  // Track touchpoints history
  if (!updated.touchpoints) updated.touchpoints = [];
  if (updates.lastStatus || updates.lastReplyAt) {
    updated.touchpoints.push({
      type: updates.lastStatus || 'update',
      at: new Date().toISOString(),
      detail: updates.detail || null,
    });
    // Keep last 50 touchpoints
    if (updated.touchpoints.length > 50) updated.touchpoints = updated.touchpoints.slice(-50);
  }

  await kv.put(key, JSON.stringify(updated), { expirationTtl: 365 * 86400 });
  return updated;
}

async function getArchitectCRM(kv, license) {
  if (!kv || !license) return null;
  return await kv.get(`crm:${license}`, 'json');
}

async function getAllArchitectCRMs(kv) {
  if (!kv) return [];
  const list = await kv.list({ prefix: 'crm:' });
  const records = [];
  for (const key of list.keys) {
    const val = await kv.get(key.name, 'json');
    if (val) records.push(val);
  }
  return records;
}

// Save CRM records when drafts are created/sent
async function upsertArchitectCRMFromDraft(kv, draft, event) {
  return updateArchitectCRM(kv, draft.architectLicense, {
    name: draft.architectName,
    license: draft.architectLicense,
    email: draft.recipientEmail,
    phone: draft.phone,
    linkedin: draft.linkedin,
    firmName: draft.firmName,
    firmWebsite: draft.firmWebsite,
    projectAddress: draft.projectAddress,
    score: draft.score,
    tier: draft.tier,
    lastStatus: event,
    detail: `${event} — ${draft.projectAddress}`,
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 4: PIPELINE ANALYTICS — funnel metrics and conversion tracking
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function getPipelineAnalytics(kv) {
  if (!kv) return null;
  const draftList = await kv.list({ prefix: 'draft:' });
  const pickedList = await kv.list({ prefix: 'picked:' });

  const drafts = [];
  for (const key of draftList.keys) {
    const val = await kv.get(key.name, 'json');
    if (val) drafts.push(val);
  }

  const total = drafts.length;
  const pending = drafts.filter(d => d.status === 'pending').length;
  const sent = drafts.filter(d => d.status === 'sent').length;
  const skipped = drafts.filter(d => d.status === 'skipped').length;
  const replied = drafts.filter(d => d.pipelineStatus === 'replied' || d.replyDetected).length;
  const meeting = drafts.filter(d => d.pipelineStatus === 'meeting').length;
  const quoted = drafts.filter(d => d.pipelineStatus === 'quoted').length;
  const won = drafts.filter(d => d.pipelineStatus === 'won').length;
  const lost = drafts.filter(d => d.pipelineStatus === 'lost').length;
  const cold = drafts.filter(d => d.pipelineStatus === 'cold').length;
  const followUps = drafts.filter(d => d.isFollowUp).length;

  // Compute rates
  const sentTotal = sent + replied + meeting + quoted + won + lost + cold;
  const replyRate = sentTotal > 0 ? ((replied + meeting + quoted + won) / sentTotal * 100).toFixed(1) : 0;
  const meetingRate = (replied + meeting + quoted + won) > 0 ? ((meeting + quoted + won) / (replied + meeting + quoted + won) * 100).toFixed(1) : 0;
  const closeRate = (quoted + won + lost) > 0 ? (won / (quoted + won + lost) * 100).toFixed(1) : 0;

  // Revenue estimation from won deals
  const wonDrafts = drafts.filter(d => d.pipelineStatus === 'won');
  const estimatedRevenue = wonDrafts.reduce((sum, d) => sum + (d.dealValue || 0), 0);

  // Time metrics
  const repliedDrafts = drafts.filter(d => d.replyDetectedAt && d.sentAt);
  let avgReplyDays = 0;
  if (repliedDrafts.length > 0) {
    const totalDays = repliedDrafts.reduce((sum, d) => {
      return sum + ((new Date(d.replyDetectedAt) - new Date(d.sentAt)) / 86400000);
    }, 0);
    avgReplyDays = (totalDays / repliedDrafts.length).toFixed(1);
  }

  // Tier comparison
  const t1Sent = drafts.filter(d => d.tier === 'tier1' && (d.status === 'sent' || d.pipelineStatus)).length;
  const t1Replied = drafts.filter(d => d.tier === 'tier1' && (d.pipelineStatus === 'replied' || d.replyDetected)).length;
  const t2Sent = drafts.filter(d => d.tier === 'tier2' && (d.status === 'sent' || d.pipelineStatus)).length;
  const t2Replied = drafts.filter(d => d.tier === 'tier2' && (d.pipelineStatus === 'replied' || d.replyDetected)).length;

  return {
    funnel: { total, pending, sent: sentTotal, skipped, replied, meeting, quoted, won, lost, cold, followUps },
    rates: { replyRate, meetingRate, closeRate },
    revenue: { estimated: estimatedRevenue, wonDeals: wonDrafts.length },
    timing: { avgReplyDays },
    tiers: {
      tier1: { sent: t1Sent, replied: t1Replied, rate: t1Sent > 0 ? (t1Replied / t1Sent * 100).toFixed(1) : 0 },
      tier2: { sent: t2Sent, replied: t2Replied, rate: t2Sent > 0 ? (t2Replied / t2Sent * 100).toFixed(1) : 0 },
    },
    totalArchitects: pickedList.keys.length,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE 6: SMART RE-ENGAGEMENT — recognize returning architects
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function draftReEngagementEmail(architect, previousContact) {
  const firstName = architect.firstName;
  const project = architect.triggerProject;
  const addr = `${project.house_no} ${titleCase(cleanStreetName(project.street_name).toLowerCase())}`;
  const neighborhood = titleCase((project.nta || project.borough || '').toLowerCase());
  const prevAddr = previousContact.triggerAddress || 'a previous project';
  const monthsAgo = Math.round((Date.now() - new Date(previousContact.pickedDate).getTime()) / (30 * 86400000));

  const subject = `Great to see your new project at ${addr} — MetroGlass Pro`;
  const body = `Hi ${firstName},

We reached out about ${monthsAgo} months ago regarding ${prevAddr}, and I wanted to reconnect now that I see your new filing at ${addr} in ${neighborhood}.

MetroGlass Pro specializes in custom frameless shower doors, mirrors, and glass partitions for high-end residential renovations. If glass or mirrors are in the scope on this one, I'd love to share photos of recent work and provide a quick estimate.

Our latest projects: metroglasspro.com

Best,
Donald Lena
MetroGlass Pro
(332) 999-3846
operations@metroglasspro.com
metroglasspro.com`;

  return { subject, body };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DRAFT QUEUE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class DraftQueue {
  constructor(kv) { this.kv = kv; }

  async addDraft(draft) {
    // Dedup: skip if a pending draft already exists for this architect
    if (draft.architectLicense) {
      const existing = await this.kv.list({ prefix: 'draft:' });
      for (const key of existing.keys) {
        const val = await this.kv.get(key.name, 'json');
        if (val && val.architectLicense === draft.architectLicense && val.status === 'pending') {
          console.log(`   ⏭️  Skipping duplicate draft for ${draft.architectName} (license ${draft.architectLicense})`);
          return val; // Return the existing draft instead of creating a new one
        }
      }
    }
    const id = `draft:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = { id, status: 'pending', createdAt: new Date().toISOString(),
      architectName: draft.architectName, architectLicense: draft.architectLicense,
      recipientEmail: draft.recipientEmail || null, subject: draft.subject,
      body: draft.body, projectAddress: draft.projectAddress, score: draft.score,
      tier: draft.tier || 'tier2',
      // Enrichment data
      phone: draft.phone || null,
      linkedin: draft.linkedin || null,
      firmName: draft.firmName || null,
      firmDomain: draft.firmDomain || null,
      firmWebsite: draft.firmWebsite || null,
      title: draft.title || null,
      enrichmentSource: draft.enrichmentSource || 'none',
    };
    await this.kv.put(id, JSON.stringify(record), { expirationTtl: 30 * 86400 });
    return record;
  }

  async getDraft(id) { return await this.kv.get(id, 'json'); }

  async updateDraft(id, updates) {
    const existing = await this.getDraft(id);
    if (!existing) throw new Error(`Draft ${id} not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await this.kv.put(id, JSON.stringify(updated), { expirationTtl: 30 * 86400 });
    return updated;
  }

  async getPendingDrafts() {
    const list = await this.kv.list({ prefix: 'draft:' });
    const drafts = [];
    for (const key of list.keys) {
      const val = await this.kv.get(key.name, 'json');
      if (val && val.status === 'pending') drafts.push(val);
    }
    return drafts.sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  async getAllDrafts() {
    const list = await this.kv.list({ prefix: 'draft:' });
    const drafts = [];
    for (const key of list.keys) {
      const val = await this.kv.get(key.name, 'json');
      if (val) drafts.push(val);
    }
    return drafts.sort((a, b) => (b.score || 0) - (a.score || 0));
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GMAIL API ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleGmailRoutes(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/drafts' && request.method === 'GET') {
    const queue = new DraftQueue(env.PERMIT_PULSE);
    return jsonRes(await queue.getAllDrafts());
  }
  if (url.pathname.match(/^\/drafts\/[^/]+\/approve$/) && request.method === 'POST') {
    const rawId = url.pathname.split('/')[2];
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const draft = await queue.getDraft(`draft:${rawId}`);
    if (!draft) return jsonRes({ error: 'Draft not found' }, 404);
    if (!draft.recipientEmail) return jsonRes({ error: 'No recipient email. Edit draft first.' }, 400);
    if (!hasGmailAuth(env)) return jsonRes({ error: 'Gmail not configured. Set GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET secrets.' }, 400);
    try {
      const result = await sendGmail({ to: draft.recipientEmail, subject: draft.subject, body: draft.body, env });
      await queue.updateDraft(draft.id, { status: 'sent', sentAt: new Date().toISOString(), gmailMessageId: result.messageId, gmailThreadId: result.threadId, pipelineStatus: 'awaiting_reply', followUpCount: 0 });
      // Update CRM
      await upsertArchitectCRMFromDraft(env.PERMIT_PULSE, draft, 'sent');
      return jsonRes({ success: true, messageId: result.messageId });
    } catch (err) { return jsonRes({ error: `Send failed: ${err.message}` }, 500); }
  }
  if (url.pathname.match(/^\/drafts\/[^/]+\/edit$/) && request.method === 'POST') {
    const rawId = url.pathname.split('/')[2];
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const updates = await request.json();
    try {
      const updated = await queue.updateDraft(`draft:${rawId}`, {
        ...(updates.recipientEmail && { recipientEmail: updates.recipientEmail }),
        ...(updates.subject && { subject: updates.subject }),
        ...(updates.body && { body: updates.body }),
      });
      return jsonRes(updated);
    } catch (err) { return jsonRes({ error: err.message }, 400); }
  }
  if (url.pathname.match(/^\/drafts\/[^/]+\/skip$/) && request.method === 'POST') {
    const rawId = url.pathname.split('/')[2];
    const queue = new DraftQueue(env.PERMIT_PULSE);
    try {
      const updated = await queue.updateDraft(`draft:${rawId}`, { status: 'skipped' });
      return jsonRes(updated);
    } catch (err) { return jsonRes({ error: err.message }, 400); }
  }

  // Phase 1: Update pipeline status (no_reply, replied, meeting, quoted, won, lost, cold)
  if (url.pathname.match(/^\/drafts\/[^/]+\/status$/) && request.method === 'POST') {
    const rawId = url.pathname.split('/')[2];
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const { pipelineStatus, dealValue, notes } = await request.json();
    const validStatuses = ['awaiting_reply', 'replied', 'meeting', 'quoted', 'won', 'lost', 'cold'];
    if (!validStatuses.includes(pipelineStatus)) return jsonRes({ error: `Invalid status. Use: ${validStatuses.join(', ')}` }, 400);
    try {
      const updates = { pipelineStatus, statusUpdatedAt: new Date().toISOString() };
      if (dealValue !== undefined) updates.dealValue = parseFloat(dealValue) || 0;
      if (notes) updates.notes = notes;
      const updated = await queue.updateDraft(`draft:${rawId}`, updates);
      // Update CRM
      await upsertArchitectCRMFromDraft(env.PERMIT_PULSE, updated, pipelineStatus);
      return jsonRes(updated);
    } catch (err) { return jsonRes({ error: err.message }, 400); }
  }

  // Phase 1: Add notes to a draft
  if (url.pathname.match(/^\/drafts\/[^/]+\/notes$/) && request.method === 'POST') {
    const rawId = url.pathname.split('/')[2];
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const { notes } = await request.json();
    try {
      const updated = await queue.updateDraft(`draft:${rawId}`, { notes });
      return jsonRes(updated);
    } catch (err) { return jsonRes({ error: err.message }, 400); }
  }

  // Phase 4: Analytics endpoint
  if (url.pathname === '/analytics' && request.method === 'GET') {
    const analytics = await getPipelineAnalytics(env.PERMIT_PULSE);
    return jsonRes(analytics);
  }

  // Phase 5: Architect CRM endpoints
  if (url.pathname === '/crm' && request.method === 'GET') {
    const records = await getAllArchitectCRMs(env.PERMIT_PULSE);
    return jsonRes(records);
  }
  if (url.pathname.match(/^\/crm\/[^/]+$/) && request.method === 'GET') {
    const license = url.pathname.split('/')[2];
    const record = await getArchitectCRM(env.PERMIT_PULSE, license);
    if (!record) return jsonRes({ error: 'Architect not found' }, 404);
    // Also fetch all drafts for this architect
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const allDrafts = await queue.getAllDrafts();
    const archDrafts = allDrafts.filter(d => d.architectLicense === license);
    return jsonRes({ ...record, drafts: archDrafts });
  }

  // Phase 2: Manual reply check trigger
  if (url.pathname === '/check-replies' && request.method === 'POST') {
    try {
      const result = await checkForReplies(env);
      return jsonRes(result);
    } catch (err) { return jsonRes({ error: err.message }, 500); }
  }

  // Phase 3: Manual follow-up generation trigger
  if (url.pathname === '/generate-followups' && request.method === 'POST') {
    try {
      const result = await generateFollowUps(env);
      return jsonRes(result);
    } catch (err) { return jsonRes({ error: err.message }, 500); }
  }

  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLOUDFLARE WORKER EXPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default {
  async scheduled(event, env) {
    console.log('⚡ PermitPulse scheduled run');
    // Run main scan pipeline
    await runDailyPipeline(env);
    // Phase 2: Check for replies to sent emails
    console.log('\n📬 Checking for replies...');
    const replyResult = await checkForReplies(env);
    console.log(`   Checked ${replyResult.checked}, found ${replyResult.replies} replies`);
    // Phase 3: Generate follow-ups for unreplied emails
    console.log('\n📝 Generating follow-ups...');
    const followUpResult = await generateFollowUps(env);
    console.log(`   Generated ${followUpResult.generated} follow-up drafts`);
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Gmail / Draft routes
    const gmailResponse = await handleGmailRoutes(request, env);
    if (gmailResponse) return gmailResponse;

    // Scanner routes
    if (url.pathname === '/scan') {
      const results = await runDailyPipeline(env);
      return jsonRes(results);
    }

    if (url.pathname === '/debug') {
      try {
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 14);
        const dateStr = dateFrom.toISOString().split('T')[0] + 'T00:00:00';
        const where = [
          `(applicant_professional_title='RA' OR applicant_professional_title='PE')`,
          `filing_date>'${dateStr}'`,
          `job_type='Alteration'`,
          `general_construction_work_type_='1'`,
          `(borough='MANHATTAN' OR borough='BROOKLYN' OR borough='QUEENS' OR borough='BRONX')`,
        ].join(' AND ');
        const apiUrl = `https://data.cityofnewyork.us/resource/w9ak-ipjd.json?$where=${encodeURIComponent(where)}&$order=filing_date DESC&$limit=10`;
        const res = await fetch(apiUrl);
        const data = await res.json();
        const costs = data.map(f => ({ name: `${f.applicant_first_name} ${f.applicant_last_name}`, cost: f.initial_cost, parsed: parseFloat(f.initial_cost), passes40k: (parseFloat(f.initial_cost) || 0) >= 40000 }));
        const totalPicked = env.PERMIT_PULSE ? (await env.PERMIT_PULSE.list({ prefix: 'picked:' })).keys.length : 'no KV';
        return jsonRes({ total: data.length, costs, dateStr, now: new Date().toISOString(), totalPicked, minCost: PROFILE.highEndSignals.minCost });
      } catch (err) {
        return jsonRes({ error: err.message, stack: err.stack });
      }
    }

    if (url.pathname === '/picked') {
      const tracker = new PickTracker(env.PERMIT_PULSE || null);
      const all = await tracker.getAllPicked();
      return jsonRes(all);
    }

    // Gmail test — sends a test email to yourself to verify the service account works
    if (url.pathname === '/gmail-test' && request.method === 'POST') {
      if (!hasGmailAuth(env)) {
        return jsonRes({ error: 'Gmail not configured. Set GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET (or GOOGLE_SERVICE_ACCOUNT).' }, 400);
      }
      const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
      try {
        const result = await sendGmail({
          to: sender,
          subject: 'PermitPulse — Gmail test',
          body: 'This is a test email from PermitPulse. If you received this, Gmail send is working correctly.\n\nSent at: ' + new Date().toISOString(),
          env,
        });
        return jsonRes({ success: true, messageId: result.messageId, sentTo: sender });
      } catch (err) {
        return jsonRes({ error: `Gmail test failed: ${err.message}`, hint: 'Check that GMAIL_REFRESH_TOKEN is set and the OAuth consent was granted for ' + sender }, 500);
      }
    }

    if (url.pathname === '/reset' && request.method === 'POST') {
      // Clear all picked architects and drafts
      const list = await env.PERMIT_PULSE.list();
      let deleted = 0;
      for (const key of list.keys) {
        await env.PERMIT_PULSE.delete(key.name);
        deleted++;
      }
      return jsonRes({ reset: true, deleted });
    }

    // Dashboard HTML (review + approve interface)
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      return new Response(getDashboardHTML(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return jsonRes({
      name: 'PermitPulse v4 — Architect Relationship Engine',
      endpoints: {
        '/': 'Review + approve dashboard',
        '/scan': 'Trigger daily pipeline',
        '/picked': 'View picked architects',
        '/drafts': 'List all email drafts',
        '/drafts/:id/edit': 'Edit draft (POST: {recipientEmail, subject, body})',
        '/drafts/:id/approve': 'Approve + send via Gmail (POST)',
        '/drafts/:id/skip': 'Skip a draft (POST)',
        '/drafts/:id/status': 'Update pipeline status (POST: {pipelineStatus, dealValue?, notes?})',
        '/drafts/:id/notes': 'Add notes (POST: {notes})',
        '/analytics': 'Pipeline funnel analytics (GET)',
        '/crm': 'All architect CRM records (GET)',
        '/crm/:license': 'Single architect CRM + draft history (GET)',
        '/check-replies': 'Check Gmail for replies (POST)',
        '/generate-followups': 'Generate follow-up drafts (POST)',
        '/gmail-test': 'Send test email to yourself (POST)',
      },
    });
  },
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REVIEW + APPROVE DASHBOARD (served at /)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PermitPulse</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#FFFCF7;--bg-card:rgba(255,255,255,0.88);--bg-card-hover:rgba(255,255,255,0.95);
  --border:rgba(238,230,216,0.9);--border-light:#EEE6D8;
  --text:#2A241F;--text-muted:#716254;--text-dim:#948372;
  --accent:#B88A52;--accent-light:rgba(184,138,82,0.12);--accent-dark:#946C40;
  --green:#16a34a;--green-bg:rgba(22,163,74,0.08);
  --blue:#2563eb;--blue-bg:rgba(37,99,235,0.08);
  --purple:#7c3aed;--purple-bg:rgba(124,58,237,0.08);
  --red:#dc2626;--red-bg:rgba(220,38,38,0.06);
  --orange:#ea580c;--orange-bg:rgba(234,88,12,0.08);
  --shadow:0 10px 30px -22px rgba(26,22,19,0.28),0 14px 40px -30px rgba(59,51,45,0.22);
  --shadow-hover:0 18px 44px -28px rgba(26,22,19,0.34),0 24px 52px -36px rgba(59,51,45,0.24);
  --shadow-soft:0 8px 24px -20px rgba(26,22,19,0.24);
  --radius:1.5rem;--font:"Avenir Next",Avenir,"Helvetica Neue","Segoe UI",Arial,sans-serif;
}
@media(prefers-color-scheme:dark){:root{
  --bg:#161412;--bg-card:rgba(34,30,26,0.9);--bg-card-hover:rgba(40,36,32,0.95);
  --border:#3A332D;--border-light:#3A332D;
  --text:#F6F1E8;--text-muted:#B2A697;--text-dim:#8A7D6E;
  --accent:#D2A86E;--accent-light:rgba(210,168,110,0.15);--accent-dark:#E8C08A;
  --green:#22c55e;--green-bg:rgba(34,197,94,0.12);
  --blue:#60a5fa;--blue-bg:rgba(96,165,250,0.12);
  --purple:#a78bfa;--purple-bg:rgba(167,139,250,0.12);
  --orange:#fb923c;--orange-bg:rgba(251,146,60,0.12);
  --shadow:0 20px 50px -34px rgba(0,0,0,0.6),0 10px 26px -18px rgba(0,0,0,0.45);
  --shadow-hover:0 24px 56px -30px rgba(0,0,0,0.7);
}}
body{font-family:var(--font);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;min-height:100vh;
  background-image:radial-gradient(circle at top left,rgba(184,138,82,0.12),transparent 30%),radial-gradient(circle at bottom right,rgba(59,51,45,0.08),transparent 28%)}
.hero{position:relative;margin:20px 20px 0;padding:28px;border-radius:34px;border:1px solid var(--border);background:var(--bg-card);box-shadow:var(--shadow);overflow:hidden;backdrop-filter:blur(8px)}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at top right,rgba(184,138,82,0.18),transparent 28%),radial-gradient(circle at bottom left,rgba(59,51,45,0.08),transparent 32%);pointer-events:none}
.hero-inner{position:relative;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px}
.hero-eyebrow{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.28em;color:var(--accent-dark)}
.hero-title{font-size:2rem;font-weight:600;letter-spacing:-0.03em;margin-top:12px}
.hero-desc{font-size:14px;color:var(--text-muted);margin-top:8px;line-height:1.6;max-width:520px}
.hero-actions{display:flex;gap:8px;align-self:flex-start;margin-top:8px;flex-wrap:wrap}
.tabs{display:flex;gap:4px;margin:20px 20px 0;background:var(--bg-card);border:1px solid var(--border);border-radius:28px;padding:4px;box-shadow:var(--shadow-soft)}
.tab{flex:1;padding:10px 16px;border-radius:24px;text-align:center;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;color:var(--text-muted);letter-spacing:0.02em}
.tab.active{background:var(--accent);color:#fff;box-shadow:var(--shadow-soft)}
.tab:hover:not(.active){background:var(--accent-light)}
.tab .tab-count{display:inline-block;font-size:10px;background:rgba(0,0,0,0.1);padding:1px 6px;border-radius:10px;margin-left:4px}
.tab.active .tab-count{background:rgba(255,255,255,0.25)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:20px 20px 0}
.stat-card{border-radius:28px;border:1px solid var(--border);background:var(--bg-card);padding:18px 20px;box-shadow:var(--shadow-soft);backdrop-filter:blur(8px);transition:transform .2s}
.stat-card:hover{transform:translateY(-2px)}
.stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.18em;color:var(--text-muted)}
.stat-value{font-size:22px;font-weight:600;letter-spacing:-0.02em;margin-top:4px}
.container{padding:20px;max-width:900px;margin:0 auto}
.card{border-radius:var(--radius);border:1px solid var(--border);background:var(--bg-card);padding:24px;margin-bottom:14px;box-shadow:var(--shadow);backdrop-filter:blur(8px);transition:all 0.3s ease;animation:fadeUp .35s ease-out both}
.card:hover{box-shadow:var(--shadow-hover);transform:translateY(-1px)}
.card.sent{border-left:3px solid var(--green)}.card.skipped{opacity:.35}.card.replied{border-left:3px solid var(--blue)}.card.meeting{border-left:3px solid var(--purple)}.card.quoted{border-left:3px solid var(--orange)}.card.won{border-left:3px solid var(--green);background:var(--green-bg)}.card.lost{opacity:.4}.card.cold{opacity:.3}.card.followup{border-left:3px dashed var(--accent)}
@keyframes fadeUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.arch-name{font-size:18px;font-weight:600;letter-spacing:-0.02em}
.arch-meta{font-size:12px;color:var(--text-dim);margin-top:3px}
.score-pill{font-size:13px;font-weight:700;color:var(--accent-dark);background:var(--accent-light);padding:6px 14px;border-radius:20px;white-space:nowrap}
.badge-row{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.badge{font-size:10px;padding:3px 10px;border-radius:20px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.badge-tier1{background:var(--accent-light);color:var(--accent-dark)}
.badge-tier2{background:rgba(148,131,114,0.1);color:var(--text-dim)}
.badge-pending{background:var(--accent-light);color:var(--accent-dark)}
.badge-sent{background:var(--green-bg);color:var(--green)}
.badge-skipped{background:rgba(148,131,114,0.1);color:var(--text-dim)}
.badge-replied{background:var(--blue-bg);color:var(--blue)}
.badge-meeting{background:var(--purple-bg);color:var(--purple)}
.badge-quoted{background:var(--orange-bg);color:var(--orange)}
.badge-won{background:var(--green-bg);color:var(--green)}
.badge-lost{background:var(--red-bg);color:var(--red)}
.badge-cold{background:rgba(148,131,114,0.1);color:var(--text-dim)}
.badge-awaiting_reply{background:rgba(148,131,114,0.08);color:var(--text-muted)}
.badge-followup{background:var(--accent-light);color:var(--accent-dark);border:1px dashed var(--accent)}
.links{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.links a{font-size:12px;color:var(--accent-dark);text-decoration:none;background:var(--accent-light);padding:6px 14px;border-radius:20px;font-weight:500;transition:all .2s}
.links a:hover{background:var(--accent);color:#fff}
.enrich-row{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.enrich-tag{font-size:11px;padding:4px 12px;border-radius:16px;background:rgba(148,131,114,0.08);color:var(--text-muted);font-weight:500}
label{display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.18em;color:var(--text-muted);margin-bottom:6px}
input,textarea,select{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:12px 16px;border-radius:16px;font-family:var(--font);font-size:13px;resize:vertical;transition:border .2s}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent)}
textarea{min-height:160px;line-height:1.6}
select{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23948372' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 16px center}
.field{margin-bottom:14px}
.btn{padding:10px 20px;border-radius:20px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:13px;font-family:var(--font);cursor:pointer;font-weight:500;transition:all .2s;box-shadow:var(--shadow-soft)}
.btn:hover{box-shadow:var(--shadow);transform:translateY(-1px)}
.btn:active{transform:scale(0.98)}
.btn-sm{padding:6px 14px;font-size:11px;border-radius:16px}
.btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn-primary:hover{filter:brightness(1.1)}
.btn-danger{color:var(--red);border-color:rgba(220,38,38,0.2)}
.btn-danger:hover{background:var(--red-bg)}
.btn-green{color:var(--green);border-color:rgba(22,163,74,0.2)}
.btn-blue{color:var(--blue);border-color:rgba(37,99,235,0.2)}
.card-actions{display:flex;gap:8px;margin-top:16px;padding-top:16px;border-top:1px solid var(--border);flex-wrap:wrap}
.empty{text-align:center;padding:60px 20px;color:var(--text-dim)}
.empty h3{font-size:18px;font-weight:600;color:var(--text);margin:12px 0 6px}
.loading{text-align:center;padding:60px;color:var(--text-muted);font-size:14px}
.funnel{display:flex;gap:2px;margin:20px 0;align-items:flex-end}
.funnel-step{flex:1;text-align:center;padding:12px 8px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card)}
.funnel-num{font-size:28px;font-weight:700;letter-spacing:-0.02em}
.funnel-label{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted);margin-top:4px}
.funnel-arrow{color:var(--text-dim);font-size:16px;padding:0 2px;align-self:center}
.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:20px 0}
.metric{border-radius:20px;border:1px solid var(--border);background:var(--bg-card);padding:20px;box-shadow:var(--shadow-soft)}
.metric-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted)}
.metric-value{font-size:32px;font-weight:700;margin-top:6px;letter-spacing:-0.03em}
.metric-sub{font-size:12px;color:var(--text-dim);margin-top:4px}
.crm-card{border-radius:20px;border:1px solid var(--border);background:var(--bg-card);padding:20px;margin-bottom:12px;box-shadow:var(--shadow-soft);cursor:pointer;transition:all .2s}
.crm-card:hover{box-shadow:var(--shadow);transform:translateY(-1px)}
.touchpoint{font-size:12px;padding:6px 0;border-bottom:1px solid var(--border);color:var(--text-muted)}
.touchpoint:last-child{border-bottom:none}
.pipeline-select{width:auto;display:inline-block;padding:6px 32px 6px 12px;border-radius:14px;font-size:11px;font-weight:600}
.notes-area{font-size:12px;min-height:60px;border-radius:12px;padding:10px 14px}
@media(max-width:600px){.hero{margin:12px;padding:20px;border-radius:24px}.hero-title{font-size:1.5rem}.tabs{margin:12px;border-radius:20px}.tabs .tab{font-size:11px;padding:8px 8px}.stats{margin:12px;grid-template-columns:1fr 1fr}.container{padding:12px}.card{padding:18px;border-radius:20px}.card-actions{flex-direction:column}.card-actions .btn{width:100%;text-align:center}.funnel{flex-wrap:wrap}.funnel-step{min-width:60px}.funnel-arrow{display:none}}
</style>
</head><body>
<div class="hero"><div class="hero-inner"><div>
<p class="hero-eyebrow">PermitPulse v4</p>
<h1 class="hero-title">Architect pipeline</h1>
<p class="hero-desc">Scan permits, draft outreach, track replies, close deals.</p>
</div><div class="hero-actions">
<button class="btn" onclick="refresh()">Refresh</button>
<button class="btn btn-blue" onclick="doCheckReplies()">Check replies</button>
<button class="btn" onclick="doGenFollowups()">Gen follow-ups</button>
<button class="btn btn-primary" onclick="triggerScan()">Run scan</button>
</div></div></div>

<div class="tabs" id="tabs">
<div class="tab active" data-tab="drafts">Drafts</div>
<div class="tab" data-tab="pipeline">Pipeline</div>
<div class="tab" data-tab="analytics">Analytics</div>
<div class="tab" data-tab="crm">CRM</div>
</div>

<div class="stats" id="stats"></div>
<div class="container" id="app"><div class="loading">Loading...</div></div>

<script>
var API=window.location.origin,drafts=[],analytics=null,crmData=[],currentTab='drafts';

// Tab switching
document.getElementById('tabs').addEventListener('click',function(e){
  if(!e.target.classList.contains('tab'))return;
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  e.target.classList.add('active');
  currentTab=e.target.getAttribute('data-tab');
  renderAll();
});

function refresh(){loadDrafts()}

async function loadDrafts(){
  document.getElementById('app').innerHTML='<div class="loading">Loading...</div>';
  try{
    var r=await fetch(API+'/drafts');drafts=await r.json();
    try{var ar=await fetch(API+'/analytics');analytics=await ar.json()}catch(e){analytics=null}
    try{var cr=await fetch(API+'/crm');crmData=await cr.json()}catch(e){crmData=[]}
    renderAll();
  }catch(e){document.getElementById('app').innerHTML='<div class="empty"><h3>Could not load</h3><p>'+e.message+'</p></div>'}
}

function renderAll(){renderStats();renderTab()}

function renderStats(){
  var p=drafts.filter(function(d){return d.status==='pending'}).length;
  var s=drafts.filter(function(d){return d.status==='sent'||d.pipelineStatus}).length;
  var re=drafts.filter(function(d){return d.pipelineStatus==='replied'||d.replyDetected}).length;
  var w=drafts.filter(function(d){return d.pipelineStatus==='won'}).length;
  document.getElementById('stats').innerHTML=
    '<div class="stat-card"><p class="stat-label">Pending</p><p class="stat-value" style="color:var(--accent-dark)">'+p+'</p></div>'+
    '<div class="stat-card"><p class="stat-label">Sent</p><p class="stat-value" style="color:var(--green)">'+s+'</p></div>'+
    '<div class="stat-card"><p class="stat-label">Replies</p><p class="stat-value" style="color:var(--blue)">'+re+'</p></div>'+
    '<div class="stat-card"><p class="stat-label">Won</p><p class="stat-value" style="color:var(--green)">'+w+'</p></div>';
  // Update tab counts
  var pending=drafts.filter(function(d){return d.status==='pending'}).length;
  var pipeline=drafts.filter(function(d){return d.status==='sent'||d.pipelineStatus}).length;
  var tabs=document.querySelectorAll('.tab');
  tabs[0].innerHTML='Drafts<span class="tab-count">'+pending+'</span>';
  tabs[1].innerHTML='Pipeline<span class="tab-count">'+pipeline+'</span>';
  tabs[2].innerHTML='Analytics';
  tabs[3].innerHTML='CRM<span class="tab-count">'+crmData.length+'</span>';
}

function renderTab(){
  if(currentTab==='drafts')renderDrafts();
  else if(currentTab==='pipeline')renderPipeline();
  else if(currentTab==='analytics')renderAnalytics();
  else if(currentTab==='crm')renderCRM();
}

// ── DRAFTS TAB ──
function renderDrafts(){
  var app=document.getElementById('app');app.innerHTML='';
  var pending=drafts.filter(function(d){return d.status==='pending'});
  if(!pending.length){app.innerHTML='<div class="empty"><h3>No pending drafts</h3><p>Run a scan or wait for the morning cron.</p></div>';return}
  pending.sort(function(a,b){if(a.tier==='tier1'&&b.tier!=='tier1')return-1;if(b.tier==='tier1'&&a.tier!=='tier1')return 1;return(b.score||0)-(a.score||0)});
  pending.forEach(function(d,i){renderDraftCard(app,d,i)});
}

function renderDraftCard(app,d,i){
  var sid=d.id.replace('draft:',''),div=document.createElement('div');
  div.className='card'+(d.isFollowUp?' followup':'');div.style.animationDelay=(i*40)+'ms';
  var enrichHtml='';
  if(d.firmName)enrichHtml+='<span class="enrich-tag">'+esc(d.firmName)+'</span>';
  if(d.linkedin)enrichHtml+='<a href="'+esc(d.linkedin)+'" target="_blank" class="enrich-tag" style="text-decoration:none;color:var(--accent-dark)">LinkedIn</a>';
  if(d.phone)enrichHtml+='<span class="enrich-tag">'+esc(d.phone)+'</span>';
  if(d.firmWebsite)enrichHtml+='<a href="'+esc(d.firmWebsite)+'" target="_blank" class="enrich-tag" style="text-decoration:none;color:var(--accent-dark)">Website</a>';
  var tierBadge=d.tier==='tier1'?'tier1':'tier2';
  var fuBadge=d.isFollowUp?'<span class="badge badge-followup">Follow-up #'+(d.followUpNumber||1)+'</span>':'';
  div.innerHTML='<div class="card-top"><div style="flex:1"><div class="badge-row"><span class="badge badge-'+tierBadge+'">'+(d.tier==='tier1'?'Priority':'Standard')+'</span>'+fuBadge+'</div><div class="arch-name"></div><div class="arch-meta"></div></div><div class="score-pill">'+(d.score||0)+'</div></div>'+(enrichHtml?'<div class="enrich-row">'+enrichHtml+'</div>':'')+'<div class="links"><a class="lk-e" target="_blank">Find email</a><a class="lk-f" target="_blank">Find firm</a></div><div class="field"><label>Architect email</label><input class="f-email" placeholder="architect@firm.com"></div><div class="field"><label>Subject</label><input class="f-subj"></div><div class="field"><label>Email body</label><textarea class="f-body"></textarea></div><div class="card-actions"><button class="btn btn-primary js-a">Send via Gmail</button><button class="btn js-s">Save edits</button><button class="btn btn-danger js-k">Skip</button></div>';
  div.querySelector('.arch-name').textContent=d.architectName||'Unknown';
  div.querySelector('.arch-meta').textContent=(d.architectLicense?'RA #'+d.architectLicense+' · ':'')+(d.projectAddress||'');
  div.querySelector('.lk-e').href='https://www.google.com/search?q='+encodeURIComponent((d.architectName||'')+' architect NYC email');
  div.querySelector('.lk-f').href='https://www.google.com/search?q='+encodeURIComponent((d.architectName||'')+' architect portfolio NYC');
  div.querySelector('.f-email').value=d.recipientEmail||'';
  div.querySelector('.f-subj').value=d.subject||'';
  div.querySelector('.f-body').value=d.body||'';
  div.querySelector('.js-a').addEventListener('click',function(){doApprove(sid,div)});
  div.querySelector('.js-s').addEventListener('click',function(){doSave(sid,div)});
  div.querySelector('.js-k').addEventListener('click',function(){doSkip(sid)});
  app.appendChild(div);
}

// ── PIPELINE TAB ──
function renderPipeline(){
  var app=document.getElementById('app');app.innerHTML='';
  var pipelineDrafts=drafts.filter(function(d){return d.status==='sent'||d.pipelineStatus});
  if(!pipelineDrafts.length){app.innerHTML='<div class="empty"><h3>No sent emails yet</h3><p>Send some drafts first, then track them here.</p></div>';return}
  var statusOrder={awaiting_reply:0,replied:1,meeting:2,quoted:3,won:4,lost:5,cold:6};
  pipelineDrafts.sort(function(a,b){var sa=statusOrder[a.pipelineStatus]||0,sb=statusOrder[b.pipelineStatus]||0;return sa-sb});
  pipelineDrafts.forEach(function(d,i){
    var sid=d.id.replace('draft:',''),div=document.createElement('div');
    var ps=d.pipelineStatus||'awaiting_reply';
    div.className='card '+ps;div.style.animationDelay=(i*30)+'ms';
    div.innerHTML='<div class="card-top"><div style="flex:1"><div class="badge-row"><span class="badge badge-'+ps+'">'+ps.replace(/_/g,' ')+'</span>'+(d.replyDetected?'<span class="badge badge-replied">reply detected</span>':'')+(d.followUpCount?'<span class="badge badge-followup">'+d.followUpCount+' follow-up'+(d.followUpCount>1?'s':'')+'</span>':'')+'</div><div class="arch-name"></div><div class="arch-meta"></div></div><div class="score-pill">'+(d.score||0)+'</div></div><div class="field"><label>Pipeline status</label><select class="pipeline-select ps-sel"><option value="awaiting_reply">Awaiting reply</option><option value="replied">Replied</option><option value="meeting">Meeting scheduled</option><option value="quoted">Quoted</option><option value="won">Won</option><option value="lost">Lost</option><option value="cold">Cold / No response</option></select></div>'+(ps==='quoted'||ps==='won'?'<div class="field"><label>Deal value ($)</label><input class="dv-input" type="number" placeholder="e.g. 4500" value="'+(d.dealValue||'')+'"></div>':'')+'<div class="field"><label>Notes</label><textarea class="notes-area n-input" placeholder="Add notes about this lead...">'+(d.notes||'')+'</textarea></div><div class="card-actions"><button class="btn btn-primary btn-sm js-save-status">Save status</button>'+(d.recipientEmail?'<span style="font-size:11px;color:var(--text-dim);padding:6px">Sent to '+esc(d.recipientEmail)+' on '+(d.sentAt?d.sentAt.slice(0,10):'?')+'</span>':'')+'</div>';
    div.querySelector('.arch-name').textContent=d.architectName||'Unknown';
    div.querySelector('.arch-meta').textContent=(d.projectAddress||'')+' · Sent '+(d.sentAt?timeAgo(d.sentAt):'?');
    div.querySelector('.ps-sel').value=ps;
    div.querySelector('.js-save-status').addEventListener('click',function(){
      var newStatus=div.querySelector('.ps-sel').value;
      var dv=div.querySelector('.dv-input');
      var notes=div.querySelector('.n-input').value;
      doUpdateStatus(sid,newStatus,dv?dv.value:'',notes);
    });
    app.appendChild(div);
  });
}

// ── ANALYTICS TAB ──
function renderAnalytics(){
  var app=document.getElementById('app');
  if(!analytics){app.innerHTML='<div class="loading">Loading analytics...</div>';return}
  var f=analytics.funnel,r=analytics.rates,rev=analytics.revenue,t=analytics.timing,ti=analytics.tiers;
  app.innerHTML='<div style="margin-bottom:24px"><h2 style="font-size:20px;font-weight:600;margin-bottom:16px;letter-spacing:-0.02em">Pipeline funnel</h2><div class="funnel"><div class="funnel-step"><div class="funnel-num">'+f.total+'</div><div class="funnel-label">Drafted</div></div><div class="funnel-arrow">→</div><div class="funnel-step"><div class="funnel-num" style="color:var(--green)">'+f.sent+'</div><div class="funnel-label">Sent</div></div><div class="funnel-arrow">→</div><div class="funnel-step"><div class="funnel-num" style="color:var(--blue)">'+f.replied+'</div><div class="funnel-label">Replied</div></div><div class="funnel-arrow">→</div><div class="funnel-step"><div class="funnel-num" style="color:var(--purple)">'+f.meeting+'</div><div class="funnel-label">Meeting</div></div><div class="funnel-arrow">→</div><div class="funnel-step"><div class="funnel-num" style="color:var(--orange)">'+f.quoted+'</div><div class="funnel-label">Quoted</div></div><div class="funnel-arrow">→</div><div class="funnel-step"><div class="funnel-num" style="color:var(--green)">'+f.won+'</div><div class="funnel-label">Won</div></div></div></div><div class="metric-grid"><div class="metric"><div class="metric-label">Reply rate</div><div class="metric-value" style="color:var(--blue)">'+r.replyRate+'%</div><div class="metric-sub">of sent emails got a reply</div></div><div class="metric"><div class="metric-label">Meeting rate</div><div class="metric-value" style="color:var(--purple)">'+r.meetingRate+'%</div><div class="metric-sub">of replies led to meetings</div></div><div class="metric"><div class="metric-label">Close rate</div><div class="metric-value" style="color:var(--green)">'+r.closeRate+'%</div><div class="metric-sub">of quotes turned into wins</div></div><div class="metric"><div class="metric-label">Avg reply time</div><div class="metric-value">'+t.avgReplyDays+'d</div><div class="metric-sub">business days to first reply</div></div><div class="metric"><div class="metric-label">Revenue attributed</div><div class="metric-value" style="color:var(--green)">$'+rev.estimated.toLocaleString()+'</div><div class="metric-sub">'+rev.wonDeals+' closed deal'+(rev.wonDeals!==1?'s':'')+'</div></div><div class="metric"><div class="metric-label">Follow-ups sent</div><div class="metric-value">'+f.followUps+'</div><div class="metric-sub">auto-generated sequences</div></div></div><div style="margin-top:24px"><h2 style="font-size:20px;font-weight:600;margin-bottom:16px;letter-spacing:-0.02em">Tier comparison</h2><div class="metric-grid"><div class="metric"><div class="metric-label">Tier 1 (Priority)</div><div class="metric-value">'+ti.tier1.rate+'%</div><div class="metric-sub">'+ti.tier1.replied+' replies from '+ti.tier1.sent+' sent</div></div><div class="metric"><div class="metric-label">Tier 2 (Standard)</div><div class="metric-value">'+ti.tier2.rate+'%</div><div class="metric-sub">'+ti.tier2.replied+' replies from '+ti.tier2.sent+' sent</div></div></div></div><div style="margin-top:24px"><div class="metric-grid"><div class="metric"><div class="metric-label">Total architects tracked</div><div class="metric-value">'+analytics.totalArchitects+'</div><div class="metric-sub">in 180-day database</div></div><div class="metric"><div class="metric-label">Cold / no response</div><div class="metric-value" style="color:var(--text-dim)">'+f.cold+'</div><div class="metric-sub">after '+2+' follow-ups</div></div><div class="metric"><div class="metric-label">Skipped</div><div class="metric-value">'+f.skipped+'</div><div class="metric-sub">manually skipped drafts</div></div></div></div>';
}

// ── CRM TAB ──
function renderCRM(){
  var app=document.getElementById('app');
  if(!crmData.length){app.innerHTML='<div class="empty"><h3>No architect records yet</h3><p>CRM records are created when you send emails.</p></div>';return}
  app.innerHTML='';
  crmData.sort(function(a,b){return(b.updatedAt||'').localeCompare(a.updatedAt||'')});
  crmData.forEach(function(c,i){
    var div=document.createElement('div');div.className='crm-card';div.style.animationDelay=(i*30)+'ms';
    var statusBadge=c.lastStatus?'<span class="badge badge-'+(c.lastStatus||'')+'">'+esc(c.lastStatus||'').replace(/_/g,' ')+'</span>':'';
    var contactInfo='';
    if(c.email)contactInfo+='<span class="enrich-tag">'+esc(c.email)+'</span>';
    if(c.phone)contactInfo+='<span class="enrich-tag">'+esc(c.phone)+'</span>';
    if(c.firmName)contactInfo+='<span class="enrich-tag">'+esc(c.firmName)+'</span>';
    if(c.linkedin)contactInfo+='<a href="'+esc(c.linkedin)+'" target="_blank" class="enrich-tag" style="text-decoration:none;color:var(--accent-dark)">LinkedIn</a>';
    var tps=(c.touchpoints||[]).slice(-5).reverse().map(function(tp){return '<div class="touchpoint"><strong>'+esc(tp.type)+'</strong> — '+timeAgo(tp.at)+(tp.detail?' · '+esc(tp.detail):'')+'</div>'}).join('');
    div.innerHTML='<div class="card-top"><div style="flex:1"><div class="badge-row">'+statusBadge+'</div><div class="arch-name"></div><div class="arch-meta"></div></div><div class="score-pill">'+(c.score||'—')+'</div></div>'+(contactInfo?'<div class="enrich-row">'+contactInfo+'</div>':'')+(tps?'<div style="margin-top:12px"><label>Recent touchpoints</label>'+tps+'</div>':'');
    div.querySelector('.arch-name').textContent=c.name||'Unknown';
    div.querySelector('.arch-meta').textContent='RA #'+(c.license||'?')+' · '+(c.projectAddress||'');
    app.appendChild(div);
  });
}

// ── HELPERS ──
function esc(s){var d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
function timeAgo(d){if(!d)return'?';var s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'}

function gF(d){return{email:d.querySelector('.f-email').value.trim(),subject:d.querySelector('.f-subj').value.trim(),body:d.querySelector('.f-body').value.trim()}}

async function doSave(id,div){var f=gF(div);try{await fetch(API+'/drafts/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientEmail:f.email,subject:f.subject,body:f.body})});alert('Saved')}catch(e){alert(e.message)}}

async function doApprove(id,div){var f=gF(div);if(!f.email||f.email.indexOf('@')<0){alert('Add email first');return}await fetch(API+'/drafts/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientEmail:f.email,subject:f.subject,body:f.body})});if(!confirm('Send to '+f.email+'?'))return;try{var r=await fetch(API+'/drafts/'+id+'/approve',{method:'POST'}),d=await r.json();if(d.success){alert('Sent!');loadDrafts()}else alert(d.error||'Failed')}catch(e){alert(e.message)}}

async function doSkip(id){if(!confirm('Skip?'))return;await fetch(API+'/drafts/'+id+'/skip',{method:'POST'});loadDrafts()}

async function doUpdateStatus(id,status,dealValue,notes){
  try{
    var body={pipelineStatus:status};
    if(dealValue)body.dealValue=dealValue;
    if(notes)body.notes=notes;
    await fetch(API+'/drafts/'+id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    loadDrafts();
  }catch(e){alert(e.message)}
}

async function triggerScan(){if(!confirm('Run scan now?'))return;document.getElementById('app').innerHTML='<div class="loading">Scanning DOB filings...</div>';try{var r=await fetch(API+'/scan'),d=await r.json();alert(d.picks+' new picks from '+d.scanned+' filings');loadDrafts()}catch(e){alert('Failed: '+e.message)}}

async function doCheckReplies(){try{var r=await fetch(API+'/check-replies',{method:'POST'}),d=await r.json();alert('Checked '+d.checked+' threads, found '+d.replies+' replies');loadDrafts()}catch(e){alert(e.message)}}

async function doGenFollowups(){try{var r=await fetch(API+'/generate-followups',{method:'POST'}),d=await r.json();alert('Generated '+d.generated+' follow-up drafts');loadDrafts()}catch(e){alert(e.message)}}

loadDrafts();
</script>
</body></html>`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLI MODE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const isNode = typeof process !== 'undefined' && process.argv;
if (isNode && process.argv[1]?.includes('permit-scanner')) {
  runDailyPipeline({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NOTIFY_EMAIL: process.env.NOTIFY_EMAIL || 'operations@metroglasspro.com',
  }).then(r => {
    console.log('\n' + JSON.stringify(r, null, 2));
  }).catch(err => {
    console.error('❌ Pipeline failed:', err);
    process.exit(1);
  });
}
