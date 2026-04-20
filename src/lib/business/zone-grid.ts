/**
 * Multi-zone area scan via OpenStreetMap Overpass API.
 *
 * Given a city bounding box, generates a 3x3 grid of scan points, runs ONE
 * batched Overpass query for all amenities + named places in the bbox, then
 * aggregates per-zone scores and labels each zone with the nearest
 * neighborhood name.
 *
 * Cost: 1 free Overpass call, 0 paid Maps credits. Cached per city 7 days.
 */

// Public Overpass instances, fired in parallel. The .de mirrors and kumi
// have all been wedged (504 / hang) recently — keep them in the pool but
// list the OSM-FR + OSM-CH mirrors first since they're the only ones
// reliably answering during current outages.
const OVERPASS_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

// Amenity tags we keep querying for UI display (ring icons on area meter)
// + the ones that still feed the scoring as secondary signals.
const AMENITY_TAGS = [
  'bank',
  'atm',
  'hotel',
  'hospital',
  'pharmacy',
  'supermarket',
  'fuel',
  'car_rental',
  'gym',
  'spa',
  'cinema',
  'theatre',
  'casino',
  // Negative signals — poverty / distress indicators
  'pawnshop',
  'money_lender',
  'social_facility',
] as const;

// HIGH-signal wealth tags (shop=*) — luxury specialty retail. Strongest
// single wealth signal per the 2026 research brief.
const LUXURY_SHOP_TAGS = [
  'jewelry',
  'watches',
  'boutique',
  'art',
  'antiques',
  'wine',
  'gallery',
] as const;

// Negative-signal shop tags — poverty / distress-economy indicators.
const NEGATIVE_SHOP_TAGS = ['pawnbroker', 'charity', 'second_hand'] as const;

// HIGH-signal professional services. Financial + legal clustering sits
// in the highest-rent zones almost by definition.
const PROFESSIONAL_OFFICE_TAGS = [
  'financial',
  'financial_advisor',
  'lawyer',
  'accountant',
  'insurance',
  'notary',
  'tax_advisor',
] as const;

const ZONE_RADIUS_METERS = 1500;
const GRID_SIZE = 3; // 3x3
// 20km bbox keeps Overpass queries tractable in ultra-dense metros (London,
// NYC, Tokyo, Mumbai). Larger bbox + Overpass density = timeouts → single
// zone fallback. 20km still covers central London zones 1-3 worth of leads.
const MAX_BBOX_SIDE_KM = 20;
const SMALL_CITY_DIAGONAL_KM = 4; // below this, skip grid and return single zone
// Per-mirror timeouts. We hit all mirrors in parallel and take the first
// non-empty response. The server-side `[timeout:N]` is the budget Overpass
// gives the query before truncating; too-tight values cause silent empty
// 200s on dense bboxes (greater London hit this with a 7s cap). Keep the
// client cap loose enough that a real answer can come back.
const OVERPASS_SERVER_TIMEOUT_S = 20;
const OVERPASS_CLIENT_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Bump when the scoring formula or queried tag set changes. Old cached
// results remain in the store under the previous key and will expire
// naturally, but new callers get fresh data under the new version.
const CACHE_SCHEMA_VERSION = 'v6-wider-cap';

// Place-based scanning: use OSM named places (Mayfair, Canary Wharf, etc.)
// as zone centers instead of a 3×3 grid. If we find at least this many
// places in the bbox, scan at them. Below that, fall back to the grid so
// sparsely-tagged cities still get some coverage.
const PLACE_SCAN_MIN_PLACES = 4;
// Two places centroid-to-centroid closer than this get merged (keep the
// higher-scoring one) — the 1.5km scan radius would otherwise produce
// near-duplicate zones for adjacent OSM places.
const PLACE_DEDUPE_METERS = 700;
// Cap on returned zones from place-based scan. The chip route slices to 6
// anyway, but the results-view zone strip shows all of these — 25 gives
// headroom so a far-out-but-genuine wealth zone (Canary Wharf in London,
// Omotesando in Tokyo) doesn't get cut at the top-15 boundary.
const PLACE_MAX_ZONES = 25;
// Short TTL for soft-failed lookups (Overpass down). Prevents thrash on
// every autocomplete keystroke while still letting the user retry soon.
const FAILURE_CACHE_TTL_MS = 60 * 1000;

export type ZoneLevel = 'premium' | 'commercial' | 'moderate' | 'developing';

export interface ZoneAmenities {
  // Legacy buckets — kept for UI continuity (AreaDensityMeter rim icons,
  // describe-zone text, cached payloads from before v2-wealth).
  banks: number;
  hotels: number;
  hospitals: number;
  pharmacies: number;
  supermarkets: number;
  fuelStations: number;
  affluenceSpots: number;
  total: number;

  // v2-wealth buckets — the ones that actually drive scoring now.
  // Optional so pre-v2 cached payloads still typecheck after deserialization;
  // scoreCounts treats `undefined` as 0.
  /** shop=jewelry|watches|boutique|art|antiques|wine|gallery */
  luxuryRetail?: number;
  /** office=financial|lawyer|accountant|insurance|notary|... */
  professionalServices?: number;
  /** tourism=hotel with stars>=4 (subset of `hotels`) */
  premiumHotels?: number;
  /** amenity=casino (tracked separately from gym/spa bucket for weighting) */
  casinos?: number;
  /** Negative signals — poverty indicators that deduct from score */
  pawnshops?: number;
  moneyLenders?: number;
  socialFacilities?: number;
  charityShops?: number;
}

export interface Zone {
  id: string;
  label: string; // neighborhood name or directional fallback
  latitude: number;
  longitude: number;
  score: number; // 0-100
  level: ZoneLevel;
  amenities: ZoneAmenities;
  radiusMeters: number;
  /** Meters from city centroid (helps UI distinguish "downtown" vs periphery) */
  distanceFromCenterMeters: number;
}

export interface ZoneGridResult {
  zones: Zone[]; // sorted by score DESC
  centroid: { latitude: number; longitude: number };
  bbox: [number, number, number, number]; // [south, north, west, east] actually queried
  /** True when only a single zone was scanned (small city / missing bbox fallback) */
  singleZone: boolean;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

// ---------- in-memory cache ----------

interface CacheEntry {
  result: ZoneGridResult;
  expiresAt: number;
}
const zoneGridCache = new Map<string, CacheEntry>();

// Singleflight: when neighborhoods autocomplete and the search button both
// fire for the same city within a few seconds, the second caller awaits the
// in-flight promise instead of launching its own Overpass call.
const inFlight = new Map<string, Promise<ZoneGridResult>>();

function cacheKey(city: string, country: string): string {
  return `${CACHE_SCHEMA_VERSION}|${country.toLowerCase()}|${city.trim().toLowerCase()}`;
}

// ---------- geo helpers ----------

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine great-circle distance in meters. */
function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Clamp bbox so no side exceeds MAX_BBOX_SIDE_KM, centered on given point. */
function clampBbox(
  bbox: [number, number, number, number],
  centerLat: number,
  centerLon: number
): [number, number, number, number] {
  const [south, north, west, east] = bbox;
  const heightKm =
    haversineMeters(south, centerLon, north, centerLon) / 1000;
  const widthKm = haversineMeters(centerLat, west, centerLat, east) / 1000;

  const halfMaxLatDeg = MAX_BBOX_SIDE_KM / 2 / 111; // ~111 km per degree lat
  const halfMaxLonDeg =
    MAX_BBOX_SIDE_KM / 2 / (111 * Math.cos(toRadians(centerLat)) || 1);

  return [
    heightKm > MAX_BBOX_SIDE_KM ? centerLat - halfMaxLatDeg : south,
    heightKm > MAX_BBOX_SIDE_KM ? centerLat + halfMaxLatDeg : north,
    widthKm > MAX_BBOX_SIDE_KM ? centerLon - halfMaxLonDeg : west,
    widthKm > MAX_BBOX_SIDE_KM ? centerLon + halfMaxLonDeg : east,
  ];
}

/** Generate grid points at 20/50/80% across each axis (avoid the very edges). */
function generateGridPoints(
  bbox: [number, number, number, number]
): { lat: number; lon: number; row: number; col: number }[] {
  const [south, north, west, east] = bbox;
  const fractions =
    GRID_SIZE === 3 ? [0.2, 0.5, 0.8] : [0.25, 0.5, 0.75];
  const points: { lat: number; lon: number; row: number; col: number }[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const lat = south + (north - south) * fractions[row];
      const lon = west + (east - west) * fractions[col];
      points.push({ lat, lon, row, col });
    }
  }
  return points;
}

const DIRECTIONAL_LABELS: Record<string, string> = {
  '0,0': 'SW Quadrant',
  '0,1': 'South',
  '0,2': 'SE Quadrant',
  '1,0': 'West',
  '1,1': 'Central',
  '1,2': 'East',
  '2,0': 'NW Quadrant',
  '2,1': 'North',
  '2,2': 'NE Quadrant',
};

function directionalLabel(row: number, col: number): string {
  return DIRECTIONAL_LABELS[`${row},${col}`] ?? 'Zone';
}

// ---------- scoring ----------

/**
 * Log-cap a raw count. log10(n+1) * 3 gives a soft ramp that rewards
 * density without letting a single mega-cluster dominate:
 *   n=1   → 0.90
 *   n=5   → 2.33
 *   n=10  → 3.13
 *   n=25  → 4.24
 *   n=50  → 5.11
 *   n=100 → 6.03
 *   n=500 → 8.07 (hits default cap)
 *
 * Default cap of 8 is deliberately loose — mid-tier zones need room to
 * separate from Central London / Times Square / Ginza extremes. Tight
 * caps (3-5) earlier produced the "everything scores 100" bug because
 * every dense zone saturated every signal.
 */
function logCap(count: number | undefined, cap = 8): number {
  if (!count || count <= 0) return 0;
  return Math.min(cap, Math.log10(count + 1) * 3);
}

/**
 * v4-spread scoring — derived from 2026 global research brief (see
 * Downloads/LEAD_SNATCHER_AREA_SCORING_RESEARCH.md) and tuned against
 * real London chip output to produce meaningful 0-100 spread.
 *
 * Weights are calibrated so a world-class premium zone (City of London,
 * Ginza) hits ~90-100, a premium-but-not-apex zone (Mayfair, Soho)
 * lands ~70-85, mid-commercial zones ~40-60, and suburban/developing
 * zones ~15-35. Rural/poverty zones clamp at 0.
 *
 * Hospitals, pharmacies, supermarkets, fuel — zero weight. They anchor
 * low-income zones as often as wealthy ones and inverted the score in
 * emerging markets under earlier weights. (Research Part 1.)
 */
function scoreCounts(counts: ZoneAmenities): number {
  const luxury = logCap(counts.luxuryRetail);
  const prof = logCap(counts.professionalServices);
  const premiumHotel = logCap(counts.premiumHotels);
  const casino = logCap(counts.casinos);
  const banks = logCap(counts.banks);
  const affluence = logCap(counts.affluenceSpots);
  const genericHotel = logCap(counts.hotels);

  // Negative-signal caps kept tighter — we want a handful of pawnshops
  // to ding the score decisively, not slowly ramp up.
  const pawnshops = logCap(counts.pawnshops, 3);
  const moneyLenders = logCap(counts.moneyLenders, 3);
  const socialFacilities = logCap(counts.socialFacilities, 3);
  const charityShops = logCap(counts.charityShops, 3);

  const raw =
    // HIGH signals — strong wealth indicators
    5 * luxury +
    4 * prof +
    3 * premiumHotel +
    // MED signals — weaker correlation, still positive
    2 * banks +
    1.5 * casino +
    2 * affluence +
    1.5 * genericHotel +
    // Negative signals — poverty / distress indicators
    -6 * pawnshops +
    -4 * moneyLenders +
    -4 * socialFacilities +
    -2 * charityShops;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

function levelForScore(score: number): ZoneLevel {
  if (score >= 75) return 'premium';
  if (score >= 50) return 'commercial';
  if (score >= 25) return 'moderate';
  return 'developing';
}

function emptyCounts(): ZoneAmenities {
  return {
    banks: 0,
    hotels: 0,
    hospitals: 0,
    pharmacies: 0,
    supermarkets: 0,
    fuelStations: 0,
    affluenceSpots: 0,
    total: 0,
    luxuryRetail: 0,
    professionalServices: 0,
    premiumHotels: 0,
    casinos: 0,
    pawnshops: 0,
    moneyLenders: 0,
    socialFacilities: 0,
    charityShops: 0,
  };
}

// ---------- overpass ----------

/** Single Overpass query: all premium amenities + named places in a bbox. */
async function fetchOverpassForBbox(
  bbox: [number, number, number, number]
): Promise<OverpassElement[]> {
  const [south, north, west, east] = bbox;
  const bboxClause = `${south},${west},${north},${east}`;
  const amenityRegex = AMENITY_TAGS.join('|');
  const luxuryShopRegex = LUXURY_SHOP_TAGS.join('|');
  const negativeShopRegex = NEGATIVE_SHOP_TAGS.join('|');
  const officeRegex = PROFESSIONAL_OFFICE_TAGS.join('|');

  // v2-wealth query: original amenity set + shop=jewelry/watches/etc.
  // + office=financial/lawyer/etc. + shop=pawnbroker/charity (negatives).
  // Heavier than v1 but still a single batched Overpass call so cost is
  // the same round-trip + marginally bigger payload.
  const query = `
    [out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];
    (
      node["amenity"~"^(${amenityRegex})$"](${bboxClause});
      way["amenity"~"^(${amenityRegex})$"](${bboxClause});
      node["tourism"="hotel"](${bboxClause});
      way["tourism"="hotel"](${bboxClause});
      node["shop"~"^(${luxuryShopRegex})$"](${bboxClause});
      way["shop"~"^(${luxuryShopRegex})$"](${bboxClause});
      node["shop"~"^(${negativeShopRegex})$"](${bboxClause});
      way["shop"~"^(${negativeShopRegex})$"](${bboxClause});
      node["office"~"^(${officeRegex})$"](${bboxClause});
      way["office"~"^(${officeRegex})$"](${bboxClause});
      node["place"~"^(suburb|neighbourhood|quarter|city_district|borough|locality)$"](${bboxClause});
      way["place"~"^(suburb|neighbourhood|quarter|city_district|borough|locality)$"](${bboxClause});
      relation["place"~"^(suburb|neighbourhood|quarter|city_district|borough|locality)$"](${bboxClause});
    );
    out center tags;
  `;

  // Fire all mirrors in parallel, take the first success, cancel the rest.
  // Without the shared abort, a fast 504 from .de still leaves us waiting
  // on kumi's 20s grind because Promise.any only resolves once ALL inputs
  // settle if no early winner appears.
  const winnerAbort = new AbortController();
  const attempts = OVERPASS_MIRRORS.map(async (endpoint) => {
    const perAttempt = new AbortController();
    const onWinnerAbort = () => perAttempt.abort();
    winnerAbort.signal.addEventListener('abort', onWinnerAbort, { once: true });
    const timeout = setTimeout(() => perAttempt.abort(), OVERPASS_CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Overpass mirrors 406 requests without an explicit Accept +
          // identify themselves as bot-unfriendly to unnamed UAs.
          Accept: 'application/json',
          'User-Agent':
            'LeadSnatcher/1.0 (+https://github.com/creativeprofit22/aloo; Next.js app, low-volume dev use)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: perAttempt.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as OverpassResponse;
      const elements = data.elements ?? [];
      // osm.ch et al. happily return 200 + [] when the query exceeds their
      // internal budget. Treat that as a failure so the race continues to
      // the slower mirrors that may have completed the actual query.
      if (elements.length === 0) {
        throw new Error('empty elements (likely silent timeout)');
      }
      return { endpoint, elements };
    } finally {
      clearTimeout(timeout);
      winnerAbort.signal.removeEventListener('abort', onWinnerAbort);
    }
  });

  try {
    const winner = await Promise.any(attempts);
    // Tell the slower siblings to give up — they're racing for nothing now.
    winnerAbort.abort();
    return winner.elements;
  } catch (error) {
    // Promise.any throws AggregateError when ALL inputs reject
    if (error instanceof AggregateError) {
      error.errors.forEach((err, i) => {
        const ep = OVERPASS_MIRRORS[i];
        if (err instanceof Error && err.name === 'AbortError') {
          console.error(`Overpass (zone grid) ${ep} -> client timeout after ${OVERPASS_CLIENT_TIMEOUT_MS}ms`);
        } else {
          console.error(`Overpass (zone grid) ${ep} -> ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      console.error('Overpass (zone grid) all mirrors exhausted');
    } else {
      console.error('Overpass (zone grid) unexpected error:', error);
    }
    return [];
  }
}

// ---------- aggregation ----------

interface NamedPlace {
  lat: number;
  lon: number;
  name: string;
}

// True when the string's base glyphs are Latin. Diacritics are allowed
// (Zürich, São Paulo). Rejects non-Latin scripts (Cyrillic, CJK, Arabic)
// and special Latin letters like "ł" (Polish L-with-stroke) or "ß" that
// don't decompose to plain ASCII under NFD.
function isLatinOnly(s: string): boolean {
  return /^[\x20-\x7e]+$/.test(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

// Pick an English-friendly place name from Overpass tags. Prefers the
// explicit `name:en` tag OSM editors add for international places, falls
// back to `name` only when its base glyphs are Latin. Returns null when
// no clean label is available — caller falls back to the directional name.
function pickEnglishName(tags: Record<string, string>): string | null {
  const englishName = tags['name:en']?.trim();
  if (englishName && isLatinOnly(englishName)) {
    return englishName;
  }
  const nativeName = tags.name?.trim();
  if (nativeName && isLatinOnly(nativeName)) {
    return nativeName;
  }
  return null;
}

// Clean + title-case the user's raw search input for use as a zone label.
// "chicago il" → "Chicago", "irving park, chicago" → "Irving Park".
function formatUserSearchLabel(raw: string): string | null {
  const firstSegment = raw.split(',')[0]?.trim();
  if (!firstSegment) return null;
  // Strip trailing 2-letter state/country codes: "Chicago IL" → "Chicago"
  const cleaned = firstSegment.replace(/\s+[A-Za-z]{2}$/, '').trim();
  const source = cleaned || firstSegment;
  return source
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

type AmenityKey = keyof Omit<ZoneAmenities, 'total'>;

/**
 * Parse the `stars` tag (OSM values range from "0" / "0S" to "5S"). A 4+
 * rating promotes the hotel from the generic bucket to the premium bucket
 * — matches the 2026 research weighting (premium hotels = C-suite spend).
 */
function isPremiumHotel(tags: Record<string, string>): boolean {
  const stars = tags.stars?.trim();
  if (!stars) return false;
  const first = stars[0];
  const n = parseInt(first, 10);
  return Number.isFinite(n) && n >= 4;
}

function splitElements(elements: OverpassElement[]): {
  amenities: { lat: number; lon: number; key: AmenityKey }[];
  places: NamedPlace[];
} {
  const amenities: { lat: number; lon: number; key: AmenityKey }[] = [];
  const places: NamedPlace[] = [];

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const tags = el.tags ?? {};
    const placeTag = tags.place;
    if (placeTag) {
      const englishName = pickEnglishName(tags);
      if (englishName) {
        places.push({ lat, lon, name: englishName });
      }
      continue;
    }

    const amenity = tags.amenity ?? '';
    const tourism = tags.tourism ?? '';
    const shop = tags.shop ?? '';
    const office = tags.office ?? '';

    // Luxury retail — strongest single wealth signal
    if (
      shop === 'jewelry' ||
      shop === 'watches' ||
      shop === 'boutique' ||
      shop === 'art' ||
      shop === 'antiques' ||
      shop === 'wine' ||
      shop === 'gallery'
    ) {
      amenities.push({ lat, lon, key: 'luxuryRetail' });
      continue;
    }

    // Professional services offices
    if (
      office === 'financial' ||
      office === 'financial_advisor' ||
      office === 'lawyer' ||
      office === 'accountant' ||
      office === 'insurance' ||
      office === 'notary' ||
      office === 'tax_advisor'
    ) {
      amenities.push({ lat, lon, key: 'professionalServices' });
      continue;
    }

    // Negative shop signals
    if (shop === 'pawnbroker') {
      amenities.push({ lat, lon, key: 'pawnshops' });
      continue;
    }
    if (shop === 'charity' || shop === 'second_hand') {
      amenities.push({ lat, lon, key: 'charityShops' });
      continue;
    }

    // Hotels — split into premium vs generic based on stars
    if (amenity === 'hotel' || tourism === 'hotel') {
      amenities.push({ lat, lon, key: 'hotels' });
      if (isPremiumHotel(tags)) {
        amenities.push({ lat, lon, key: 'premiumHotels' });
      }
      continue;
    }

    // Amenity bucketing
    if (amenity === 'bank' || amenity === 'atm') {
      amenities.push({ lat, lon, key: 'banks' });
    } else if (amenity === 'hospital') {
      amenities.push({ lat, lon, key: 'hospitals' });
    } else if (amenity === 'pharmacy') {
      amenities.push({ lat, lon, key: 'pharmacies' });
    } else if (amenity === 'supermarket') {
      amenities.push({ lat, lon, key: 'supermarkets' });
    } else if (amenity === 'fuel' || amenity === 'car_rental') {
      amenities.push({ lat, lon, key: 'fuelStations' });
    } else if (amenity === 'casino') {
      amenities.push({ lat, lon, key: 'casinos' });
    } else if (amenity === 'pawnshop') {
      amenities.push({ lat, lon, key: 'pawnshops' });
    } else if (amenity === 'money_lender') {
      amenities.push({ lat, lon, key: 'moneyLenders' });
    } else if (amenity === 'social_facility') {
      amenities.push({ lat, lon, key: 'socialFacilities' });
    } else if (
      amenity === 'gym' ||
      amenity === 'spa' ||
      amenity === 'cinema' ||
      amenity === 'theatre'
    ) {
      amenities.push({ lat, lon, key: 'affluenceSpots' });
    }
  }

  return { amenities, places };
}

function nearestPlaceName(
  lat: number,
  lon: number,
  places: NamedPlace[],
  maxMeters: number
): string | null {
  let best: NamedPlace | null = null;
  let bestDist = Infinity;
  for (const p of places) {
    const d = haversineMeters(lat, lon, p.lat, p.lon);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best && bestDist <= maxMeters ? best.name : null;
}

/** Normalize a place/user label for case/punctuation-tolerant matching. */
function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/['’`.,]/g, '') // strip apostrophes/commas/periods
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build zones centered on the actual OSM named places in the bbox,
 * rather than a fixed 3×3 geometric grid. This surfaces real wealth
 * neighborhoods (Mayfair, Canary Wharf, Knightsbridge) as chip options
 * instead of whatever happened to sit closest to a grid corner.
 *
 * Dedupes overlapping places (within PLACE_DEDUPE_METERS keep higher
 * score) and caps at PLACE_MAX_ZONES. Returns [] if there aren't enough
 * places in the bbox — caller should fall back to grid scanning.
 */
function buildPlaceBasedZones(
  amenities: { lat: number; lon: number; key: AmenityKey }[],
  places: NamedPlace[],
  centerLat: number,
  centerLon: number
): Zone[] {
  if (places.length < PLACE_SCAN_MIN_PLACES) return [];

  // First: score every place.
  const scored = places.map((p, i): Zone => {
    const counts = emptyCounts();
    for (const a of amenities) {
      const d = haversineMeters(p.lat, p.lon, a.lat, a.lon);
      if (d <= ZONE_RADIUS_METERS) {
        counts[a.key] = (counts[a.key] ?? 0) + 1;
        counts.total++;
      }
    }
    const score = scoreCounts(counts);
    return {
      id: `place-${i}`,
      label: p.name,
      latitude: p.lat,
      longitude: p.lon,
      score,
      level: levelForScore(score),
      amenities: counts,
      radiusMeters: ZONE_RADIUS_METERS,
      distanceFromCenterMeters: haversineMeters(
        centerLat,
        centerLon,
        p.lat,
        p.lon
      ),
    };
  });

  // Dedupe: process highest-scoring first, skip anything within
  // PLACE_DEDUPE_METERS of an already-kept zone. This lets the top
  // "Mayfair" at score 92 suppress a nearby "Fitzrovia" at score 68
  // that's really covering the same amenities.
  scored.sort((a, b) => b.score - a.score);
  const kept: Zone[] = [];
  for (const z of scored) {
    if (z.score <= 0) continue;
    const tooClose = kept.some(
      (k) =>
        haversineMeters(z.latitude, z.longitude, k.latitude, k.longitude) <
        PLACE_DEDUPE_METERS
    );
    if (!tooClose) kept.push(z);
    if (kept.length >= PLACE_MAX_ZONES) break;
  }
  return kept;
}

// ---------- single-zone fallback ----------

async function buildSingleZone(
  centerLat: number,
  centerLon: number,
  userSearchLabel?: string | null
): Promise<ZoneGridResult> {
  // Use a tight bbox around the center for the Overpass call
  const halfDeg = ZONE_RADIUS_METERS / 111000; // approx
  const bbox: [number, number, number, number] = [
    centerLat - halfDeg,
    centerLat + halfDeg,
    centerLon - halfDeg / Math.cos(toRadians(centerLat)),
    centerLon + halfDeg / Math.cos(toRadians(centerLat)),
  ];
  const elements = await fetchOverpassForBbox(bbox);
  const { amenities, places } = splitElements(elements);

  const counts = emptyCounts();
  for (const a of amenities) {
    const d = haversineMeters(centerLat, centerLon, a.lat, a.lon);
    if (d <= ZONE_RADIUS_METERS) {
      counts[a.key] = (counts[a.key] ?? 0) + 1;
      counts.total++;
    }
  }

  const score = scoreCounts(counts);
  // User's search term wins — they should always see what they queried
  // reflected in the focused zone, not an adjacent OSM place name.
  const label =
    userSearchLabel ??
    nearestPlaceName(centerLat, centerLon, places, ZONE_RADIUS_METERS) ??
    'Central';

  const zone: Zone = {
    id: 'zone-0',
    label,
    latitude: centerLat,
    longitude: centerLon,
    score,
    level: levelForScore(score),
    amenities: counts,
    radiusMeters: ZONE_RADIUS_METERS,
    distanceFromCenterMeters: 0,
  };

  return {
    zones: [zone],
    centroid: { latitude: centerLat, longitude: centerLon },
    bbox,
    singleZone: true,
  };
}

// Synthesized empty single zone — used when Overpass is unreachable so we
// never sit through a second timeout via buildSingleZone's own Overpass call.
function synthesizeEmptyZone(
  centerLat: number,
  centerLon: number,
  userSearchLabel?: string | null
): ZoneGridResult {
  const halfDeg = ZONE_RADIUS_METERS / 111000;
  const bbox: [number, number, number, number] = [
    centerLat - halfDeg,
    centerLat + halfDeg,
    centerLon - halfDeg / Math.cos(toRadians(centerLat)),
    centerLon + halfDeg / Math.cos(toRadians(centerLat)),
  ];
  const counts = emptyCounts();
  return {
    zones: [
      {
        id: 'zone-0',
        label: userSearchLabel ?? 'Central',
        latitude: centerLat,
        longitude: centerLon,
        score: 0,
        level: levelForScore(0),
        amenities: counts,
        radiusMeters: ZONE_RADIUS_METERS,
        distanceFromCenterMeters: 0,
      },
    ],
    centroid: { latitude: centerLat, longitude: centerLon },
    bbox,
    singleZone: true,
  };
}

// ---------- public API ----------

/**
 * Scan multiple zones within a city's bounding box.
 * Returns zones sorted by area score (highest first).
 *
 * Free: one Overpass call, cached 7 days per city.
 */
export async function scanCityZones(
  city: string,
  country: string,
  centerLat: number,
  centerLon: number,
  bbox?: [number, number, number, number]
): Promise<ZoneGridResult> {
  const key = cacheKey(city, country);
  const cached = zoneGridCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // Singleflight: if a sibling caller is already fetching this city, await
  // theirs instead of stacking another Overpass call on top.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<ZoneGridResult> => {
    // Missing bbox or tiny bbox → single-zone fallback
    let workingBbox = bbox;
    if (workingBbox) {
      const [south, north, west, east] = workingBbox;
      const diagonalKm =
        haversineMeters(south, west, north, east) / 1000;
      if (diagonalKm < SMALL_CITY_DIAGONAL_KM) {
        workingBbox = undefined;
      }
    }

    const userSearchLabel = formatUserSearchLabel(city);

    if (!workingBbox) {
      const result = await buildSingleZone(centerLat, centerLon, userSearchLabel);
      const ttl =
        result.zones[0]?.amenities.total === 0
          ? FAILURE_CACHE_TTL_MS
          : CACHE_TTL_MS;
      zoneGridCache.set(key, { result, expiresAt: Date.now() + ttl });
      return result;
    }

    const clamped = clampBbox(workingBbox, centerLat, centerLon);

    const elements = await fetchOverpassForBbox(clamped);
    if (elements.length === 0) {
      // Overpass unreachable. Don't recurse into buildSingleZone (which would
      // fire ANOTHER Overpass call and double the timeout). Synthesize an
      // empty single zone, cache it briefly so retries can recover.
      const result = synthesizeEmptyZone(centerLat, centerLon, userSearchLabel);
      zoneGridCache.set(key, {
        result,
        expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
      });
      return result;
    }

    const { amenities, places } = splitElements(elements);

    // Prefer place-based scanning — scan AT named OSM places (Mayfair,
    // Canary Wharf, Ginza, Polanco, etc.) rather than at fixed grid
    // corners. Falls back to the geometric grid when there aren't enough
    // named places (sparsely-tagged cities / rural bboxes).
    let zones = buildPlaceBasedZones(amenities, places, centerLat, centerLon);

    if (zones.length < PLACE_SCAN_MIN_PLACES) {
      // Fallback: fixed 3×3 grid, label each point with the nearest place
      // name. Keeps old behaviour for cities where OSM places are sparse.
      const gridPoints = generateGridPoints(clamped);
      zones = gridPoints.map((gp, i) => {
        const counts = emptyCounts();
        for (const a of amenities) {
          const d = haversineMeters(gp.lat, gp.lon, a.lat, a.lon);
          if (d <= ZONE_RADIUS_METERS) {
            counts[a.key] = (counts[a.key] ?? 0) + 1;
            counts.total++;
          }
        }
        const score = scoreCounts(counts);
        const nearName = nearestPlaceName(
          gp.lat,
          gp.lon,
          places,
          ZONE_RADIUS_METERS
        );
        return {
          id: `zone-${i}`,
          label: nearName ?? directionalLabel(gp.row, gp.col),
          latitude: gp.lat,
          longitude: gp.lon,
          score,
          level: levelForScore(score),
          amenities: counts,
          radiusMeters: ZONE_RADIUS_METERS,
          distanceFromCenterMeters: haversineMeters(
            centerLat,
            centerLon,
            gp.lat,
            gp.lon
          ),
        };
      });
    }

    // User-label override — if the user typed a specific neighborhood,
    // honor it. Three cases, in priority order:
    //   1. A place-based zone already matches the label (modulo case /
    //      apostrophes) → rename to canonical form so downstream lookups
    //      by label find it.
    //   2. The search center sits close enough to a place to be "about"
    //      it → rename the nearest zone.
    //   3. No match → splice in a synthetic zone at the search center so
    //      the user always sees what they searched for represented.
    if (userSearchLabel) {
      const normalizedUser = normalizeLabel(userSearchLabel);
      const matchIdx = zones.findIndex(
        (z) => normalizeLabel(z.label) === normalizedUser
      );
      if (matchIdx >= 0) {
        zones[matchIdx] = { ...zones[matchIdx], label: userSearchLabel };
      } else if (zones.length > 0) {
        let nearestIdx = 0;
        let nearestDist = Infinity;
        zones.forEach((z, i) => {
          if (z.distanceFromCenterMeters < nearestDist) {
            nearestDist = z.distanceFromCenterMeters;
            nearestIdx = i;
          }
        });
        // Only repurpose a nearby zone if it's genuinely close — otherwise
        // we'd be rebranding a far-off zone with the user's label.
        if (nearestDist <= ZONE_RADIUS_METERS) {
          zones[nearestIdx] = { ...zones[nearestIdx], label: userSearchLabel };
        }
      }
    }

    zones.sort((a, b) => b.score - a.score);

    const result: ZoneGridResult = {
      zones,
      centroid: { latitude: centerLat, longitude: centerLon },
      bbox: clamped,
      singleZone: false,
    };

    zoneGridCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/** Exported for tests / manual cache invalidation. */
export function clearZoneGridCache(): void {
  zoneGridCache.clear();
  inFlight.clear();
}
