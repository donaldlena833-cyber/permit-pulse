/**
 * PermitPulse v3 — Architect Relationship Engine
 * 
 * Runs daily at 7am ET via Cloudflare Worker cron.
 * 
 * Pipeline:
 * 1. Pull new DOB Job Application Filings (architect-filed alterations)
 * 2. Score each architect against MetroGlassPro profile
 * 3. Check "already contacted" list to avoid repeats
 * 4. Pick top 5 new architects of the day
 * 5. Enrich with filing history + Google search for firm/email
 * 6. Draft personalized outreach emails
 * 7. Send digest to Donald for review + approval
 * 
 * ENV VARS:
 * - RESEND_API_KEY — for sending the digest email
 * - NOTIFY_EMAIL — where to send digest (default: operations@metroglasspro.com)
 * - KV namespace PERMIT_PULSE — stores contacted architect list
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FILINGS_API = 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json';
const PERMITS_API = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';
const DAILY_PICKS = 5;

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

  // Building characteristics that signal high-end residential (glass-heavy)
  highEndSignals: {
    minStories: 5,           // 5+ story buildings = likely condo/co-op
    minCost: 75000,          // $75K+ alterations = real renovation, not patch work
    sweetSpotMin: 150000,    // $150K-$2M = luxury apartment reno sweet spot
    sweetSpotMax: 2000000,
    maxDwellingUnits: 200,   // Under 200 units = boutique building, better access
    minFloorArea: 500,       // 500+ sqft construction area = substantial work
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

async function fetchRecentFilings(daysBack = 3) {
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - daysBack);
  const dateStr = dateFrom.toISOString().split('T')[0] + 'T00:00:00';

  const where = [
    `applicant_professional_title='RA'`,
    `filing_date>'${dateStr}'`,
    `initial_cost>'${PROFILE.highEndSignals.minCost}'`,
    `job_type='Alteration'`,
    `general_construction_work_type_='1'`,
    `(borough='MANHATTAN' OR borough='BROOKLYN' OR borough='QUEENS')`,
  ].join(' AND ');

  const url = `${FILINGS_API}?$where=${encodeURIComponent(where)}&$order=filing_date DESC&$limit=200`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Filings API error: ${res.status}`);
  return res.json();
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
  const addr = `${project.house_no} ${titleCase(project.street_name.toLowerCase())}`;
  const neighborhood = project.nta || project.borough;
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
    const mapsLink = `https://www.google.com/maps/search/${encodeURIComponent(p.house_no + ' ' + p.street_name + ', ' + p.borough + ', NY')}`;

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

    <div style="font-size:14px;font-weight:600;margin-bottom:4px;">📍 ${p.house_no} ${p.street_name}, ${p.borough}</div>
    <div style="font-size:12px;color:#8A8A96;margin-bottom:10px;">${p.nta || ''} · Floor: ${p.work_on_floor || '?'} · Filed: ${p.filing_date?.slice(0, 10)}</div>

    <div style="font-size:12px;color:#5C5C68;margin-bottom:10px;">
      ${pick.allReasons.map(r => `<span style="display:inline-block;background:#1E1E24;padding:2px 8px;border-radius:4px;margin:2px 4px 2px 0;border:1px solid #2A2A32;">${r}</span>`).join('')}
    </div>

    ${pick.recentProjects.length > 1 ? `
    <div style="font-size:12px;color:#5C5C68;margin-bottom:10px;">
      <strong style="color:#8A8A96;">Recent projects:</strong>
      ${pick.recentProjects.slice(0, 4).map(rp => `${rp.house_no} ${rp.street_name} (${rp.borough}, ${formatCost(rp.initial_cost)})`).join(' · ')}
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

  // Step 1: Fetch recent filings (last 3 days for overlap safety)
  console.log('\n📥 Step 1: Fetching recent filings...');
  const filings = await fetchRecentFilings(3);
  console.log(`   Found ${filings.length} architect-filed alterations`);

  // Step 2: Group by architect (unique RA license)
  console.log('\n🏗️  Step 2: Grouping by architect...');
  const architectMap = new Map();
  for (const f of filings) {
    const license = f.applicant_license;
    if (!license) continue;
    if (!architectMap.has(license)) {
      architectMap.set(license, {
        raLicense: license,
        firstName: f.applicant_first_name || '',
        lastName: f.applicant_last_name || '',
        name: `${f.applicant_first_name || ''} ${f.applicant_last_name || ''}`.trim(),
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

  // Step 4: Score each candidate
  console.log('\n📊 Step 4: Scoring candidates...');
  const scored = [];

  for (const candidate of candidates) {
    // Score the trigger filing (the most recent one)
    const bestFiling = candidate.filings.sort((a, b) =>
      (parseFloat(b.initial_cost) || 0) - (parseFloat(a.initial_cost) || 0)
    )[0];

    const filingScore = scoreCurrentFiling(bestFiling);

    // Fetch and score their full history
    const history = await fetchArchitectHistory(candidate.raLicense);
    const historyScore = scoreArchitectHistory(history);

    const totalScore = Math.min(filingScore.score + historyScore.score, 100);
    const allReasons = [...filingScore.reasons, ...historyScore.reasons];

    scored.push({
      ...candidate,
      triggerProject: bestFiling,
      recentProjects: history.slice(0, 5),
      filingScore: filingScore.score,
      historyScore: historyScore.score,
      totalScore,
      allReasons,
      historyStats: historyScore,
    });
  }

  // Sort by total score, take top 5
  scored.sort((a, b) => b.totalScore - a.totalScore);
  const topPicks = scored.slice(0, DAILY_PICKS);

  console.log(`\n🏆 Step 5: Top ${DAILY_PICKS} picks:`);
  for (let i = 0; i < topPicks.length; i++) {
    const pick = topPicks[i];
    console.log(`\n   #${i + 1} [Score: ${pick.totalScore}] ${pick.name} (RA #${pick.raLicense})`);
    console.log(`      Project: ${pick.triggerProject.house_no} ${pick.triggerProject.street_name}, ${pick.triggerProject.borough}`);
    console.log(`      Cost: $${pick.triggerProject.initial_cost} | ${pick.historyStats.totalFilings} filings in 2yr`);
    console.log(`      Reasons: ${pick.allReasons.join(' · ')}`);
  }

  // Step 6: Draft outreach emails + save to queue
  console.log('\n✉️  Step 6: Drafting outreach emails + saving to queue...');
  for (const pick of topPicks) {
    pick.draftEmail = draftOutreachEmail(pick);
    console.log(`   Draft for ${pick.name}: "${pick.draftEmail.subject}"`);

    // Save to draft queue for review/approve in dashboard
    if (env.PERMIT_PULSE) {
      const queue = new DraftQueue(env.PERMIT_PULSE);
      await queue.addDraft({
        architectName: pick.name,
        architectLicense: pick.raLicense,
        recipientEmail: null, // User will add this after Googling the architect
        subject: pick.draftEmail.subject,
        body: pick.draftEmail.body,
        projectAddress: `${pick.triggerProject.house_no} ${pick.triggerProject.street_name}, ${pick.triggerProject.borough}`,
        score: pick.totalScore,
      });
    }
  }

  // Step 7: Mark as picked (no repeats)
  console.log('\n💾 Step 7: Saving picks to tracker...');
  for (const pick of topPicks) {
    await tracker.markPicked(pick.raLicense, {
      name: pick.name,
      raLicense: pick.raLicense,
      score: pick.totalScore,
      triggerAddress: `${pick.triggerProject.house_no} ${pick.triggerProject.street_name}`,
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

import { DraftQueue, handleGmailRoutes, sendGmail } from './gmail-integration.mjs';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLOUDFLARE WORKER EXPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default {
  async scheduled(event, env) {
    await runDailyPipeline(env);
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
    const gmailResponse = handleGmailRoutes(request, env);
    if (gmailResponse) return gmailResponse;

    // Scanner routes
    if (url.pathname === '/scan') {
      const results = await runDailyPipeline(env);
      return jsonRes(results);
    }

    if (url.pathname === '/picked') {
      const tracker = new PickTracker(env.PERMIT_PULSE || null);
      const all = await tracker.getAllPicked();
      return jsonRes(all);
    }

    // Dashboard HTML (review + approve interface)
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      return new Response(getDashboardHTML(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    return jsonRes({
      name: 'PermitPulse v3 — Architect Relationship Engine',
      endpoints: {
        '/': 'Review + approve dashboard',
        '/scan': 'Trigger daily pipeline',
        '/picked': 'View picked architects',
        '/drafts': 'List pending email drafts',
        '/drafts/:id/edit': 'Edit draft (POST: {recipientEmail, subject, body})',
        '/drafts/:id/approve': 'Approve + send via Gmail (POST)',
        '/drafts/:id/skip': 'Skip a draft (POST)',
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
<title>PermitPulse — Review Outreach</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',system-ui,sans-serif;background:#0C0C0E;color:#E8E6E3;-webkit-font-smoothing:antialiased;min-height:100vh}
  .hdr{padding:20px 24px;border-bottom:1px solid #2A2A32;display:flex;align-items:center;justify-content:space-between;background:linear-gradient(180deg,rgba(212,105,26,0.04) 0%,transparent 100%)}
  .hdr h1{font-size:20px;font-weight:700}
  .hdr p{font-size:12px;color:#8A8A96}
  .hdr-actions{display:flex;gap:8px}
  .btn{padding:8px 16px;border-radius:6px;border:1px solid #2A2A32;background:#1E1E24;color:#E8E6E3;font-size:13px;font-family:inherit;cursor:pointer;font-weight:500;transition:all .15s}
  .btn:hover{border-color:#D4691A;color:#D4691A}
  .btn-send{background:#D4691A;border-color:#D4691A;color:#fff}
  .btn-send:hover{filter:brightness(1.15)}
  .btn-send:disabled{opacity:.4;cursor:not-allowed}
  .btn-skip{border-color:#35353F;color:#8A8A96}
  .btn-skip:hover{border-color:#E84545;color:#E84545}
  .container{padding:20px 24px;max-width:800px}
  .draft{background:#151518;border:1px solid #2A2A32;border-radius:10px;padding:20px;margin-bottom:16px;border-left:3px solid #D4691A}
  .draft.sent{border-left-color:#3A7D44;opacity:.6}
  .draft.skipped{border-left-color:#5C5C68;opacity:.4}
  .draft-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
  .arch-name{font-size:18px;font-weight:700}
  .arch-meta{font-size:12px;color:#8A8A96;margin-top:2px}
  .score{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:#D4691A;background:rgba(212,105,26,0.1);padding:4px 10px;border-radius:6px}
  .project{font-size:14px;margin-bottom:12px}
  .project strong{color:#D4691A}
  label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#5C5C68;font-weight:500;margin-bottom:4px}
  input,textarea{width:100%;background:#1E1E24;border:1px solid #2A2A32;color:#E8E6E3;padding:10px 12px;border-radius:6px;font-family:inherit;font-size:13px;resize:vertical}
  input:focus,textarea:focus{outline:none;border-color:#D4691A}
  textarea{min-height:200px;line-height:1.6}
  .field{margin-bottom:12px}
  .draft-actions{display:flex;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #2A2A32}
  .status-badge{font-size:11px;padding:3px 10px;border-radius:4px;font-weight:600;text-transform:uppercase}
  .status-badge.sent{background:rgba(58,125,68,0.2);color:#6abf7b}
  .status-badge.skipped{background:rgba(138,138,150,0.1);color:#5C5C68}
  .status-badge.pending{background:rgba(212,105,26,0.1);color:#D4691A}
  .empty{text-align:center;padding:60px;color:#5C5C68}
  .empty-ico{font-size:48px;margin-bottom:16px}
  .loading{text-align:center;padding:60px;color:#8A8A96}
  .links{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
  .links a{font-size:12px;color:#D4691A;text-decoration:none;background:#1E1E24;padding:4px 10px;border-radius:4px;border:1px solid #2A2A32}
  .links a:hover{border-color:#D4691A}
  @media(max-width:600px){.container{padding:12px}.draft{padding:14px}.draft-header{flex-direction:column;gap:8px}.draft-actions{flex-direction:column}}
</style>
</head><body>
<div class="hdr">
  <div><h1>⚡ PermitPulse — Review Outreach</h1><p>Edit emails, add architect's email, approve to send from Gmail</p></div>
  <div class="hdr-actions"><button class="btn" onclick="loadDrafts()">Refresh</button><button class="btn" onclick="triggerScan()">Run Scan</button></div>
</div>
<div class="container" id="app"><div class="loading">Loading drafts...</div></div>

<script>
const API = window.location.origin;
let drafts = [];

async function loadDrafts() {
  document.getElementById('app').innerHTML = '<div class="loading">Loading...</div>';
  try {
    const res = await fetch(API + '/drafts');
    drafts = await res.json();
    render();
  } catch(e) {
    document.getElementById('app').innerHTML = '<div class="empty"><div class="empty-ico">⚠️</div><p>Failed to load drafts</p></div>';
  }
}

async function triggerScan() {
  if(!confirm('Run the daily scan now? This will fetch new filings and create draft emails.')) return;
  document.getElementById('app').innerHTML = '<div class="loading">⏳ Running scan...</div>';
  try {
    const res = await fetch(API + '/scan');
    const data = await res.json();
    alert('Scan complete: ' + data.picks + ' new picks');
    loadDrafts();
  } catch(e) { alert('Scan failed: ' + e.message); }
}

function render() {
  const app = document.getElementById('app');
  if (drafts.length === 0) {
    app.innerHTML = '<div class="empty"><div class="empty-ico">📋</div><h3 style="font-size:18px;font-weight:600;margin-bottom:8px">No pending drafts</h3><p>Run a scan to generate new architect picks, or check back after the morning cron.</p></div>';
    return;
  }
  app.innerHTML = drafts.map((d, i) => draftCard(d, i)).join('');
}

function draftCard(d, i) {
  const id = d.id.replace('draft:', '');
  const statusClass = d.status;
  const disabled = d.status !== 'pending';
  return '<div class="draft ' + statusClass + '" id="card-' + id + '">'
    + '<div class="draft-header"><div>'
    + '<span class="status-badge ' + d.status + '">' + d.status + '</span> '
    + '<div class="arch-name">' + (d.architectName || 'Unknown') + '</div>'
    + '<div class="arch-meta">RA #' + (d.architectLicense || '?') + ' · ' + (d.projectAddress || '') + ' · Score: ' + (d.score || 0) + '</div>'
    + '</div><div class="score">' + (d.score || 0) + '</div></div>'
    + '<div class="links">'
    + '<a href="https://www.google.com/search?q=' + encodeURIComponent((d.architectName || '') + ' architect NYC email') + '" target="_blank">🔍 Find email</a>'
    + '<a href="https://www.google.com/search?q=' + encodeURIComponent((d.architectName || '') + ' architect portfolio') + '" target="_blank">🏢 Find firm</a>'
    + '</div>'
    + '<div class="field"><label>Architect email (required to send)</label>'
    + '<input id="email-' + id + '" value="' + (d.recipientEmail || '') + '" placeholder="architect@firm.com" ' + (disabled ? 'disabled' : '') + '></div>'
    + '<div class="field"><label>Subject</label>'
    + '<input id="subj-' + id + '" value="' + escHtml(d.subject || '') + '" ' + (disabled ? 'disabled' : '') + '></div>'
    + '<div class="field"><label>Email body (edit to your voice)</label>'
    + '<textarea id="body-' + id + '" ' + (disabled ? 'disabled' : '') + '>' + escHtml(d.body || '') + '</textarea></div>'
    + (disabled ? '' : '<div class="draft-actions">'
    + '<button class="btn btn-send" onclick="approveDraft(\'' + id + '\')">✉️ Save & Send via Gmail</button>'
    + '<button class="btn" onclick="saveDraft(\'' + id + '\')">💾 Save edits</button>'
    + '<button class="btn btn-skip" onclick="skipDraft(\'' + id + '\')">Skip</button>'
    + '</div>')
    + '</div>';
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

async function saveDraft(id) {
  const email = document.getElementById('email-' + id).value.trim();
  const subject = document.getElementById('subj-' + id).value.trim();
  const body = document.getElementById('body-' + id).value.trim();
  try {
    await fetch(API + '/drafts/' + id + '/edit', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ recipientEmail: email, subject, body })
    });
    alert('Draft saved');
    loadDrafts();
  } catch(e) { alert('Save failed: ' + e.message); }
}

async function approveDraft(id) {
  const email = document.getElementById('email-' + id).value.trim();
  if (!email || !email.includes('@')) { alert('Add the architect email first'); return; }
  // Save edits first
  const subject = document.getElementById('subj-' + id).value.trim();
  const body = document.getElementById('body-' + id).value.trim();
  await fetch(API + '/drafts/' + id + '/edit', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ recipientEmail: email, subject, body })
  });
  // Then approve (send)
  if (!confirm('Send this email to ' + email + ' from operations@metroglasspro.com?')) return;
  try {
    const res = await fetch(API + '/drafts/' + id + '/approve', { method: 'POST' });
    const data = await res.json();
    if (data.success) { alert('✅ Sent! Message ID: ' + data.messageId); }
    else { alert('❌ ' + (data.error || 'Send failed')); }
    loadDrafts();
  } catch(e) { alert('Send failed: ' + e.message); }
}

async function skipDraft(id) {
  if (!confirm('Skip this architect?')) return;
  await fetch(API + '/drafts/' + id + '/skip', { method: 'POST' });
  loadDrafts();
}

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
