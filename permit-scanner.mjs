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
 * 5. Enrich from DOB filing data (firm, owner, location)
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
 * (No paid APIs needed — enrichment from DOB filing data)
 * - NOTIFY_EMAIL — where to send digest (default: operations@metroglasspro.com)
 * - KV namespace PERMIT_PULSE — stores everything (picks, drafts, CRM, analytics)
 */

import { handlePermitPulseAutomationRequest, runPermitAutomationCycle } from './worker/permit-pulse/api.mjs';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const FILINGS_API = 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json';
const PERMITS_API = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';

// Tiered daily picks
const TIER1_PICKS = 15;  // Best matches — you review + personalize
const TIER2_PICKS = 20;  // Good matches — batch review, light edits
const TOTAL_MAX = 35;    // Max per scan (30+ per Donald's preference)

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
    `(job_type='Alteration' OR job_type='New Building')`,
    `general_construction_work_type_='1'`,
    `(borough='MANHATTAN' OR borough='BROOKLYN' OR borough='QUEENS' OR borough='BRONX' OR borough='STATEN ISLAND')`,
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
// FREE ENRICHMENT — extract firm data from DOB filings + web search links
// No paid APIs needed. All data from public sources.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function enrichFromFilings(architect) {
  const filing = architect.filings[0] || {};
  
  // Extract firm name from filing representative business name
  // This is the architect's firm in most cases
  const repBiz = (filing.filing_representative_business_name || '').trim();
  const repFirst = (filing.filing_representative_first_name || '').trim();
  const repLast = (filing.filing_representative_last_name || '').trim();
  const repAddr = [
    filing.filing_representative_street_name,
    filing.filing_representative_city,
    filing.filing_representative_state,
    filing.filing_representative_zip,
  ].filter(Boolean).join(', ').trim();

  // The applicant IS the architect. The filing rep might be the same person or an expediter.
  // If the rep business name contains the architect's last name, it's their firm.
  // If it doesn't, repBiz is likely the expediter and we use the applicant name as the firm hint.
  const archLast = (architect.lastName || '').toLowerCase();
  let firmName = null;
  let firmAddress = null;
  
  if (repBiz && archLast.length > 2 && repBiz.toLowerCase().includes(archLast)) {
    firmName = titleCase(repBiz.toLowerCase());
    firmAddress = repAddr || null;
  } else if (repBiz && repBiz.length > 3) {
    // Even if it doesn't match the name, store it as "filing rep" context
    firmName = titleCase(repBiz.toLowerCase());
    firmAddress = repAddr || null;
  }

  // Build useful search/lookup URLs
  const fullName = architect.name;
  const nysedUrl = architect.raLicense
    ? `https://eservices.nysed.gov/professions/verification-search?t=RA&n=${String(architect.raLicense).padStart(6, '0')}`
    : null;
  
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent('"' + fullName + '" architect NYC email')}`;
  const linkedinSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(fullName + ' architect site:linkedin.com')}`;
  const firmSearchUrl = firmName
    ? `https://www.google.com/search?q=${encodeURIComponent(firmName + ' architecture firm NYC')}`
    : `https://www.google.com/search?q=${encodeURIComponent(fullName + ' architect firm NYC')}`;

  // Try to construct a likely firm website from the firm name
  let firmWebsite = null;
  if (firmName) {
    // Common patterns: "Smith Architects" -> smitharchitects.com, "Jones Design" -> jonesdesign.com
    const cleaned = firmName.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '')
      .replace(/architects|architecture|design|studio|group|associates|llc|inc|pc|pllc/g, '');
    if (cleaned.length > 2) {
      firmWebsite = `https://www.google.com/search?q=${encodeURIComponent(firmName + ' architect website')}`;
    }
  }

  // Location data from filing
  const lat = parseFloat(filing.latitude) || null;
  const lng = parseFloat(filing.longitude) || null;
  const mapsUrl = lat && lng
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : (filing.house_no && filing.street_name ? `https://www.google.com/maps/search/${encodeURIComponent(filing.house_no + ' ' + filing.street_name + ', ' + filing.borough + ', NY')}` : null);

  // BIS lookup URL
  const boroNum = { 'MANHATTAN': '1', 'BRONX': '2', 'BROOKLYN': '3', 'QUEENS': '4', 'STATEN ISLAND': '5' };
  const bisUrl = filing.block && filing.lot
    ? `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${boroNum[filing.borough] || '1'}&block=${filing.block}&lot=${filing.lot}`
    : null;

  return {
    firmName: firmName,
    firmAddress: firmAddress,
    nysedUrl: nysedUrl,
    googleSearchUrl: googleSearchUrl,
    linkedinSearchUrl: linkedinSearchUrl,
    firmSearchUrl: firmSearchUrl,
    firmWebsite: firmWebsite,
    mapsUrl: mapsUrl,
    bisUrl: bisUrl,
    ownerName: (filing.owner_s_business_name || '').trim() || null,
    buildingBin: filing.bin || null,
    buildingBbl: filing.bbl || null,
    floorArea: filing.total_construction_floor_area || null,
    latitude: lat,
    longitude: lng,
    enrichmentSource: firmName ? 'dob_filing' : 'basic',
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
    reasons.push(`Sweet spot: $${Math.round(cost).toLocaleString()}`);
  } else if (cost > PROFILE.highEndSignals.sweetSpotMax) {
    score += s.costMega;
    reasons.push(`Mega: $${Math.round(cost).toLocaleString()}`);
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
    reasons.push('Residential');
  }
  if (floor.includes('penthouse') || floor.includes('ph')) {
    score += 5;
    reasons.push('Penthouse');
  }

  // Luxury building type indicators
  const bldgType = (filing.building_type || '').toLowerCase();
  if (bldgType.includes('condo') || bldgType.includes('co-op') || bldgType.includes('coop')) {
    score += 4;
    reasons.push('Condo/Co-op');
  }

  // Bathroom/kitchen work signals (glass-heavy scopes)
  const workDesc = (filing.work_on_floor || '').toLowerCase();
  if (workDesc.includes('bath') || workDesc.includes('shower') || workDesc.includes('master')) {
    score += 6;
    reasons.push('Bath/shower scope');
  }

  // Recency bonus — hotter leads filed in last 3 days
  if (filing.filing_date) {
    const filedDaysAgo = (Date.now() - new Date(filing.filing_date).getTime()) / 86400000;
    if (filedDaysAgo <= 3) {
      score += 5;
      reasons.push('Filed ' + Math.round(filedDaysAgo) + 'd ago');
    } else if (filedDaysAgo <= 7) {
      score += 2;
    }
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
  const firstName = titleCase(architect.firstName);
  const project = architect.triggerProject;
  const addr = `${project.house_no} ${titleCase(cleanStreetName(project.street_name).toLowerCase())}`;
  const neighborhood = titleCase((project.nta || project.borough || '').toLowerCase());
  const floor = (project.work_on_floor || '').toLowerCase();
  const cost = parseFloat(project.initial_cost) || 0;
  const stories = parseInt(project.existing_stories) || 0;
  const units = parseInt(project.existing_dwelling_units) || 0;

  // Detect project type
  const isPenthouse = floor.includes('penthouse') || floor.includes('ph');
  const isHighRiseCoop = stories >= 10 && units > 0;
  const isTownhouse = stories <= 4 && stories >= 2 && units <= 4;
  const isBathScope = floor.includes('bath') || floor.includes('shower') || floor.includes('master');
  const isMega = cost >= 500000;

  // Project-type context for the render offer
  let projectContext = 'your project at ' + addr;
  let renderOffer = 'shower enclosure configurations and finish options';
  if (isPenthouse) {
    projectContext = 'the penthouse renovation at ' + addr;
    renderOffer = 'oversized shower enclosures and custom mirror walls in different finish options';
  } else if (isHighRiseCoop) {
    projectContext = 'the co-op renovation at ' + addr;
    renderOffer = 'glass configurations with different hardware finishes so your client can visualize before committing';
  } else if (isTownhouse) {
    projectContext = 'your townhouse project at ' + addr;
    renderOffer = 'shower enclosures, partitions, or statement mirrors in different finish options';
  } else if (isBathScope) {
    projectContext = 'the bathroom renovation at ' + addr;
    renderOffer = 'frameless shower configurations — different door styles, glass types, and hardware finishes';
  } else if (isMega) {
    projectContext = 'the renovation at ' + addr;
    renderOffer = 'glass partitions, shower enclosures, and mirror walls with finish options your client can review';
  }

  const subject = `Free glass visualization renders for ${addr}`;

  const body = `Hi ${firstName},

I'm Donald with MetroGlass Pro. If glass or mirrors are part of the scope on ${projectContext}, we offer something most glass companies don't. Free 3D visualization renders.

Send us the floor plans and we'll create renders showing ${renderOffer}. It helps your client decide faster and makes the approval process smoother.

A few other things we do differently:
We install in 5 to 7 business days from measurement, which is faster than most competitors.
Full 1 year warranty on materials and workmanship.
We coordinate directly with building management on COIs and access.

Our recent work: metroglasspro.com

Happy to chat if it's useful.

Best,
Donald Lena
MetroGlass Pro
(332) 999-3846
operations@metroglasspro.com`;

  // LinkedIn connect message (short, under 300 chars)
  const linkedin = `Hi ${firstName}, I'm Donald with MetroGlass Pro. We do custom glass work for residential renovations in NYC. If glass is part of the scope on your ${neighborhood} project, we offer free 3D renders to help your client visualize. Happy to connect.`;

  // Phone script
  const phone = `Hi ${firstName}, this is Donald from MetroGlass Pro. I'm reaching out because I saw you have a project at ${addr}. We do custom frameless glass work for residential renovations and I wanted to see if glass or mirrors are part of the scope. We offer free 3D visualization renders if you send us the floor plans. Can I send you some info?`;

  return { subject, body, linkedin, phone };
}

// Generate GC-specific outreach (price-focused, thinner margins)
function draftGCOutreachEmail(gcName, gcFirstName, project) {
  const addr = `${project.house_no} ${titleCase(cleanStreetName(project.street_name).toLowerCase())}`;
  const neighborhood = titleCase((project.nta || project.borough || '').toLowerCase());

  const subject = `Glass sub for ${addr}, competitive pricing`;
  const body = `Hi ${gcFirstName},

I'm Donald with MetroGlass Pro. We sub glass work for residential renovations in NYC. Frameless shower doors, mirrors, glass partitions.

If you need a glass sub for ${addr}, happy to provide a competitive bid. We do 5 to 7 business day turnaround from measurement, handle our own COIs, and warranty everything for a year.

We keep pricing straightforward and work well with GC schedules. Recent work: metroglasspro.com

Donald Lena
MetroGlass Pro
(332) 999-3846
operations@metroglasspro.com`;

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

  console.log('⚡ PermitPulse v4 — Daily Architect Scan');
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

  // Step 3: Filter out already-picked architects + detect re-engagements (Phase 6)
  console.log('\n🔄 Step 3: Deduplicating + detecting re-engagements...');
  const candidates = [];
  const reEngagements = [];
  for (const [license, arch] of architectMap) {
    const picked = await tracker.hasBeenPicked(license);
    if (!picked) {
      candidates.push(arch);
    } else if (env.PERMIT_PULSE) {
      // Phase 6: Check if this is a re-engagement opportunity
      // The picked record exists but the 180-day TTL means it's still active
      // We check the CRM to see if they were previously cold/lost and have new activity
      try {
        const crm = await getArchitectCRM(env.PERMIT_PULSE, license);
        if (crm && (crm.lastStatus === 'cold' || crm.lastStatus === 'lost') && arch.filings.length > 0) {
          const pickedData = await env.PERMIT_PULSE.get(`picked:${license}`, 'json');
          if (pickedData) {
            reEngagements.push({ ...arch, previousContact: pickedData });
          }
        }
      } catch (e) { /* skip */ }
    }
  }
  console.log(`   ${candidates.length} new architects (${architectMap.size - candidates.length} already picked)`);
  if (reEngagements.length > 0) {
    console.log(`   🔄 ${reEngagements.length} re-engagement opportunities detected`);
  }

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

  // Step 5.5: Enrich ALL picks from DOB filing data (free, no API needed)
  console.log('\n🔍 Step 5.5: Enriching contacts from filing data...');
  let enriched = 0;
  for (const pick of topPicks) {
    const data = enrichFromFilings(pick);
    pick.enrichment = data;
    if (data.firmName) enriched++;
    if (data.firmName) {
      console.log(`   ✅ ${pick.name}: firm=${data.firmName}`);
    }
  }
  console.log(`   ${enriched}/${topPicks.length} with firm name identified`);

  // Step 6: Draft outreach emails + save to queue
  console.log('\n✉️  Step 6: Drafting outreach emails + saving to queue...');
  for (const pick of topPicks) {
    pick.draftEmail = draftOutreachEmail(pick);
    const tp = pick.triggerProject;
    const e = pick.enrichment || {};

    if (env.PERMIT_PULSE) {
      const queue = new DraftQueue(env.PERMIT_PULSE);
      await queue.addDraft({
        architectName: pick.name,
        architectLicense: pick.raLicense,
        recipientEmail: null,
        subject: pick.draftEmail.subject,
        body: pick.draftEmail.body,
        linkedinMessage: pick.draftEmail.linkedin || null,
        phoneScript: pick.draftEmail.phone || null,
        // Project data (title-cased)
        projectAddress: titleCase(`${tp.house_no} ${cleanStreetName(tp.street_name)}`.toLowerCase()) + ', ' + titleCase((tp.borough || '').toLowerCase()),
        projectCost: parseFloat(tp.initial_cost) || 0,
        projectStories: parseInt(tp.existing_stories) || 0,
        projectUnits: parseInt(tp.existing_dwelling_units) || 0,
        projectBorough: tp.borough,
        projectNeighborhood: tp.nta || '',
        projectFloor: tp.work_on_floor || '',
        projectBuildingType: tp.building_type || '',
        filingDate: tp.filing_date || null,
        filingStatus: tp.filing_status || '',
        jobDescription: tp.specialinspectionrequirement || '',
        // Geolocation
        latitude: parseFloat(tp.latitude) || null,
        longitude: parseFloat(tp.longitude) || null,
        // Building identifiers
        buildingBin: tp.bin || null,
        buildingBbl: tp.bbl || null,
        buildingBlock: tp.block || null,
        buildingLot: tp.lot || null,
        // Scoring
        scoringReasons: pick.allReasons || [],
        score: pick.totalScore,
        tier: pick.tier || 'tier2',
        // Enrichment from DOB data
        ...e,
      });
    }
  }
  console.log(`   ${topPicks.length} drafts saved to queue`);

  // Step 6.5: Create re-engagement drafts (Phase 6)
  if (env.PERMIT_PULSE && reEngagements.length > 0) {
    console.log(`\n🔄 Step 6.5: Drafting re-engagement emails...`);
    const queue = new DraftQueue(env.PERMIT_PULSE);
    let reCount = 0;
    for (const re of reEngagements.slice(0, 5)) { // Max 5 re-engagements per scan
      const bestFiling = re.filings.sort((a, b) => (parseFloat(b.initial_cost) || 0) - (parseFloat(a.initial_cost) || 0))[0];
      const email = draftReEngagementEmail({ ...re, triggerProject: bestFiling }, re.previousContact);
      await queue.addDraft({
        architectName: re.name,
        architectLicense: re.raLicense,
        recipientEmail: null,
        subject: email.subject,
        body: email.body,
        projectAddress: `${bestFiling.house_no} ${cleanStreetName(bestFiling.street_name)}, ${bestFiling.borough}`,
        score: 0,
        tier: 'reengagement',
        isReEngagement: true,
        previousContactDate: re.previousContact.pickedDate,
      });
      reCount++;
    }
    console.log(`   ${reCount} re-engagement drafts created`);
  }

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

async function sendGmail({ to, subject, body, env, threadId }) {
  const sender = env.GMAIL_SENDER || 'operations@metroglasspro.com';
  const accessToken = await getGmailAccessToken(env);
  const gmailUser = (env.GMAIL_REFRESH_TOKEN) ? 'me' : sender;

  // Convert plain text body to clean HTML
  const htmlBody = textToHtml(body, sender);

  const boundary = 'permitpulse_' + Date.now();
  const headers = [
    `From: MetroGlass Pro <${sender}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  // Send both plain text and HTML (email clients pick the best one)
  const rawEmail = [
    ...headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const payload = { raw: base64UrlEncode(rawEmail) };
  if (threadId) payload.threadId = threadId;
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${gmailUser}/messages/send`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
  const result = await res.json();
  return { success: true, messageId: result.id, threadId: result.threadId };
}

function textToHtml(text, senderEmail) {
  // Split body from signature
  const lines = text.split('\\n');
  let bodyLines = [];
  let sigLines = [];
  let inSig = false;

  for (const line of lines) {
    if (!inSig && (line.startsWith('Best,') || line.startsWith('Donald Lena') || line.startsWith('All the best'))) {
      inSig = true;
    }
    if (inSig) {
      sigLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  // Convert body paragraphs to HTML
  const bodyHtml = bodyLines
    .join('\\n')
    .split('\\n\\n')
    .map(para => {
      const escaped = para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Convert single newlines within a paragraph to <br>
      return '<p style="margin:0 0 16px 0;line-height:1.6">' + escaped.replace(/\\n/g, '<br>') + '</p>';
    })
    .join('');

  // Build signature HTML
  const sigHtml = sigLines.length > 0 ? '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;font-size:14px;color:#333">' +
    '<p style="margin:0 0 2px 0"><strong>Donald Lena</strong></p>' +
    '<p style="margin:0 0 2px 0;color:#666">MetroGlass Pro</p>' +
    '<p style="margin:0 0 2px 0"><a href="tel:+13329993846" style="color:#D4691A;text-decoration:none">(332) 999-3846</a></p>' +
    '<p style="margin:0 0 2px 0"><a href="mailto:' + senderEmail + '" style="color:#D4691A;text-decoration:none">' + senderEmail + '</a></p>' +
    '<p style="margin:0"><a href="https://metroglasspro.com" style="color:#D4691A;text-decoration:none">metroglasspro.com</a></p>' +
    '</div>' : '';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;background:#fff">' +
    '<div style="max-width:600px;margin:0 auto;padding:20px">' +
    bodyHtml +
    sigHtml +
    '</div></body></html>';
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
const FOLLOWUP_WAIT_DAYS = 12; // ~2.5 weeks — respectful spacing for cold outreach

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
    // Follow-up 1: Offer something concrete, a photo or case study
    return {
      subject: `Re: ${draft.subject}`,
      body: `Hi ${firstName},

Quick follow-up. I put together some photos of recent glass work we did on a similar project in case it's relevant to ${addr}. Happy to send them over or just answer any questions about scope or pricing.

No pressure at all, just wanted to make sure the offer's on the table.

Best,
Donald Lena
MetroGlass Pro
(332) 999-3846`,
    };
  }

  // Follow-up 2: Plant a seed for the future, close the loop
  return {
    subject: `Re: ${draft.subject}`,
    body: `Hi ${firstName},

Just a final note. If glass or mirrors come up on this project or any future ones, we'd be glad to help. Our site has recent work: metroglasspro.com

Either way, best of luck with ${addr}.

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

  const subject = `Great to see your new project at ${addr}`;
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
    // Fast dedup via index key instead of scanning all drafts
    if (draft.architectLicense) {
      const idx = `pidx:${draft.architectLicense}`;
      const existingId = await this.kv.get(idx);
      if (existingId) {
        const existing = await this.kv.get(existingId, 'json');
        if (existing && existing.status === 'pending') {
          console.log(`   ⏭️  Skip dup: ${draft.architectName} (${draft.architectLicense})`);
          return existing;
        }
        await this.kv.delete(idx);
      }
    }
    const id = `draft:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Store ALL fields passed in (not a fixed list)
    const record = { id, status: 'pending', createdAt: new Date().toISOString(), ...draft };
    await this.kv.put(id, JSON.stringify(record), { expirationTtl: 365 * 86400 });
    if (draft.architectLicense) {
      await this.kv.put(`pidx:${draft.architectLicense}`, id, { expirationTtl: 30 * 86400 });
    }
    return record;
  }

  async getDraft(id) {
    // Safety: try both raw and decoded versions of the ID
    let result = await this.kv.get(id, 'json');
    if (!result) {
      try { result = await this.kv.get(decodeURIComponent(id), 'json'); } catch(e) {}
    }
    return result;
  }

  async updateDraft(id, updates) {
    const existing = await this.getDraft(id);
    if (!existing) throw new Error(`Draft ${id} not found`);
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    // Use the stored ID (not the URL-decoded one) to ensure key consistency
    await this.kv.put(existing.id, JSON.stringify(updated), { expirationTtl: 365 * 86400 });
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
    const draftId = `draft:${decodeURIComponent(rawId)}`;
    const draft = await queue.getDraft(draftId);
    if (!draft) return jsonRes({ error: `Draft not found. Looking for key: ${draftId}`, rawId }, 404);
    if (!draft.recipientEmail) return jsonRes({ error: 'No recipient email. Edit draft first.' }, 400);
    if (!hasGmailAuth(env)) return jsonRes({ error: 'Gmail not configured. Set GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET secrets.' }, 400);
    try {
      // For follow-up drafts, look up parent's threadId to reply in same thread
      let threadId = null;
      if (draft.isFollowUp && draft.originalDraftId) {
        const parent = await queue.getDraft(draft.originalDraftId);
        if (parent && parent.gmailThreadId) threadId = parent.gmailThreadId;
      }
      const result = await sendGmail({ to: draft.recipientEmail, subject: draft.subject, body: draft.body, env, threadId });
      await queue.updateDraft(draft.id, { status: 'sent', sentAt: new Date().toISOString(), gmailMessageId: result.messageId, gmailThreadId: result.threadId, pipelineStatus: 'awaiting_reply', followUpCount: draft.followUpCount || 0 });
      await upsertArchitectCRMFromDraft(env.PERMIT_PULSE, draft, 'sent');
      return jsonRes({ success: true, messageId: result.messageId });
    } catch (err) { return jsonRes({ error: `Send failed: ${err.message}` }, 500); }
  }
  if (url.pathname.match(/^\/drafts\/[^/]+\/edit$/) && request.method === 'POST') {
    const rawId = url.pathname.split('/')[2];
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const draftId = `draft:${decodeURIComponent(rawId)}`;
    const updates = await request.json();
    try {
      const updated = await queue.updateDraft(`draft:${decodeURIComponent(rawId)}`, {
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
      const updated = await queue.updateDraft(`draft:${decodeURIComponent(rawId)}`, { status: 'skipped' });
      return jsonRes(updated);
    } catch (err) { return jsonRes({ error: err.message }, 400); }
  }

  // Phase 1: Update pipeline status (no_reply, replied, meeting, quoted, won, lost, cold)
  if (url.pathname.match(/^\/drafts\/[^/]+\/status$/) && request.method === 'POST') {
    const rawId = url.pathname.split('/')[2];
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const { pipelineStatus, dealValue, notes, outcomeReason, quoteScope } = await request.json();
    const validStatuses = ['awaiting_reply', 'replied', 'meeting', 'quoted', 'won', 'lost', 'cold'];
    if (!validStatuses.includes(pipelineStatus)) return jsonRes({ error: `Invalid status. Use: ${validStatuses.join(', ')}` }, 400);
    try {
      const updates = { pipelineStatus, statusUpdatedAt: new Date().toISOString() };
      if (dealValue !== undefined) updates.dealValue = parseFloat(dealValue) || 0;
      if (notes) updates.notes = notes;
      if (outcomeReason) updates.outcomeReason = outcomeReason; // Why won/lost
      if (quoteScope) updates.quoteScope = quoteScope; // What was quoted (shower, mirrors, etc.)
      const updated = await queue.updateDraft(`draft:${decodeURIComponent(rawId)}`, updates);
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
      const updated = await queue.updateDraft(`draft:${decodeURIComponent(rawId)}`, { notes });
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

  // CSV export of pipeline data
  if (url.pathname === '/export.csv' && request.method === 'GET') {
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const allDrafts = await queue.getAllDrafts();
    const headers = ['Architect','License','Email','Firm','Project Address','Score','Tier','Status','Pipeline Status','Sent Date','Reply Detected','Follow-ups','Deal Value','Notes'];
    const rows = allDrafts.map(d => [
      d.architectName, d.architectLicense, d.recipientEmail || '', d.firmName || '',
      d.projectAddress || '', d.score || '', d.tier || '', d.status,
      d.pipelineStatus || '', d.sentAt ? d.sentAt.slice(0,10) : '',
      d.replyDetected ? 'Yes' : 'No', d.followUpCount || 0,
      d.dealValue || '', (d.notes || '').replace(/"/g, '""'),
    ].map(v => `"${v}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    return new Response(csv, {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="permitpulse-pipeline.csv"', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Batch send: send all pending drafts that have an email filled in
  if (url.pathname === '/batch-send' && request.method === 'POST') {
    if (!hasGmailAuth(env)) return jsonRes({ error: 'Gmail not configured' }, 400);
    const queue = new DraftQueue(env.PERMIT_PULSE);
    const allDrafts = await queue.getAllDrafts();
    const ready = allDrafts.filter(d => d.status === 'pending' && d.recipientEmail && d.recipientEmail.includes('@'));
    let sent = 0, failed = 0;
    for (const draft of ready) {
      try {
        // Handle follow-up threading
        let threadId = null;
        if (draft.isFollowUp && draft.originalDraftId) {
          const parent = await queue.getDraft(draft.originalDraftId);
          if (parent && parent.gmailThreadId) threadId = parent.gmailThreadId;
        }
        const result = await sendGmail({ to: draft.recipientEmail, subject: draft.subject, body: draft.body, env, threadId });
        await queue.updateDraft(draft.id, { status: 'sent', sentAt: new Date().toISOString(), gmailMessageId: result.messageId, gmailThreadId: result.threadId, pipelineStatus: 'awaiting_reply', followUpCount: draft.followUpCount || 0 });
        await upsertArchitectCRMFromDraft(env.PERMIT_PULSE, draft, 'sent');
        sent++;
      } catch (err) { failed++; }
    }
    return jsonRes({ sent, failed, total: ready.length });
  }

  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLOUDFLARE WORKER EXPORTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default {
  async scheduled(event, env) {
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      console.log('⚡ PermitPulse automation cycle');
      await runPermitAutomationCycle(env);
      return;
    }

    const hour = new Date().getUTCHours();
    // 12 UTC = 7am ET (morning scan), 23 UTC = 6pm ET (maintenance only)
    const isMorningScan = (hour >= 10 && hour <= 14);
    
    if (isMorningScan) {
      console.log('⚡ PermitPulse morning scan');
      await runDailyPipeline(env);
    } else {
      console.log('⚡ PermitPulse evening maintenance (no scan)');
    }
    
    // Always: check replies + generate follow-ups
    if (hasGmailAuth(env)) {
      console.log('\n📬 Checking for replies...');
      const replyResult = await checkForReplies(env);
      console.log(`   Checked ${replyResult.checked}, found ${replyResult.replies} replies`);
    }
    console.log('\n📝 Generating follow-ups...');
    const followUpResult = await generateFollowUps(env);
    console.log(`   Generated ${followUpResult.generated} follow-up drafts`);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const automationResponse = await handlePermitPulseAutomationRequest(request, env, ctx);
    if (automationResponse) return automationResponse;

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
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#0F0E0C">
<title>PermitPulse</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0F0E0C;--bg2:rgba(28,26,23,0.92);--bg3:rgba(36,33,29,0.88);--bdr:rgba(62,56,48,0.6);--bdr2:rgba(62,56,48,0.3);--tx:#EDE8DF;--tx2:#A89E90;--tx3:#7A7067;--ac:#C9944A;--acl:rgba(201,148,74,0.14);--acd:#DDB06A;--g:#34d399;--gb:rgba(52,211,153,0.1);--bl:#60a5fa;--blb:rgba(96,165,250,0.1);--pu:#a78bfa;--pub:rgba(167,139,250,0.1);--rd:#f87171;--rdb:rgba(248,113,113,0.08);--or:#fb923c;--orb:rgba(251,146,60,0.1);--yl:#fbbf24;--ylb:rgba(251,191,36,0.1);--sh:0 12px 40px -16px rgba(0,0,0,0.6);--sh2:0 4px 20px -10px rgba(0,0,0,0.4);--r:20px;--f:'DM Sans',system-ui,sans-serif}
body{font-family:var(--f);background:var(--bg);color:var(--tx);-webkit-font-smoothing:antialiased;min-height:100dvh;padding-bottom:env(safe-area-inset-bottom)}
.w{max-width:860px;margin:0 auto;padding:0 16px}
.hero{padding:28px 0 0}.hr{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px}
.he{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3em;color:var(--ac)}
.ht{font-size:1.6rem;font-weight:700;letter-spacing:-0.03em;margin:8px 0 2px}.hd{font-size:12px;color:var(--tx3)}
.ha{display:flex;gap:5px;flex-wrap:wrap}
.tabs{display:flex;gap:2px;margin:16px 0 0;background:var(--bg2);border:1px solid var(--bdr);border-radius:14px;padding:3px}
.tab{flex:1;padding:8px;border-radius:11px;text-align:center;font-size:11px;font-weight:700;cursor:pointer;transition:.2s;color:var(--tx3);user-select:none}
.tab.on{background:var(--ac);color:#fff}.tab:hover:not(.on){background:var(--acl);color:var(--tx)}
.tc{font-size:9px;opacity:.7;margin-left:2px}
.sts{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:14px 0}
.st{border-radius:14px;border:1px solid var(--bdr2);background:var(--bg2);padding:12px 14px}
.sl{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.2em;color:var(--tx3)}
.sv{font-size:22px;font-weight:800;letter-spacing:-.03em;margin-top:1px}
#app{margin:14px 0 40px}
.c{border-radius:var(--r);border:1px solid var(--bdr);background:var(--bg2);padding:18px;margin-bottom:8px;box-shadow:var(--sh2);transition:.25s;animation:u .25s ease both;position:relative}
.c:hover{box-shadow:var(--sh)}.c.sent{border-left:3px solid var(--g)}.c.replied{border-left:3px solid var(--bl)}.c.meeting{border-left:3px solid var(--pu)}.c.quoted{border-left:3px solid var(--or)}.c.won{border-left:3px solid var(--g);background:var(--gb)}.c.lost{opacity:.3}.c.cold{opacity:.2}.c.fu{border-left:3px dashed var(--ac)}.c.re{border-left:3px solid var(--yl)}.c.skipped{opacity:.25}
.c.urg::after{content:'⚡ Needs attention';position:absolute;top:10px;right:10px;font-size:8px;font-weight:800;letter-spacing:.06em;color:var(--or);background:var(--orb);padding:2px 8px;border-radius:8px}
@keyframes u{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:translateY(0)}}
.rw{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.nm{font-size:15px;font-weight:700;letter-spacing:-.02em}.mt{font-size:10px;color:var(--tx3);margin-top:1px}
.pl{font-size:12px;font-weight:800;color:var(--ac);background:var(--acl);padding:4px 10px;border-radius:12px;white-space:nowrap}
.bs{display:flex;gap:3px;margin:8px 0;flex-wrap:wrap}
.b{font-size:8px;padding:2px 7px;border-radius:10px;font-weight:800;text-transform:uppercase;letter-spacing:.4px}
.bt1{background:var(--acl);color:var(--ac)}.bt2{background:rgba(122,112,103,.1);color:var(--tx3)}.bre{background:var(--ylb);color:var(--yl)}.bfu{background:var(--acl);color:var(--ac);border:1px dashed var(--ac)}
.baw{background:rgba(122,112,103,.06);color:var(--tx3)}.brp{background:var(--blb);color:var(--bl)}.bmt{background:var(--pub);color:var(--pu)}.bqt{background:var(--orb);color:var(--or)}.bwn{background:var(--gb);color:var(--g)}.bls{background:var(--rdb);color:var(--rd)}.bco{background:rgba(122,112,103,.08);color:var(--tx3)}
.en{display:flex;gap:3px;margin:6px 0;flex-wrap:wrap}
.et{font-size:9px;padding:3px 8px;border-radius:10px;background:rgba(122,112,103,.06);color:var(--tx2);font-weight:600;text-decoration:none;transition:.15s}
a.et:hover{background:var(--acl);color:var(--ac)}
.lk{display:flex;gap:4px;margin:8px 0;flex-wrap:wrap}
.lk a{font-size:9px;color:var(--ac);text-decoration:none;background:var(--acl);padding:4px 10px;border-radius:10px;font-weight:700;transition:.15s}
.lk a:hover{background:var(--ac);color:#fff}
label{display:block;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:.2em;color:var(--tx3);margin-bottom:4px}
input,textarea,select{width:100%;background:rgba(15,14,12,.5);border:1px solid var(--bdr);color:var(--tx);padding:9px 12px;border-radius:12px;font-family:var(--f);font-size:12px;transition:.15s}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--ac)}
textarea{min-height:120px;line-height:1.5;resize:vertical}
select{cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%237A7067' d='M4 6L0 1h8z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
.fd{margin-bottom:8px}
.btn{padding:8px 16px;border-radius:12px;border:1px solid var(--bdr);background:var(--bg3);color:var(--tx);font-size:11px;font-family:var(--f);cursor:pointer;font-weight:700;transition:.15s}
.btn:hover{transform:translateY(-1px);box-shadow:var(--sh2)}.btn:active{transform:scale(.97)}
.bs2{padding:5px 10px;font-size:10px;border-radius:10px}
.bp{background:var(--ac);border-color:var(--ac);color:#fff}.bp:hover{filter:brightness(1.1)}
.bd{color:var(--rd);border-color:rgba(248,113,113,.15)}.bd:hover{background:var(--rdb)}
.ac{display:flex;gap:5px;margin-top:12px;padding-top:12px;border-top:1px solid var(--bdr2);flex-wrap:wrap}
.empty{text-align:center;padding:50px 20px;color:var(--tx3)}.empty h3{font-size:15px;font-weight:700;color:var(--tx);margin:6px 0 3px}
.ld{text-align:center;padding:50px;color:var(--tx2);font-size:12px}
.fn{display:flex;gap:2px;margin:14px 0;align-items:flex-end}
.fs{flex:1;text-align:center;padding:12px 4px;border-radius:12px;border:1px solid var(--bdr2);background:var(--bg2)}
.fv{font-size:26px;font-weight:800;letter-spacing:-.03em}.fl{font-size:7px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:var(--tx3);margin-top:2px}
.fa{color:var(--tx3);font-size:12px;align-self:center}
.mg{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:14px 0}
.m{border-radius:16px;border:1px solid var(--bdr2);background:var(--bg2);padding:16px}
.ml{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3)}
.mv{font-size:28px;font-weight:800;margin-top:3px;letter-spacing:-.03em}.ms{font-size:10px;color:var(--tx3);margin-top:1px}
.cc{border-radius:16px;border:1px solid var(--bdr2);background:var(--bg2);padding:16px;margin-bottom:8px;transition:.2s;animation:u .25s ease both}
.cc:hover{box-shadow:var(--sh2);transform:translateY(-1px)}
.tp{font-size:10px;padding:4px 0;border-bottom:1px solid var(--bdr2);color:var(--tx3)}.tp:last-child{border-bottom:none}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--bg3);border:1px solid var(--bdr);color:var(--tx);padding:10px 20px;border-radius:14px;font-size:12px;font-weight:700;z-index:999;box-shadow:var(--sh);transition:.3s ease;backdrop-filter:blur(10px)}
.toast.show{transform:translateX(-50%) translateY(0)}.toast.ok{border-color:rgba(52,211,153,.3);color:var(--g)}.toast.err{border-color:rgba(248,113,113,.3);color:var(--rd)}
@media(max-width:600px){.ht{font-size:1.3rem}.sts{grid-template-columns:repeat(2,1fr)}.sv{font-size:18px}.c{padding:14px;border-radius:16px}.ac{flex-direction:column}.ac .btn{width:100%;text-align:center}.fn{flex-wrap:wrap;gap:4px}.fs{min-width:60px}.fa{display:none}.mg{grid-template-columns:1fr 1fr}.ha{width:100%}.ha .btn{flex:1;text-align:center;padding:7px 6px;font-size:10px}}
</style>
</head><body>
<div class="w">
<div class="hero"><div class="hr"><div>
<p class="he">PermitPulse</p>
<h1 class="ht">Architect pipeline</h1>
<p class="hd">Scan → Draft → Send → Track → Close</p>
</div><div class="ha">
<button class="btn bs2" onclick="refresh()">↻</button>
<button class="btn bs2" onclick="doReplies()">Replies</button>
<button class="btn bs2" onclick="doFU()">Follow-ups</button>
<button class="btn bs2 bp" onclick="doScan()">Scan</button>
</div></div>
<div class="tabs" id="tabs">
<div class="tab on" data-t="drafts">Drafts</div>
<div class="tab" data-t="pipeline">Pipeline</div>
<div class="tab" data-t="analytics">Analytics</div>
<div class="tab" data-t="crm">CRM</div>
</div>
<div class="sts" id="sts"></div>
</div>
<div id="app"><div class="ld">Loading...</div></div>
</div>
<div class="toast" id="toast"></div>
<script>
var A=window.location.origin,D=[],an=null,cr=[],T='drafts';
document.getElementById('tabs').onclick=function(e){var t=e.target;if(!t.dataset.t)return;document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('on')});t.classList.add('on');T=t.dataset.t;rT()};
function toast(m,t){var e=document.getElementById('toast');e.className='toast '+(t==='ok'?'ok':t==='err'?'err':'');e.textContent=m;e.classList.add('show');setTimeout(function(){e.classList.remove('show')},2600)}
function refresh(){ld()}
async function ld(){
  document.getElementById('app').innerHTML='<div class="ld">Loading...</div>';
  try{D=await(await fetch(A+'/drafts')).json();
  try{an=await(await fetch(A+'/analytics')).json()}catch(e){an=null}
  try{cr=await(await fetch(A+'/crm')).json()}catch(e){cr=[]}
  rS();rT()}catch(e){document.getElementById('app').innerHTML='<div class="empty"><h3>Error</h3><p>'+X(e.message)+'</p></div>'}
}
function rS(){
  var p=D.filter(function(d){return d.status==='pending'}).length;
  var s=D.filter(function(d){return d.status==='sent'||d.pipelineStatus}).length;
  var re=D.filter(function(d){return d.pipelineStatus==='replied'||d.replyDetected}).length;
  var rv=D.filter(function(d){return d.pipelineStatus==='won'}).reduce(function(a,d){return a+(d.dealValue||0)},0);
  document.getElementById('sts').innerHTML='<div class="st"><p class="sl">Pending</p><p class="sv" style="color:var(--ac)">'+p+'</p></div><div class="st"><p class="sl">Sent</p><p class="sv" style="color:var(--g)">'+s+'</p></div><div class="st"><p class="sl">Replies</p><p class="sv" style="color:var(--bl)">'+re+'</p></div><div class="st"><p class="sl">Revenue</p><p class="sv" style="color:var(--g)">$'+(rv>0?rv.toLocaleString():'0')+'</p></div>';
  var tabs=document.querySelectorAll('.tab');
  tabs[0].innerHTML='Drafts<span class="tc">'+p+'</span>';tabs[1].innerHTML='Pipeline<span class="tc">'+s+'</span>';tabs[2].innerHTML='Analytics';tabs[3].innerHTML='CRM<span class="tc">'+cr.length+'</span>';
}
function rT(){var a=document.getElementById('app');a.innerHTML='';if(T==='drafts')rDr(a);else if(T==='pipeline')rPi(a);else if(T==='analytics')rAn(a);else rCr(a)}
function rDr(a){
  var p=D.filter(function(d){return d.status==='pending'});
  if(!p.length){a.innerHTML='<div class="empty"><h3>No pending drafts</h3><p>Run a scan or wait for 7am cron.</p></div>';return}
  var we=p.filter(function(d){return d.recipientEmail&&d.recipientEmail.includes('@')}).length;
  if(we>0){var b=document.createElement('div');b.style.cssText='display:flex;gap:6px;margin-bottom:12px;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:14px;border:1px solid var(--bdr2);background:var(--bg2)';b.innerHTML='<span style="font-size:11px;color:var(--tx2)"><b style="color:var(--ac)">'+we+'</b> ready to send</span><div style="display:flex;gap:4px"><button class="btn bs2 bp" onclick="doBatch()">Send all '+we+'</button><a href="'+A+'/export.csv" class="btn bs2" style="text-decoration:none">↓ CSV</a></div>';a.appendChild(b)}
  p.sort(function(a,b){if(a.tier==='tier1'&&b.tier!=='tier1')return-1;if(b.tier==='tier1'&&a.tier!=='tier1')return 1;return(b.score||0)-(a.score||0)});
  p.forEach(function(d,i){mD(a,d,i)})
}
function mD(a,d,i){
  var sid=d.id.replace('draft:',''),v=document.createElement('div');
  var cl='c';if(d.isFollowUp)cl+=' fu';if(d.isReEngagement)cl+=' re';
  v.className=cl;v.style.animationDelay=(i*30)+'ms';
  var en='';
  if(d.firmName)en+='<span class="et">'+X(d.firmName)+'</span>';
  if(d.firmAddress)en+='<span class="et" style="font-size:8px">'+X(d.firmAddress)+'</span>';
  if(d.ownerName)en+='<span class="et" style="font-size:8px">Owner: '+X(d.ownerName)+'</span>';
  if(d.floorArea)en+='<span class="et">'+X(d.floorArea)+' sqft</span>';
  var tb=d.tier==='tier1'?'<span class="b bt1">Priority</span>':d.tier==='reengagement'?'<span class="b bre">Re-engage</span>':'<span class="b bt2">Standard</span>';
  var fb=d.isFollowUp?'<span class="b bfu">F/U #'+(d.followUpNumber||1)+'</span>':'';
  // Use enriched URLs if available, fall back to constructed ones
  var ny=d.nysedUrl||(d.architectLicense?'https://eservices.nysed.gov/professions/verification-search?t=RA&n='+String(d.architectLicense).padStart(6,'0'):'');
  var mapsUrl=d.mapsUrl||(d.projectAddress?'https://www.google.com/maps/search/'+encodeURIComponent(d.projectAddress+', NY'):'');
  // Project details line
  var projDetails=[];
  if(d.projectCost)projDetails.push('$'+d.projectCost.toLocaleString());
  if(d.projectStories)projDetails.push(d.projectStories+' stories');
  if(d.projectNeighborhood)projDetails.push(d.projectNeighborhood);
  if(d.filingDate)projDetails.push('Filed '+tA(d.filingDate));
  var projLine=projDetails.length?'<div style="font-size:9px;color:var(--tx3);margin:4px 0">'+projDetails.join(' · ')+'</div>':'';
  // Scoring reasons
  var reasons=(d.scoringReasons||[]).slice(0,4).map(function(r){return'<span style="font-size:8px;display:inline-block;padding:1px 6px;border-radius:6px;background:rgba(122,112,103,.06);color:var(--tx3);margin:1px">'+X(r)+'</span>'}).join('');
  var reasonsHtml=reasons?'<div style="margin:4px 0">'+reasons+'</div>':'';
  // Email body is collapsible — show first 2 lines by default
  var bodyId='body-'+sid;
  // Multi-channel sections (LinkedIn + phone)
  var channels='';
  if(d.linkedinMessage)channels+='<div class="fd" style="margin-top:4px"><label>LinkedIn message <span class="cpy" style="color:var(--ac);cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0">[copy]</span></label><textarea class="lm" style="min-height:36px;max-height:36px;overflow:hidden;font-size:11px">'+X(d.linkedinMessage)+'</textarea></div>';
  if(d.phoneScript)channels+='<div class="fd"><label>Phone script <span class="cpy2" style="color:var(--ac);cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0">[copy]</span></label><textarea class="ps2" style="min-height:36px;max-height:36px;overflow:hidden;font-size:11px">'+X(d.phoneScript)+'</textarea></div>';
  v.innerHTML='<div class="rw"><div style="flex:1"><div class="bs">'+tb+fb+'</div><div class="nm"></div><div class="mt"></div>'+projLine+reasonsHtml+'</div><div class="pl">'+(d.score||0)+'</div></div>'+(en?'<div class="en">'+en+'</div>':'')+'<div class="lk">'+(ny?'<a href="'+ny+'" target="_blank">NYSED</a>':'')+(mapsUrl?'<a href="'+mapsUrl+'" target="_blank">Maps</a>':'')+(d.bisUrl?'<a href="'+X(d.bisUrl)+'" target="_blank">BIS</a>':'')+'<a class="le" target="_blank">Email</a><a class="ll" target="_blank">LinkedIn</a>'+(d.firmSearchUrl?'<a href="'+X(d.firmSearchUrl)+'" target="_blank">Firm</a>':'<a class="lf" target="_blank">Firm</a>')+'</div><div class="fd"><label>Email</label><input class="fe" placeholder="architect@firm.com"></div><div class="fd"><label>Subject</label><input class="fs2"></div><div class="fd"><label>Body <span class="tog" style="color:var(--ac);cursor:pointer;font-weight:400;text-transform:none;letter-spacing:0">[expand]</span></label><textarea class="fb" style="min-height:48px;max-height:48px;overflow:hidden"></textarea></div>'+channels+'<div class="ac"><button class="btn bp ja">Send email</button><button class="btn jv">Save</button><button class="btn bd jk">Skip</button></div>';
  v.querySelector('.nm').textContent=d.architectName||'Unknown';
  v.querySelector('.mt').textContent=(d.architectLicense?'RA #'+d.architectLicense+' · ':'')+(d.projectAddress||'');
  var n=d.architectName||'';
  v.querySelector('.le').href=d.googleSearchUrl||('https://www.google.com/search?q='+encodeURIComponent('"'+n+'" architect NYC email'));
  v.querySelector('.ll').href=d.linkedinSearchUrl||('https://www.google.com/search?q='+encodeURIComponent(n+' architect site:linkedin.com'));
  var lfEl=v.querySelector('.lf');if(lfEl)lfEl.href='https://www.google.com/search?q='+encodeURIComponent(n+' architect portfolio NYC');
  v.querySelector('.fe').value=d.recipientEmail||'';v.querySelector('.fs2').value=d.subject||'';
  var ta=v.querySelector('.fb');ta.value=d.body||'';
  // Toggle expand/collapse
  var tog=v.querySelector('.tog');
  tog.onclick=function(){
    var expanded=ta.style.maxHeight!=='48px';
    ta.style.maxHeight=expanded?'48px':'none';
    ta.style.minHeight=expanded?'48px':'120px';
    ta.style.overflow=expanded?'hidden':'visible';
    tog.textContent=expanded?'[expand]':'[collapse]';
  };
  v.querySelector('.ja').onclick=function(){doA(sid,v)};v.querySelector('.jv').onclick=function(){doV(sid,v)};v.querySelector('.jk').onclick=function(){doK(sid)};
  // Copy buttons for LinkedIn/phone
  var cpyLi=v.querySelector('.cpy');if(cpyLi){cpyLi.onclick=function(){var t=v.querySelector('.lm');if(t){navigator.clipboard.writeText(t.value);toast('Copied','ok')}}}
  var cpyPh=v.querySelector('.cpy2');if(cpyPh){cpyPh.onclick=function(){var t=v.querySelector('.ps2');if(t){navigator.clipboard.writeText(t.value);toast('Copied','ok')}}}
  a.appendChild(v)
}
function rPi(a){
  var p=D.filter(function(d){return d.status==='sent'||d.pipelineStatus});
  if(!p.length){a.innerHTML='<div class="empty"><h3>No sent emails</h3><p>Send drafts first.</p></div>';return}
  var bar=document.createElement('div');bar.style.cssText='display:flex;gap:6px;margin-bottom:10px;justify-content:flex-end';bar.innerHTML='<a href="'+A+'/export.csv" class="btn bs2" style="text-decoration:none">↓ CSV</a>';a.appendChild(bar);
  var so={awaiting_reply:0,replied:1,meeting:2,quoted:3,won:4,lost:5,cold:6};
  p.sort(function(a,b){return(so[a.pipelineStatus]||0)-(so[b.pipelineStatus]||0)});
  p.forEach(function(d,i){
    var sid=d.id.replace('draft:',''),v=document.createElement('div'),ps=d.pipelineStatus||'awaiting_reply';
    var urg=ps==='awaiting_reply'&&d.sentAt&&(Date.now()-new Date(d.sentAt).getTime())>7*86400000;
    v.className='c '+ps+(urg?' urg':'');v.style.animationDelay=(i*20)+'ms';
    var bc={awaiting_reply:'baw',replied:'brp',meeting:'bmt',quoted:'bqt',won:'bwn',lost:'bls',cold:'bco'};
    var dv=(ps==='quoted'||ps==='won')?'<div class="fd" style="flex:1;min-width:100px;margin:0"><label>Deal $</label><input class="dv" type="number" placeholder="4500" value="'+(d.dealValue||'')+'"></div>':'';
    v.innerHTML='<div class="rw"><div style="flex:1"><div class="bs"><span class="b '+(bc[ps]||'baw')+'">'+ps.replace(/_/g,' ')+'</span>'+(d.replyDetected?'<span class="b brp">reply</span>':'')+(d.followUpCount?'<span class="b bfu">'+d.followUpCount+' f/u</span>':'')+'</div><div class="nm"></div><div class="mt"></div></div><div class="pl">'+(d.score||0)+'</div></div><div style="display:flex;gap:6px;margin:10px 0;flex-wrap:wrap"><div class="fd" style="flex:2;min-width:120px;margin:0"><label>Status</label><select class="ps"><option value="awaiting_reply">Awaiting reply</option><option value="replied">Replied</option><option value="meeting">Meeting</option><option value="quoted">Quoted</option><option value="won">Won ✓</option><option value="lost">Lost</option><option value="cold">Cold</option></select></div>'+dv+'</div><div class="fd"><label>Notes</label><textarea class="ni" style="min-height:40px;font-size:11px" placeholder="Notes...">'+(X(d.notes||''))+'</textarea></div><div class="ac"><button class="btn bs2 bp jss">Save</button><span style="font-size:9px;color:var(--tx3);padding:4px">'+(d.recipientEmail?'→ '+X(d.recipientEmail):'—')+' · '+(d.sentAt?tA(d.sentAt):'?')+'</span></div>';
    v.querySelector('.nm').textContent=d.architectName||'Unknown';v.querySelector('.mt').textContent=d.projectAddress||'';
    v.querySelector('.ps').value=ps;
    v.querySelector('.jss').onclick=function(){var ns=v.querySelector('.ps').value,dvi=v.querySelector('.dv'),n=v.querySelector('.ni').value;doSt(sid,ns,dvi?dvi.value:'',n)};
    a.appendChild(v)})
}
function rAn(a){
  if(!an){a.innerHTML='<div class="ld">Loading...</div>';return}
  var f=an.funnel,r=an.rates,rv=an.revenue,t=an.timing,ti=an.tiers;
  a.innerHTML='<h2 style="font-size:16px;font-weight:800;margin-bottom:10px">Funnel</h2><div class="fn"><div class="fs"><div class="fv">'+f.total+'</div><div class="fl">Draft</div></div><div class="fa">→</div><div class="fs"><div class="fv" style="color:var(--g)">'+f.sent+'</div><div class="fl">Sent</div></div><div class="fa">→</div><div class="fs"><div class="fv" style="color:var(--bl)">'+f.replied+'</div><div class="fl">Reply</div></div><div class="fa">→</div><div class="fs"><div class="fv" style="color:var(--pu)">'+f.meeting+'</div><div class="fl">Meet</div></div><div class="fa">→</div><div class="fs"><div class="fv" style="color:var(--or)">'+f.quoted+'</div><div class="fl">Quote</div></div><div class="fa">→</div><div class="fs"><div class="fv" style="color:var(--g)">'+f.won+'</div><div class="fl">Won</div></div></div><div class="mg"><div class="m"><div class="ml">Reply rate</div><div class="mv" style="color:var(--bl)">'+r.replyRate+'%</div><div class="ms">of sent</div></div><div class="m"><div class="ml">Meeting rate</div><div class="mv" style="color:var(--pu)">'+r.meetingRate+'%</div><div class="ms">of replies</div></div><div class="m"><div class="ml">Close rate</div><div class="mv" style="color:var(--g)">'+r.closeRate+'%</div><div class="ms">of quoted</div></div><div class="m"><div class="ml">Reply time</div><div class="mv">'+t.avgReplyDays+'d</div><div class="ms">avg biz days</div></div><div class="m"><div class="ml">Revenue</div><div class="mv" style="color:var(--g)">$'+rv.estimated.toLocaleString()+'</div><div class="ms">'+rv.wonDeals+' deal'+(rv.wonDeals!==1?'s':'')+'</div></div><div class="m"><div class="ml">Follow-ups</div><div class="mv">'+f.followUps+'</div><div class="ms">auto-generated</div></div></div><h2 style="font-size:16px;font-weight:800;margin:20px 0 10px">Tiers</h2><div class="mg"><div class="m"><div class="ml">Tier 1</div><div class="mv">'+ti.tier1.rate+'%</div><div class="ms">'+ti.tier1.replied+'/'+ti.tier1.sent+'</div></div><div class="m"><div class="ml">Tier 2</div><div class="mv">'+ti.tier2.rate+'%</div><div class="ms">'+ti.tier2.replied+'/'+ti.tier2.sent+'</div></div><div class="m"><div class="ml">Tracked</div><div class="mv">'+an.totalArchitects+'</div><div class="ms">architects</div></div><div class="m"><div class="ml">Cold</div><div class="mv" style="color:var(--tx3)">'+f.cold+'</div><div class="ms">no response</div></div></div>'
}
function rCr(a){
  if(!cr.length){a.innerHTML='<div class="empty"><h3>No records</h3><p>CRM populates on send.</p></div>';return}
  cr.sort(function(a,b){return(b.updatedAt||'').localeCompare(a.updatedAt||'')});
  cr.forEach(function(c,i){
    var v=document.createElement('div');v.className='cc';v.style.animationDelay=(i*20)+'ms';
    var bc={replied:'brp',meeting:'bmt',quoted:'bqt',won:'bwn',lost:'bls',cold:'bco',sent:'baw',awaiting_reply:'baw'};
    var sb=c.lastStatus?'<span class="b '+(bc[c.lastStatus]||'baw')+'">'+X(c.lastStatus).replace(/_/g,' ')+'</span>':'';
    var ci='';
    if(c.email)ci+='<span class="et">'+X(c.email)+'</span>';if(c.phone)ci+='<span class="et">'+X(c.phone)+'</span>';if(c.firmName)ci+='<span class="et">'+X(c.firmName)+'</span>';
    if(c.linkedin)ci+='<a href="'+X(c.linkedin)+'" target="_blank" class="et">LinkedIn↗</a>';if(c.firmWebsite)ci+='<a href="'+X(c.firmWebsite)+'" target="_blank" class="et">Web↗</a>';
    var tp=(c.touchpoints||[]).slice(-5).reverse().map(function(t){return'<div class="tp"><b>'+X(t.type)+'</b> — '+tA(t.at)+(t.detail?' · '+X(t.detail):'')+'</div>'}).join('');
    v.innerHTML='<div class="rw"><div style="flex:1"><div class="bs">'+sb+'</div><div class="nm"></div><div class="mt"></div></div><div class="pl">'+(c.score||'—')+'</div></div>'+(ci?'<div class="en">'+ci+'</div>':'')+(tp?'<div style="margin-top:8px"><label>History</label>'+tp+'</div>':'');
    v.querySelector('.nm').textContent=c.name||'Unknown';v.querySelector('.mt').textContent='RA #'+(c.license||'?')+' · '+(c.projectAddress||'');
    a.appendChild(v)})
}
function X(s){var d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
function tA(d){if(!d)return'?';var s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<60)return'now';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d'}
function gF(d){return{email:d.querySelector('.fe').value.trim(),subject:d.querySelector('.fs2').value.trim(),body:d.querySelector('.fb').value.trim()}}
async function doV(id,v){var f=gF(v);try{await fetch(A+'/drafts/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientEmail:f.email,subject:f.subject,body:f.body})});toast('Saved','ok')}catch(e){toast(e.message,'err')}}
async function doA(id,v){var f=gF(v);if(!f.email||!f.email.includes('@')){toast('Add email first','err');return}await fetch(A+'/drafts/'+id+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientEmail:f.email,subject:f.subject,body:f.body})});try{var r=await(await fetch(A+'/drafts/'+id+'/approve',{method:'POST'})).json();if(r.success){toast('Sent!','ok');v.style.opacity='.2';setTimeout(ld,600)}else toast(r.error||'Failed','err')}catch(e){toast(e.message,'err')}}
async function doK(id){try{await fetch(A+'/drafts/'+id+'/skip',{method:'POST'});toast('Skipped','');ld()}catch(e){toast(e.message,'err')}}
async function doSt(id,s,dv,n,or,qs){try{var b={pipelineStatus:s};if(dv)b.dealValue=dv;if(n)b.notes=n;if(or)b.outcomeReason=or;if(qs)b.quoteScope=qs;await fetch(A+'/drafts/'+id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});toast('→ '+s.replace(/_/g,' '),'ok');ld()}catch(e){toast(e.message,'err')}}

// Pre-drafted reply template for "already have a glass sub"
function getCompetitiveBidReply(name){
  var fn=(name||'').split(' ')[0];
  return 'Hi '+fn+',\\n\\nTotally understand. If it is ever useful to have a second option or competitive bid on a future project, we would be happy to provide one. We offer free 3D visualization renders to help clients decide on glass configurations. Might be a good complement to what you already have.\\n\\nEither way, keeping your info on file. Good luck with the project.\\n\\nBest,\\nDonald';
}
async function doBatch(){var n=D.filter(function(d){return d.status==='pending'&&d.recipientEmail&&d.recipientEmail.includes('@')}).length;if(!confirm('Send '+n+' emails?'))return;toast('Sending...','');try{var r=await(await fetch(A+'/batch-send',{method:'POST'})).json();toast(r.sent+' sent'+(r.failed?' ('+r.failed+' failed)':''),'ok');ld()}catch(e){toast(e.message,'err')}}
async function doScan(){document.getElementById('app').innerHTML='<div class="ld">Scanning...</div>';try{var r=await(await fetch(A+'/scan')).json();toast(r.picks+' picks from '+r.scanned+' filings','ok');ld()}catch(e){toast('Failed','err')}}
async function doReplies(){toast('Checking...','');try{var r=await(await fetch(A+'/check-replies',{method:'POST'})).json();toast(r.replies+' replies ('+r.checked+' checked)','ok');if(r.replies>0)ld()}catch(e){toast(e.message,'err')}}
async function doFU(){try{var r=await(await fetch(A+'/generate-followups',{method:'POST'})).json();toast(r.generated+' follow-ups','ok');if(r.generated>0)ld()}catch(e){toast(e.message,'err')}}
ld();
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
