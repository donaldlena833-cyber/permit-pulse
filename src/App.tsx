import { useState, useEffect, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Permit {
  job_filing_number: string
  work_permit?: string
  filing_reason: string
  house_no: string
  street_name: string
  borough: string
  lot: string
  bin: string
  block: string
  c_b_no: string
  work_on_floor?: string
  work_type: string
  applicant_license?: string
  applicant_first_name?: string
  applicant_middle_name?: string
  applicant_last_name?: string
  applicant_business_name?: string
  applicant_business_address?: string
  filing_representative_first_name?: string
  filing_representative_last_name?: string
  filing_representative_business_name?: string
  approved_date?: string
  issued_date?: string
  expired_date?: string
  job_description: string
  estimated_job_costs: string
  owner_business_name?: string
  owner_name?: string
  permit_status: string
  tracking_number?: string
  zip_code?: string
  latitude?: string
  longitude?: string
  community_board?: string
  council_district?: string
  bbl?: string
  census_tract?: string
  nta?: string
  // computed
  score?: number
  scoreBreakdown?: ScoreBreakdown
  leadTier?: 'hot' | 'warm' | 'cold'
  actionSuggestion?: string
}

interface ScoreBreakdown {
  directKeyword: number
  inferredNeed: number
  costSignal: number
  commercialSignal: number
  buildingTypeSignal: number
  recencyBonus: number
  locationBonus: number
  total: number
  reasons: string[]
}

interface TenantProfile {
  id: string
  name: string
  business: string
  website: string
  color: string
  icon: string
  // Scoring config derived from website/service analysis
  directKeywords: string[]       // Terms that DIRECTLY mean they need this trade
  inferredKeywords: string[]     // Terms that IMPLY they likely need this trade
  commercialSignals: string[]    // Business types that are good clients
  buildingSignals: string[]      // Building types that are sweet spots
  excludeKeywords: string[]      // False positives to filter out
  workTypes: string[]
  minCostThreshold: number
  sweetSpotCostMin: number
  sweetSpotCostMax: number
  primaryBoroughs: string[]      // Priority boroughs
  secondaryBoroughs: string[]    // Will serve but not priority
  primaryNeighborhoods: string[] // Known good neighborhoods
  active: boolean
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// METROGLASSPRO PROFILE — auto-built from website analysis
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const METROGLASSPRO_PROFILE: TenantProfile = {
  id: 'metroglasspro',
  name: 'Glass & Mirrors',
  business: 'MetroGlassPro LLC',
  website: 'metroglasspro.com',
  color: '#D4691A',
  icon: '🪟',

  // Direct keyword matches — description explicitly mentions glass work
  directKeywords: [
    'glass', 'mirror', 'glazing', 'storefront', 'shower door', 'shower enclosure',
    'glass partition', 'glass railing', 'curtain wall', 'glass door', 'glass panel',
    'frameless', 'tempered glass', 'glass shelf', 'glass shelving', 'glass backsplash',
    'window replacement', 'new windows', 'replace window', 'new storefront',
    'replace storefront', 'glass wall', 'sliding glass', 'pivot door',
    'glass balcony', 'glass stair', 'glass divider',
  ],

  // Inferred keywords — renovation types that almost always need glass/mirror work
  inferredKeywords: [
    'bathroom renovation', 'bathroom remodel', 'gut renovation', 'full renovation',
    'master bathroom', 'master bath', 'en-suite', 'ensuite',
    'interior renovation', 'interior alteration', 'interior demo',
    'buildout', 'build-out', 'fit-out', 'fitout', 'tenant improvement',
    'new finishes', 'new fixtures', 'remove and replace', 'complete renovation',
    'luxury renovation', 'high-end renovation', 'condo renovation',
    'apartment renovation', 'residential renovation', 'kitchen and bath',
    'penthouse', 'duplex renovation', 'brownstone renovation',
    'convert', 'conversion', 'new space',
  ],

  // Commercial establishments that typically need custom glass
  commercialSignals: [
    'restaurant', 'hotel', 'boutique hotel', 'gym', 'fitness', 'pilates',
    'yoga studio', 'spa', 'salon', 'hair salon', 'barbershop', 'medical office',
    'dental office', 'clinic', 'retail', 'boutique', 'gallery', 'showroom',
    'office buildout', 'office renovation', 'co-working', 'coworking',
    'bar', 'lounge', 'nightclub', 'cafe', 'bakery', 'juice bar',
    'studio', 'design studio', 'photography studio',
  ],

  // Building types that are MetroGlassPro sweet spots
  buildingSignals: [
    'high-rise', 'high rise', 'condo', 'co-op', 'coop', 'cooperative',
    'luxury', 'penthouse', 'brownstone', 'townhouse', 'loft',
    'pre-war', 'prewar', 'doorman building', 'multi-family',
    'new development', 'new construction',
  ],

  // False positives — descriptions with these terms rarely need MetroGlassPro
  excludeKeywords: [
    'demolition only', 'full demolition', 'asbestos', 'abatement',
    'sidewalk shed', 'construction fence', 'scaffolding only',
    'boiler replacement', 'elevator', 'fire escape', 'gas line',
    'roofing only', 'waterproofing only', 'pointing only',
  ],

  workTypes: ['General Construction'],
  minCostThreshold: 25000,
  sweetSpotCostMin: 50000,
  sweetSpotCostMax: 2000000,

  // Manhattan first, then Brooklyn/Queens — matches website positioning
  primaryBoroughs: ['MANHATTAN'],
  secondaryBoroughs: ['BROOKLYN', 'QUEENS'],

  // Known strong neighborhoods from service areas page
  primaryNeighborhoods: [
    'Upper East Side', 'Upper West Side', 'Midtown', 'Chelsea',
    'Greenwich Village', 'SoHo', 'Tribeca', 'Financial District',
    'Gramercy', 'Murray Hill', 'East Village', 'Lower East Side',
    'Hell\'s Kitchen', 'Harlem',
    'Park Slope', 'Williamsburg', 'DUMBO', 'Brooklyn Heights',
    'Cobble Hill', 'Carroll Gardens', 'Greenpoint', 'Prospect Heights',
    'Fort Greene', 'Bed-Stuy',
    'Astoria', 'Long Island City', 'Flushing', 'Forest Hills',
  ],

  active: true,
}

const PLACEHOLDER_TRADES: TenantProfile[] = [
  {
    id: 'tile',
    name: 'Tile & Stone',
    business: '',
    website: '',
    color: '#8B6F47',
    icon: '🧱',
    directKeywords: ['tile', 'tiling', 'marble', 'stone', 'ceramic', 'porcelain', 'terrazzo', 'mosaic', 'travertine', 'slate', 'granite countertop'],
    inferredKeywords: ['bathroom renovation', 'kitchen renovation', 'floor', 'flooring', 'backsplash', 'shower', 'wet room'],
    commercialSignals: ['restaurant', 'hotel', 'spa', 'lobby', 'retail'],
    buildingSignals: ['luxury', 'high-rise', 'condo', 'brownstone'],
    excludeKeywords: ['demolition only', 'asbestos', 'scaffolding only'],
    workTypes: ['General Construction'],
    minCostThreshold: 20000,
    sweetSpotCostMin: 40000,
    sweetSpotCostMax: 1500000,
    primaryBoroughs: ['MANHATTAN', 'BROOKLYN'],
    secondaryBoroughs: ['QUEENS', 'BRONX'],
    primaryNeighborhoods: [],
    active: false,
  },
  {
    id: 'hvac',
    name: 'HVAC',
    business: '',
    website: '',
    color: '#2E6B8A',
    icon: '❄️',
    directKeywords: ['hvac', 'air conditioning', 'heating', 'ventilation', 'ductwork', 'mechanical system', 'cooling system', 'furnace', 'heat pump', 'mini split', 'mini-split', 'condenser', 'air handler', 'vrf', 'vrv'],
    inferredKeywords: ['mechanical', 'new system', 'replace system'],
    commercialSignals: ['restaurant', 'office', 'retail', 'hotel', 'server room', 'data center', 'gym', 'medical'],
    buildingSignals: ['commercial', 'high-rise', 'new construction'],
    excludeKeywords: ['demolition only', 'asbestos', 'scaffolding only'],
    workTypes: ['Mechanical Systems', 'General Construction'],
    minCostThreshold: 15000,
    sweetSpotCostMin: 30000,
    sweetSpotCostMax: 5000000,
    primaryBoroughs: ['MANHATTAN', 'BROOKLYN', 'QUEENS'],
    secondaryBoroughs: ['BRONX', 'STATEN ISLAND'],
    primaryNeighborhoods: [],
    active: false,
  },
  {
    id: 'plumbing',
    name: 'Plumbing',
    business: '',
    website: '',
    color: '#3A7D44',
    icon: '🔧',
    directKeywords: ['plumbing', 'pipe', 'plumbing fixture', 'drain', 'sewer', 'water line', 'water main', 'backflow', 'water heater', 'boiler', 'gas line', 'sprinkler'],
    inferredKeywords: ['bathroom', 'kitchen', 'wet room', 'laundry'],
    commercialSignals: ['restaurant', 'hotel', 'hospital', 'medical', 'kitchen', 'laundromat'],
    buildingSignals: ['multi-family', 'new construction', 'high-rise'],
    excludeKeywords: ['demolition only', 'asbestos', 'scaffolding only'],
    workTypes: ['Plumbing', 'General Construction'],
    minCostThreshold: 10000,
    sweetSpotCostMin: 25000,
    sweetSpotCostMax: 3000000,
    primaryBoroughs: ['MANHATTAN', 'BROOKLYN', 'QUEENS'],
    secondaryBoroughs: ['BRONX', 'STATEN ISLAND'],
    primaryNeighborhoods: [],
    active: false,
  },
]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCORING ENGINE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BOROUGHS = ['MANHATTAN', 'BROOKLYN', 'QUEENS', 'BRONX', 'STATEN ISLAND']
const API_BASE = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json'

function scorePermitForTenant(permit: Permit, tenant: TenantProfile): ScoreBreakdown {
  const desc = (permit.job_description || '').toLowerCase()
  const reasons: string[] = []
  let directKeyword = 0, inferredNeed = 0, costSignal = 0
  let commercialSignal = 0, buildingTypeSignal = 0, recencyBonus = 0, locationBonus = 0

  // Check excludes first
  for (const ex of tenant.excludeKeywords) {
    if (desc.includes(ex.toLowerCase())) {
      return { directKeyword: 0, inferredNeed: 0, costSignal: 0, commercialSignal: 0, buildingTypeSignal: 0, recencyBonus: 0, locationBonus: 0, total: 0, reasons: ['Excluded: ' + ex] }
    }
  }

  // 1. Direct keywords (max 40 pts)
  const directHits: string[] = []
  for (const kw of tenant.directKeywords) {
    if (desc.includes(kw.toLowerCase())) directHits.push(kw)
  }
  if (directHits.length >= 3) { directKeyword = 40; reasons.push(`Direct: ${directHits.slice(0,3).join(', ')}`) }
  else if (directHits.length === 2) { directKeyword = 32; reasons.push(`Direct: ${directHits.join(', ')}`) }
  else if (directHits.length === 1) { directKeyword = 22; reasons.push(`Direct: ${directHits[0]}`) }

  // 2. Inferred need (max 20 pts)
  const inferredHits: string[] = []
  for (const kw of tenant.inferredKeywords) {
    if (desc.includes(kw.toLowerCase())) inferredHits.push(kw)
  }
  if (inferredHits.length >= 2) { inferredNeed = 20; reasons.push(`Likely needs work: ${inferredHits.slice(0,2).join(', ')}`) }
  else if (inferredHits.length === 1) { inferredNeed = 12; reasons.push(`May need work: ${inferredHits[0]}`) }

  // 3. Cost signal (max 15 pts)
  const cost = parseInt(permit.estimated_job_costs) || 0
  if (cost >= tenant.sweetSpotCostMin && cost <= tenant.sweetSpotCostMax) {
    costSignal = 15; reasons.push(`Sweet spot budget: ${fmt$(cost)}`)
  } else if (cost >= tenant.sweetSpotCostMax) {
    costSignal = 10; reasons.push(`Large project: ${fmt$(cost)}`)
  } else if (cost >= tenant.minCostThreshold) {
    costSignal = 5
  }

  // 4. Commercial signals (max 10 pts)
  for (const sig of tenant.commercialSignals) {
    if (desc.includes(sig.toLowerCase())) {
      commercialSignal = 10; reasons.push(`Commercial: ${sig}`); break
    }
  }

  // 5. Building type (max 8 pts)
  for (const sig of tenant.buildingSignals) {
    if (desc.includes(sig.toLowerCase())) {
      buildingTypeSignal = 8; reasons.push(`Building: ${sig}`); break
    }
  }

  // 6. Recency (max 10 pts)
  if (permit.issued_date) {
    const days = Math.floor((Date.now() - new Date(permit.issued_date).getTime()) / 86400000)
    if (days <= 3) { recencyBonus = 10; reasons.push('Issued within 3 days') }
    else if (days <= 7) { recencyBonus = 7; reasons.push('Issued this week') }
    else if (days <= 14) { recencyBonus = 4 }
  }

  // 7. Location (max 7 pts)
  if (tenant.primaryBoroughs.includes(permit.borough)) {
    locationBonus += 4
    // Check neighborhood match
    const nta = (permit.nta || '').toLowerCase()
    if (tenant.primaryNeighborhoods.some(n => nta.includes(n.toLowerCase()))) {
      locationBonus += 3; reasons.push(`Target area: ${permit.nta}`)
    }
  } else if (tenant.secondaryBoroughs.includes(permit.borough)) {
    locationBonus += 2
  }

  const total = Math.min(directKeyword + inferredNeed + costSignal + commercialSignal + buildingTypeSignal + recencyBonus + locationBonus, 100)

  return { directKeyword, inferredNeed, costSignal, commercialSignal, buildingTypeSignal, recencyBonus, locationBonus, total, reasons }
}

function getLeadTier(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 45) return 'hot'
  if (score >= 25) return 'warm'
  return 'cold'
}

function getActionSuggestion(permit: Permit, breakdown: ScoreBreakdown, tier: string): string {
  if (tier === 'hot' && breakdown.directKeyword >= 22) {
    if (permit.applicant_business_name) return `Call GC "${permit.applicant_business_name}" — they likely need a glass sub for this job`
    return 'Contact the owner/GC directly — this project explicitly involves your trade'
  }
  if (tier === 'hot') {
    return `High-value renovation — reach out to GC "${permit.applicant_business_name || 'on file'}" to offer glass/mirror scope`
  }
  if (tier === 'warm' && breakdown.inferredNeed >= 12) {
    return `Renovation likely needs glass — worth a call to the GC to check their glass scope`
  }
  if (tier === 'warm') {
    return 'Monitor — could become a lead as the project develops'
  }
  return 'Low priority — keep on radar'
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function fmt$(val: string | number): string {
  const num = typeof val === 'string' ? parseInt(val) : val
  if (isNaN(num)) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
}

function fmtDate(d?: string): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function timeAgo(d?: string): string {
  if (!d) return ''
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff}d ago`
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`
  return `${Math.floor(diff / 30)}mo ago`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPONENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function PermitCard({ permit }: { permit: Permit }) {
  const [expanded, setExpanded] = useState(false)
  const cost = parseInt(permit.estimated_job_costs) || 0
  const tier = permit.leadTier || 'cold'
  const bd = permit.scoreBreakdown
  const boroughNum = permit.borough === 'MANHATTAN' ? '1' : permit.borough === 'BRONX' ? '2' : permit.borough === 'BROOKLYN' ? '3' : permit.borough === 'QUEENS' ? '4' : '5'

  return (
    <div className={`permit-card ${tier}`} onClick={() => setExpanded(!expanded)}>
      {/* Score bar */}
      <div className="pc-scorebar">
        <div className="pc-score-num">{permit.score}</div>
        <Progress value={permit.score} className={`pc-progress ${tier}`} />
        {tier === 'hot' && <span className="tier-badge hot">🔥 HOT</span>}
        {tier === 'warm' && <span className="tier-badge warm">WARM</span>}
      </div>

      <div className="pc-top">
        <div className="pc-addr">
          <span className="pc-house">{permit.house_no}</span>{' '}
          <span className="pc-street">{permit.street_name}</span>
          <div className="pc-meta">
            <span className="pc-boro">{permit.borough}</span>
            {permit.nta && <span className="pc-nta">{permit.nta}</span>}
            {permit.zip_code && <span className="pc-zip">{permit.zip_code}</span>}
          </div>
        </div>
        <div className="pc-nums">
          <div className="pc-cost">{fmt$(cost)}</div>
          <div className="pc-time">{timeAgo(permit.issued_date)}</div>
        </div>
      </div>

      <div className="pc-desc">{permit.job_description}</div>

      {/* Action suggestion */}
      {permit.actionSuggestion && tier !== 'cold' && (
        <div className={`pc-action-tip ${tier}`}>
          <span className="tip-icon">{tier === 'hot' ? '📞' : '👀'}</span>
          {permit.actionSuggestion}
        </div>
      )}

      {/* Score reasons */}
      {bd && bd.reasons.length > 0 && (
        <div className="pc-reasons">
          {bd.reasons.map((r, i) => <span key={i} className="reason-tag">{r}</span>)}
        </div>
      )}

      {expanded && (
        <div className="pc-expand">
          <Separator className="my-3" />

          {/* Score breakdown */}
          {bd && (
            <div className="score-breakdown">
              <div className="sb-title">Score Breakdown</div>
              <div className="sb-grid">
                {bd.directKeyword > 0 && <div className="sb-item"><span className="sb-pts">+{bd.directKeyword}</span> Direct keyword match</div>}
                {bd.inferredNeed > 0 && <div className="sb-item"><span className="sb-pts">+{bd.inferredNeed}</span> Inferred need</div>}
                {bd.costSignal > 0 && <div className="sb-item"><span className="sb-pts">+{bd.costSignal}</span> Budget fit</div>}
                {bd.commercialSignal > 0 && <div className="sb-item"><span className="sb-pts">+{bd.commercialSignal}</span> Commercial client</div>}
                {bd.buildingTypeSignal > 0 && <div className="sb-item"><span className="sb-pts">+{bd.buildingTypeSignal}</span> Building type</div>}
                {bd.recencyBonus > 0 && <div className="sb-item"><span className="sb-pts">+{bd.recencyBonus}</span> Recently issued</div>}
                {bd.locationBonus > 0 && <div className="sb-item"><span className="sb-pts">+{bd.locationBonus}</span> Target location</div>}
              </div>
            </div>
          )}

          <div className="pc-grid">
            <div className="pc-detail"><span className="dl">Owner</span><span className="dv">{permit.owner_name || '—'}</span></div>
            <div className="pc-detail"><span className="dl">Owner Biz</span><span className="dv">{permit.owner_business_name || '—'}</span></div>
            <div className="pc-detail"><span className="dl">GC / Applicant</span><span className="dv">{permit.applicant_business_name || `${permit.applicant_first_name || ''} ${permit.applicant_last_name || ''}`}</span></div>
            <div className="pc-detail"><span className="dl">GC License #</span><span className="dv mono">{permit.applicant_license || '—'}</span></div>
            <div className="pc-detail"><span className="dl">Filing Rep</span><span className="dv">{permit.filing_representative_business_name || `${permit.filing_representative_first_name || ''} ${permit.filing_representative_last_name || ''}`}</span></div>
            <div className="pc-detail"><span className="dl">Job Filing #</span><span className="dv mono">{permit.job_filing_number}</span></div>
            <div className="pc-detail"><span className="dl">Approved</span><span className="dv">{fmtDate(permit.approved_date)}</span></div>
            <div className="pc-detail"><span className="dl">Issued</span><span className="dv">{fmtDate(permit.issued_date)}</span></div>
            <div className="pc-detail"><span className="dl">Expires</span><span className="dv">{fmtDate(permit.expired_date)}</span></div>
            <div className="pc-detail"><span className="dl">Floor(s)</span><span className="dv">{permit.work_on_floor || '—'}</span></div>
            <div className="pc-detail"><span className="dl">BIN</span><span className="dv mono">{permit.bin}</span></div>
            <div className="pc-detail"><span className="dl">Block / Lot</span><span className="dv mono">{permit.block} / {permit.lot}</span></div>
          </div>

          <div className="pc-actions">
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); window.open(`https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${boroughNum}&block=${permit.block}&lot=${permit.lot}`, '_blank') }}>🔗 DOB BIS</Button>
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/search/${encodeURIComponent(permit.house_no + ' ' + permit.street_name + ', ' + permit.borough + ', NY ' + (permit.zip_code || ''))}`, '_blank') }}>📍 Maps</Button>
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent((permit.applicant_business_name || `${permit.applicant_first_name} ${permit.applicant_last_name}`) + ' NYC contractor phone')}`, '_blank') }}>🔍 Find GC</Button>
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/search?q=${encodeURIComponent((permit.owner_business_name || permit.owner_name || '') + ' NYC')}`, '_blank') }}>🏢 Find Owner</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatsBar({ permits }: { permits: Permit[] }) {
  const totalCost = permits.reduce((s, p) => s + (parseInt(p.estimated_job_costs) || 0), 0)
  const hot = permits.filter(p => p.leadTier === 'hot').length
  const warm = permits.filter(p => p.leadTier === 'warm').length
  const avgScore = permits.length > 0 ? Math.round(permits.reduce((s, p) => s + (p.score || 0), 0) / permits.length) : 0

  return (
    <div className="stats">
      <div className="stat"><div className="sv">{permits.length}</div><div className="sl">Permits Scanned</div></div>
      <div className="stat"><div className="sv">{fmt$(totalCost)}</div><div className="sl">Total Pipeline</div></div>
      <div className="stat hot"><div className="sv">{hot}</div><div className="sl">🔥 Hot Leads</div></div>
      <div className="stat warm"><div className="sv">{warm}</div><div className="sl">Warm Leads</div></div>
      <div className="stat"><div className="sv">{avgScore}</div><div className="sl">Avg Score</div></div>
    </div>
  )
}

function ProfileView({ tenant }: { tenant: TenantProfile }) {
  return (
    <div className="profile-view">
      <div className="pv-header">
        <span className="pv-icon">{tenant.icon}</span>
        <div>
          <h3 className="pv-name">{tenant.business || tenant.name}</h3>
          {tenant.website && <a href={`https://${tenant.website}`} target="_blank" className="pv-url">{tenant.website}</a>}
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-label">Service Profile</div>
        <p className="pv-desc">This profile was auto-generated from your website. It controls how permits are scored and which leads surface as hot or warm.</p>
      </div>

      <div className="pv-section">
        <div className="pv-label">Direct Keywords ({tenant.directKeywords.length})</div>
        <div className="pv-tags">{tenant.directKeywords.map((k,i) => <span key={i} className="pv-tag direct">{k}</span>)}</div>
      </div>

      <div className="pv-section">
        <div className="pv-label">Inferred Need Keywords ({tenant.inferredKeywords.length})</div>
        <div className="pv-tags">{tenant.inferredKeywords.map((k,i) => <span key={i} className="pv-tag inferred">{k}</span>)}</div>
      </div>

      <div className="pv-section">
        <div className="pv-label">Target Commercial Clients ({tenant.commercialSignals.length})</div>
        <div className="pv-tags">{tenant.commercialSignals.map((k,i) => <span key={i} className="pv-tag commercial">{k}</span>)}</div>
      </div>

      <div className="pv-section">
        <div className="pv-label">Primary Boroughs</div>
        <div className="pv-tags">
          {tenant.primaryBoroughs.map((b,i) => <Badge key={i} style={{ backgroundColor: tenant.color, color: '#fff' }}>{b}</Badge>)}
          {tenant.secondaryBoroughs.map((b,i) => <Badge key={i} variant="outline">{b}</Badge>)}
        </div>
      </div>

      <div className="pv-section">
        <div className="pv-label">Budget Sweet Spot</div>
        <div className="pv-value">{fmt$(tenant.sweetSpotCostMin)} — {fmt$(tenant.sweetSpotCostMax)}</div>
      </div>

      <div className="pv-section">
        <div className="pv-label">Scoring Logic</div>
        <div className="scoring-rules">
          <div className="sr"><span className="sr-pts">+40</span> Multiple direct keyword matches in permit description</div>
          <div className="sr"><span className="sr-pts">+22</span> Single direct keyword match</div>
          <div className="sr"><span className="sr-pts">+20</span> Inferred need (renovation type that typically requires this trade)</div>
          <div className="sr"><span className="sr-pts">+15</span> Budget in sweet spot range</div>
          <div className="sr"><span className="sr-pts">+10</span> Commercial establishment type</div>
          <div className="sr"><span className="sr-pts">+10</span> Issued within last 3 days</div>
          <div className="sr"><span className="sr-pts">+8</span> Target building type</div>
          <div className="sr"><span className="sr-pts">+7</span> Priority neighborhood</div>
          <div className="sr-divider" />
          <div className="sr"><span className="sr-pts hot">≥45</span> HOT LEAD — call the GC</div>
          <div className="sr"><span className="sr-pts warm">≥25</span> WARM — worth investigating</div>
          <div className="sr"><span className="sr-pts cold">&lt;25</span> COLD — monitor only</div>
        </div>
      </div>
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN APP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function App() {
  const [activeTenant] = useState<TenantProfile>(METROGLASSPRO_PROFILE)
  const [permits, setPermits] = useState<Permit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'score' | 'cost' | 'date'>('score')
  const [filterBorough, setFilterBorough] = useState<string>('ALL')
  const [filterTier, setFilterTier] = useState<string>('ALL')
  const [searchText, setSearchText] = useState('')
  const [daysBack, setDaysBack] = useState('14')
  const [minCost, setMinCost] = useState('25000')
  const [tab, setTab] = useState('leads')

  const fetchAndScore = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const days = parseInt(daysBack) || 14
      const minJobCost = parseInt(minCost) || 25000
      const dateFrom = new Date()
      dateFrom.setDate(dateFrom.getDate() - days)
      const dateStr = dateFrom.toISOString().split('T')[0] + 'T00:00:00'

      const allBoroughs = [...activeTenant.primaryBoroughs, ...activeTenant.secondaryBoroughs]
      const boroughFilter = allBoroughs.map(b => `borough='${b}'`).join(' OR ')
      const workTypeFilter = activeTenant.workTypes.map(w => `work_type='${w}'`).join(' OR ')

      const where = [
        `issued_date>'${dateStr}'`,
        `estimated_job_costs>'${minJobCost}'`,
        `permit_status='Permit Issued'`,
        `filing_reason='Initial Permit'`,
        `(${boroughFilter})`,
        `(${workTypeFilter})`,
      ].join(' AND ')

      const url = `${API_BASE}?$where=${encodeURIComponent(where)}&$order=issued_date DESC&$limit=500`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const data: Permit[] = await res.json()

      // Score every permit
      const scored = data.map(p => {
        const bd = scorePermitForTenant(p, activeTenant)
        const tier = getLeadTier(bd.total)
        const action = getActionSuggestion(p, bd, tier)
        return { ...p, score: bd.total, scoreBreakdown: bd, leadTier: tier, actionSuggestion: action } as Permit
      }).filter(p => (p.score || 0) > 0) // Only show permits that scored > 0

      setPermits(scored)
      setLastScan(new Date().toLocaleString())
    } catch (err: any) {
      setError(err.message || 'Failed to fetch permits')
    } finally {
      setLoading(false)
    }
  }, [activeTenant, daysBack, minCost])

  useEffect(() => { fetchAndScore() }, [])

  const filtered = useMemo(() => {
    return permits.filter(p => {
      if (filterBorough !== 'ALL' && p.borough !== filterBorough) return false
      if (filterTier === 'hot' && p.leadTier !== 'hot') return false
      if (filterTier === 'warm' && p.leadTier !== 'warm') return false
      if (filterTier === 'warmup' && p.leadTier === 'cold') return false
      if (searchText) {
        const q = searchText.toLowerCase()
        const h = `${p.job_description} ${p.owner_business_name} ${p.owner_name} ${p.applicant_business_name} ${p.street_name} ${p.nta}`.toLowerCase()
        if (!h.includes(q)) return false
      }
      return true
    }).sort((a, b) => {
      if (sortBy === 'score') return (b.score || 0) - (a.score || 0)
      if (sortBy === 'cost') return (parseInt(b.estimated_job_costs) || 0) - (parseInt(a.estimated_job_costs) || 0)
      return new Date(b.issued_date || 0).getTime() - new Date(a.issued_date || 0).getTime()
    })
  }, [permits, filterBorough, filterTier, searchText, sortBy])

  return (
    <TooltipProvider>
      <div className="app">
        <header className="hdr">
          <div className="hdr-left">
            <span className="logo-bolt">⚡</span>
            <div>
              <h1 className="logo-txt">PermitPulse</h1>
              <p className="logo-sub">NYC Construction Lead Intelligence</p>
            </div>
          </div>
          <div className="hdr-right">
            <Badge style={{ backgroundColor: activeTenant.color, color: '#fff' }}>{activeTenant.icon} {activeTenant.business}</Badge>
            {lastScan && <span className="last-scan">Last scan: {lastScan}</span>}
          </div>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="main-tabs">
          <TabsList className="tl">
            <TabsTrigger value="leads">🎯 Lead Scanner</TabsTrigger>
            <TabsTrigger value="profile">🏢 My Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="leads" className="tc">
            <div className="ctrls">
              <div className="ctrls-row">
                <div className="ctrl">
                  <Label className="ctrl-l">Time Range</Label>
                  <Select value={daysBack} onValueChange={setDaysBack}>
                    <SelectTrigger className="ctrl-s"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">Last 3 days</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="14">Last 14 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="60">Last 60 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="ctrl">
                  <Label className="ctrl-l">Min Cost</Label>
                  <Select value={minCost} onValueChange={setMinCost}>
                    <SelectTrigger className="ctrl-s"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10000">$10k+</SelectItem>
                      <SelectItem value="25000">$25k+</SelectItem>
                      <SelectItem value="50000">$50k+</SelectItem>
                      <SelectItem value="100000">$100k+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="ctrl">
                  <Label className="ctrl-l">Borough</Label>
                  <Select value={filterBorough} onValueChange={setFilterBorough}>
                    <SelectTrigger className="ctrl-s"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Boroughs</SelectItem>
                      {BOROUGHS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="ctrl">
                  <Label className="ctrl-l">Lead Tier</Label>
                  <Select value={filterTier} onValueChange={setFilterTier}>
                    <SelectTrigger className="ctrl-s"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Scored</SelectItem>
                      <SelectItem value="hot">🔥 Hot Only</SelectItem>
                      <SelectItem value="warm">Warm Only</SelectItem>
                      <SelectItem value="warmup">Warm + Hot</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="ctrl">
                  <Label className="ctrl-l">Sort</Label>
                  <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                    <SelectTrigger className="ctrl-s"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="score">Best Match</SelectItem>
                      <SelectItem value="cost">Highest Value</SelectItem>
                      <SelectItem value="date">Most Recent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="ctrl grow">
                  <Label className="ctrl-l">Search</Label>
                  <Input placeholder="GC name, owner, description..." value={searchText} onChange={e => setSearchText(e.target.value)} />
                </div>
                <Button onClick={fetchAndScore} disabled={loading} className="scan-btn">
                  {loading ? '⏳ Scanning...' : '⚡ Scan Now'}
                </Button>
              </div>
            </div>

            {!loading && permits.length > 0 && <StatsBar permits={filtered} />}

            <div className="results">
              {loading && [1,2,3,4].map(i => (
                <div key={i} className="skel"><Skeleton className="h-5 w-16 mb-2" /><Skeleton className="h-6 w-3/4 mb-2" /><Skeleton className="h-4 w-1/2 mb-3" /><Skeleton className="h-4 w-full mb-1" /><Skeleton className="h-4 w-2/3" /></div>
              ))}

              {!loading && filtered.length === 0 && !error && (
                <div className="empty"><div className="empty-ico">📋</div><h3>No Matching Leads</h3><p>Try widening your date range, lowering min cost, or checking your profile keywords.</p></div>
              )}

              {error && (
                <div className="empty"><div className="empty-ico">⚠️</div><h3>Scan Error</h3><p>{error}</p><Button onClick={fetchAndScore} variant="outline" className="mt-3">Retry</Button></div>
              )}

              {!loading && filtered.length > 0 && (
                <div className="permit-list">
                  <div className="result-ct">{filtered.length} leads found — {filtered.filter(p => p.leadTier === 'hot').length} hot, {filtered.filter(p => p.leadTier === 'warm').length} warm</div>
                  {filtered.map((p, i) => <PermitCard key={`${p.job_filing_number}-${i}`} permit={p} />)}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="profile" className="tc">
            <ProfileView tenant={activeTenant} />
          </TabsContent>
        </Tabs>

        <footer className="ftr">
          <span>Data: NYC Open Data (DOB NOW Approved Permits) — 907K+ records — Updated daily</span>
          <span>PermitPulse v1.0 — Built for MetroGlassPro</span>
        </footer>
      </div>
    </TooltipProvider>
  )
}
