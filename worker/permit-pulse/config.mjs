export const NYC_TIME_ZONE = 'America/New_York';
export const NYC_BUSINESS_HOURS = {
  startHour: 9,
  endHour: 17,
};

export const API_ENDPOINTS = {
  permits: 'https://data.cityofnewyork.us/resource/rbx6-tga4.json',
  pluto: 'https://data.cityofnewyork.us/resource/64uk-42ks.json',
  hpdViolations: 'https://data.cityofnewyork.us/resource/csn4-vhvf.json',
  braveSearch: 'https://api.search.brave.com/res/v1/web/search',
  firecrawlScrape: 'https://api.firecrawl.dev/v1/scrape',
  googleGeocode: 'https://maps.googleapis.com/maps/api/geocode/json',
  googlePlacesTextSearch: 'https://maps.googleapis.com/maps/api/place/textsearch/json',
  googlePlaceDetails: 'https://maps.googleapis.com/maps/api/place/details/json',
  zerobounceValidate: 'https://api.zerobounce.net/v2/validate',
};

export const METROGLASS_PROFILE = {
  primaryBoroughs: ['MANHATTAN'],
  secondaryBoroughs: ['BROOKLYN', 'QUEENS'],
  workTypes: ['General Construction'],
  minCost: 25000,
  sweetSpotMin: 50000,
  sweetSpotMax: 2000000,
  directKeywords: [
    'glass',
    'mirror',
    'glazing',
    'storefront',
    'shower door',
    'shower enclosure',
    'glass partition',
    'glass railing',
    'curtain wall',
    'glass door',
    'glass panel',
    'frameless',
    'tempered glass',
    'glass divider',
    'glass wall',
    'window replacement',
    'new storefront',
    'pivot door',
    'sliding glass',
  ],
  inferredKeywords: [
    'bathroom renovation',
    'bathroom remodel',
    'gut renovation',
    'full renovation',
    'master bathroom',
    'interior renovation',
    'interior alteration',
    'buildout',
    'build-out',
    'fit-out',
    'fitout',
    'tenant improvement',
    'new finishes',
    'luxury renovation',
    'condo renovation',
    'apartment renovation',
    'brownstone renovation',
    'retail renovation',
    'office renovation',
  ],
  commercialKeywords: [
    'storefront',
    'retail',
    'showroom',
    'office',
    'lobby',
    'partition',
    'restaurant',
    'hotel',
    'medical office',
    'dental office',
    'clinic',
    'gallery',
    'gym',
    'fitness',
    'salon',
  ],
  linkedinSignals: ['architect', 'design', 'interior', 'studio', 'atelier', 'hospitality', 'showroom'],
  negativeKeywords: [
    'demolition only',
    'asbestos',
    'abatement',
    'sidewalk shed',
    'scaffolding only',
    'boiler replacement',
    'elevator',
    'fire escape',
    'gas line',
    'roofing only',
    'waterproofing only',
    'pointing only',
  ],
};

export const PLUGIN_LINES = [
  'We keep field coordination simple, which helps jobs move without extra back and forth.',
  'Our team can quote quickly if the glass package is still being lined up.',
  'We handle shower glass, mirrors, storefronts, and partitions in house across the city.',
  'If drawings are available, we can turn around a practical number fast.',
  'We are used to working with tight Manhattan access, board rules, and active jobsites.',
  'If this scope is still open, we can help keep it clean on the install side.',
  'We work well with GCs, designers, and ownership teams that need fast answers.',
  'If the project needs custom glass or mirrors, we can step in without a heavy handoff.',
  'We are set up for both residential renovation work and higher touch commercial buildouts.',
  'We focus on clear pricing, clean installs, and straightforward coordination.',
];

export const MIN_RELEVANCE_THRESHOLD = 0.2;

export const PERMIT_RELEVANCE_RULES = [
  { keyword: 'bathroom renovation', score: 1.0, angle: 'shower enclosures and mirrors' },
  { keyword: 'bathroom alteration', score: 1.0, angle: 'shower enclosures and mirrors' },
  { keyword: 'shower', score: 1.0, angle: 'shower enclosures' },
  { keyword: 'glass partition', score: 1.0, angle: 'glass partitions' },
  { keyword: 'glass door', score: 1.0, angle: 'glass doors and partitions' },
  { keyword: 'glass railing', score: 0.9, angle: 'glass railings' },
  { keyword: 'storefront', score: 0.9, angle: 'storefront and entry glass' },
  { keyword: 'commercial fit-out', score: 0.85, angle: 'commercial glass partitions and mirrors' },
  { keyword: 'commercial fit out', score: 0.85, angle: 'commercial glass partitions and mirrors' },
  { keyword: 'retail renovation', score: 0.85, angle: 'storefront and retail glazing' },
  { keyword: 'office renovation', score: 0.8, angle: 'office partitions and interior glass' },
  { keyword: 'hotel renovation', score: 0.8, angle: 'mirror walls and interior glazing' },
  { keyword: 'restaurant renovation', score: 0.8, angle: 'storefront and partition glazing' },
  { keyword: 'mirror', score: 0.95, angle: 'custom mirrors' },
  { keyword: 'kitchen renovation', score: 0.7, angle: 'backsplash mirrors or glass accents' },
  { keyword: 'general renovation', score: 0.6, angle: 'custom glass scope' },
  { keyword: 'interior alteration', score: 0.6, angle: 'custom glass scope' },
  { keyword: 'apartment renovation', score: 0.6, angle: 'shower glass or mirrors' },
  { keyword: 'condo renovation', score: 0.6, angle: 'shower glass or mirrors' },
  { keyword: 'full gut renovation', score: 0.5, angle: 'custom glass scope' },
  { keyword: 'commercial alteration', score: 0.5, angle: 'commercial glazing scope' },
  { keyword: 'lobby renovation', score: 0.5, angle: 'lobby mirrors or feature glass' },
  { keyword: 'fitness center', score: 0.4, angle: 'mirror walls or partitions' },
  { keyword: 'spa', score: 0.4, angle: 'shower glass or mirrors' },
  { keyword: 'structural alteration', score: 0.2, angle: 'custom glass scope' },
  { keyword: 'electrical', score: 0.1, angle: 'custom glass scope' },
  { keyword: 'plumbing', score: 0.15, angle: 'custom glass scope' },
  { keyword: 'hvac', score: 0.05, angle: 'custom glass scope' },
  { keyword: 'roofing', score: 0.05, angle: 'custom glass scope' },
  { keyword: 'facade', score: 0.1, angle: 'custom glass scope' },
  { keyword: 'sidewalk shed', score: 0.0, angle: 'custom glass scope' },
  { keyword: 'scaffold', score: 0.0, angle: 'custom glass scope' },
  { keyword: 'demolition', score: 0.05, angle: 'custom glass scope' },
  { keyword: 'fire alarm', score: 0.0, angle: 'custom glass scope' },
  { keyword: 'sprinkler', score: 0.0, angle: 'custom glass scope' },
  { keyword: 'boiler', score: 0.0, angle: 'custom glass scope' },
  { keyword: 'elevator', score: 0.0, angle: 'custom glass scope' },
  { keyword: 'sign', score: 0.1, angle: 'storefront glazing' },
  { keyword: 'antenna', score: 0.0, angle: 'custom glass scope' },
  { keyword: 'solar panel', score: 0.0, angle: 'custom glass scope' },
];

export const AUTO_SEND_RAMP = {
  startsAt: '2026-03-23T00:00:00-04:00',
  startingPerDay: 10,
  weeklyMultiplier: 2,
  maxPerDay: 160,
  minimumPerHour: 2,
};

export function getAutoSendLimits(now = new Date()) {
  const rampStart = new Date(AUTO_SEND_RAMP.startsAt);
  const elapsedMs = Math.max(0, now.getTime() - rampStart.getTime());
  const weeksSinceStart = Math.floor(elapsedMs / (7 * 24 * 60 * 60 * 1000));
  const perDay = Math.min(
    AUTO_SEND_RAMP.maxPerDay,
    AUTO_SEND_RAMP.startingPerDay * (AUTO_SEND_RAMP.weeklyMultiplier ** weeksSinceStart),
  );
  const perHour = Math.max(
    AUTO_SEND_RAMP.minimumPerHour,
    Math.ceil(perDay / 8),
  );

  return {
    weekIndex: weeksSinceStart,
    perDay,
    perHour,
    startsAt: AUTO_SEND_RAMP.startsAt,
  };
}

export const DEFAULT_SCAN_WINDOW_DAYS = 14;
export const DEFAULT_SCAN_LIMIT = 150;
export const HIGH_VALUE_SCORE = 60;
