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
// in the highest-rent zones almost by definition. Feeds both the wealth
// score (rich clientele proxy) and the business score (B2B density).
const PROFESSIONAL_OFFICE_TAGS = [
  'financial',
  'financial_advisor',
  'lawyer',
  'accountant',
  'insurance',
  'notary',
  'tax_advisor',
] as const;

// Corporate offices — the "business district" signal. Captures the
// Canary Wharf / Shoreditch / King's Cross / Silicon Valley pattern
// where money flows through corporate HQs + tech + consulting rather
// than through consumer-facing luxury retail. Fed only into the
// business score axis so Mayfair-style pure-consumer zones aren't
// inflated by a handful of real-estate agents.
const CORPORATE_OFFICE_TAGS = [
  'company',
  'consulting',
  'it',
  'advertising_agency',
  'coworking',
  'research',
  'estate_agent',
  'government',
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
// Client timeout MUST exceed server timeout — otherwise we abort before
// Overpass finishes computing and never see results that would have come
// back within the server budget. Previously 12s client vs 20s server
// silently killed dense-city queries (London) mid-flight.
const OVERPASS_SERVER_TIMEOUT_S = 30;
const OVERPASS_CLIENT_TIMEOUT_MS = 35000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Bump when the scoring formula or queried tag set changes. Old cached
// results remain in the store under the previous key and will expire
// naturally, but new callers get fresh data under the new version.
const CACHE_SCHEMA_VERSION = 'v11-two-axis-tuned';

// Place-based scanning: use OSM named places (Mayfair, Canary Wharf, etc.)
// as zone centers instead of a 3×3 grid. If we find at least this many
// places in the bbox, scan at them. Below that, fall back to the grid so
// sparsely-tagged cities still get some coverage.
const PLACE_SCAN_MIN_PLACES = 4;
// Two places centroid-to-centroid closer than this get merged (keep the
// higher-scoring one) — the 1.5km scan radius would otherwise produce
// near-duplicate zones for adjacent OSM places.
const PLACE_DEDUPE_METERS = 700;
// Cap on returned zones from place-based scan. Raised from 25 → 36 in
// tandem with the per-octant cap below — 9 octants × 4 per octant = 36
// gives every region of the 3×3 RegionPicker a fair shot at coverage.
const PLACE_MAX_ZONES = 36;
// Per-octant zone cap. Without this, dense inner-city scores dominate the
// top-N and outer regions (East London, Lower Manhattan, etc.) show up
// empty in the RegionPicker even when legitimate places exist there. The
// octant grid is the same 3×3 split the neighborhoods route uses for
// region classification, so a cap here maps directly to a per-region cap
// in the UI.
const PLACE_MAX_PER_OCTANT = 4;
// Short TTL for soft-failed lookups (Overpass down). Prevents thrash on
// every autocomplete keystroke while still letting the user retry soon.
const FAILURE_CACHE_TTL_MS = 60 * 1000;

export type ZoneLevel = 'premium' | 'commercial' | 'moderate' | 'developing';

/**
 * Two-axis archetype derived from wealth vs business scores.
 * - luxury: consumer-wealth dominant (Mayfair, Knightsbridge, Ginza) —
 *   luxury retail, premium hotels, high-end leisure. Ideal target for
 *   service businesses that sell TO the wealthy (salons, boutiques).
 * - corporate: business-density dominant (Canary Wharf, Shoreditch,
 *   King's Cross) — offices, professional services, tech. Ideal target
 *   for B2B SaaS, agencies, consulting.
 * - mixed: both axes strong (The City, Soho, Midtown). Broad ICP fit.
 * - developing: neither axis strong — outer suburbs / emerging areas.
 */
export type ZoneArchetype = 'luxury' | 'corporate' | 'mixed' | 'developing';

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
  // the scorers treat `undefined` as 0.
  /** shop=jewelry|watches|boutique|art|antiques|wine|gallery */
  luxuryRetail?: number;
  /** office=financial|lawyer|accountant|insurance|notary|... */
  professionalServices?: number;
  /** tourism=hotel with stars>=4 (subset of `hotels`) */
  premiumHotels?: number;
  /** amenity=casino (tracked separately from gym/spa bucket for weighting) */
  casinos?: number;
  /** office=company|consulting|it|advertising_agency|coworking|research|... */
  corporateOffices?: number;
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
  /**
   * Headline 0-100 score — max of wealthScore and businessScore, with
   * OSM prominence bonus applied. This is what the UI surfaces as the
   * main number. Use wealthScore/businessScore/archetype for the full
   * "what kind of money zone" breakdown.
   */
  score: number;
  /** Consumer-wealth axis — luxury retail, premium hotels, affluence spots. */
  wealthScore: number;
  /** Business-density axis — corporate offices, professional services. */
  businessScore: number;
  /** Archetype derived from wealth vs business scores. */
  archetype: ZoneArchetype;
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

/**
 * Nominatim returns both a geocode point (the "default" address for a city,
 * usually a historic landmark like Charing Cross) and a bounding box for
 * the city's full extent. For dense cities with wide bboxes, these two
 * centers diverge substantially — London's geocode point sits ~8 km west
 * of the bbox midpoint. Clamping around the geocode point shifts the
 * scanned bbox west and starves the East region (Canary Wharf, Stratford).
 * Use the bbox midpoint when available so coverage stays balanced.
 */
function bboxCenter(
  bbox: [number, number, number, number]
): { lat: number; lon: number } {
  const [south, north, west, east] = bbox;
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
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
 * Shared negative-signal deduction — pawnshops, money lenders, social
 * facilities, charity shops. Applied to both axes so a poverty-flagged
 * zone can't achieve a high score on either dimension.
 */
function negativesPenalty(counts: ZoneAmenities): number {
  const pawnshops = logCap(counts.pawnshops, 3);
  const moneyLenders = logCap(counts.moneyLenders, 3);
  const socialFacilities = logCap(counts.socialFacilities, 3);
  const charityShops = logCap(counts.charityShops, 3);
  return (
    -6 * pawnshops + -4 * moneyLenders + -4 * socialFacilities + -2 * charityShops
  );
}

/**
 * Consumer-wealth axis (0-100). Rewards the Mayfair / Knightsbridge /
 * Ginza pattern — luxury retail density, premium hotels, affluence
 * leisure, some bank/hotel tail. Professional services kept in here
 * as a weak positive (rich clientele proxy) but dominant weight is on
 * retail, which is what differentiates consumer-wealth from pure
 * corporate districts.
 */
function scoreWealth(counts: ZoneAmenities): number {
  const luxury = logCap(counts.luxuryRetail);
  const prof = logCap(counts.professionalServices);
  const premiumHotel = logCap(counts.premiumHotels);
  const casino = logCap(counts.casinos);
  const banks = logCap(counts.banks);
  const affluence = logCap(counts.affluenceSpots);
  const genericHotel = logCap(counts.hotels);

  const raw =
    5 * luxury +
    3 * premiumHotel +
    2 * affluence +
    1.5 * banks +
    1.5 * genericHotel +
    1.5 * casino +
    1 * prof +
    negativesPenalty(counts);

  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Business-density axis (0-100). Rewards the Canary Wharf / Shoreditch /
 * King's Cross / Silicon Valley pattern — corporate offices, finance
 * and legal professional services, commercial banks. Luxury retail is
 * ignored here so the axis doesn't drift back toward Mayfair.
 *
 * Premium hotels get a small weight because business travel concentrates
 * in corporate districts; generic hotels are ignored (too noisy).
 */
function scoreBusiness(counts: ZoneAmenities): number {
  const prof = logCap(counts.professionalServices);
  const corporate = logCap(counts.corporateOffices);
  const banks = logCap(counts.banks);
  const premiumHotel = logCap(counts.premiumHotels);

  // Weights bumped vs wealth axis to compensate for the business side
  // having fewer signals (4 vs 7). Without the bump, corporate zones
  // like Canary Wharf (40+ named HQs, 50+ offices, 38 banks) still
  // topped out around 47/100 — numerically underselling genuine
  // business density.
  const raw =
    5 * prof +
    4.5 * corporate +
    3 * banks +
    2 * premiumHotel +
    negativesPenalty(counts);

  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Archetype thresholds. Tuned so that:
 * - Mayfair/Knightsbridge (W≥75, B<70) → luxury
 * - Canary Wharf (B≥70, W<70) → corporate
 * - The City / Soho / Midtown (both ≥70) → mixed
 * - outer suburbs (both <40) → developing
 *
 * Mixed requires both axes ≥70 (not 60) to avoid labeling Mayfair — which
 * has real but secondary office density — as mixed. Keeps the archetype
 * a useful targeting signal: "Mixed" actually means both flavors of money
 * are strong here.
 */
function deriveArchetype(wealth: number, business: number): ZoneArchetype {
  if (Math.max(wealth, business) < 40) return 'developing';
  if (wealth >= 70 && business >= 70) return 'mixed';
  return wealth >= business ? 'luxury' : 'corporate';
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
    corporateOffices: 0,
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
  const corporateOfficeRegex = CORPORATE_OFFICE_TAGS.join('|');

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
      node["office"~"^(${corporateOfficeRegex})$"](${bboxClause});
      way["office"~"^(${corporateOfficeRegex})$"](${bboxClause});
      way["building"="office"]["name"](${bboxClause});
      way["building"="office"]["operator"](${bboxClause});
      node["place"~"^(suburb|neighbourhood|quarter|city_district|borough|locality)$"](${bboxClause});
      way["place"~"^(suburb|neighbourhood|quarter|city_district|borough|locality)$"](${bboxClause});
      relation["place"~"^(suburb|neighbourhood|quarter|city_district|borough|locality)$"](${bboxClause});
      way["landuse"~"^(commercial|retail)$"]["name"](${bboxClause});
      relation["landuse"~"^(commercial|retail)$"]["name"](${bboxClause});
      relation["boundary"="administrative"]["admin_level"~"^(9|10)$"]["name"](${bboxClause});
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
  /**
   * OSM prominence bonus (0-10). Landmarks like Canary Wharf carry
   * `wikidata`/`wikipedia`/`tourism=yes` + `place=suburb` tags; minor
   * places (housing estates, micro-neighborhoods) do not. Without this,
   * score-margin noise (±2 pts) lets a minor place inside the 700m
   * dedupe radius suppress a globally-known landmark. The bonus is
   * small enough to only break near-ties, not to reorder legitimately
   * high-scoring zones.
   */
  prominence: number;
}

/**
 * Derive prominence bonus from an OSM element's tags. Caps at 10 so the
 * bonus nudges ties without overwhelming real amenity-density signal.
 */
function prominenceBonus(tags: Record<string, string>): number {
  let bonus = 0;
  if (tags.wikidata) bonus += 3;
  if (tags.wikipedia) bonus += 3;
  if (tags.tourism) bonus += 2; // any tourism tag (yes/attraction/viewpoint/...)
  if (tags.place === 'suburb') bonus += 2;
  else if (tags.place === 'city_district' || tags.place === 'borough') bonus += 1;
  return Math.min(10, bonus);
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
        places.push({ lat, lon, name: englishName, prominence: prominenceBonus(tags) });
      }
      continue;
    }

    // Fallback place sources for districts OSM doesn't tag with place=*.
    // Named commercial/retail landuse polygons (Canary Wharf is mapped this
    // way in some renderings), and ward-level administrative relations
    // (admin_level 9–10 = inner London wards, NYC CDs, etc.). These fill
    // in outer-region coverage on dense cities without pulling in every
    // named polygon — the name tag is required.
    const landuseTag = tags.landuse;
    const boundaryTag = tags.boundary;
    const adminLevel = tags.admin_level;
    if (
      (landuseTag === 'commercial' || landuseTag === 'retail') ||
      (boundaryTag === 'administrative' &&
        (adminLevel === '9' || adminLevel === '10'))
    ) {
      const englishName = pickEnglishName(tags);
      if (englishName) {
        places.push({ lat, lon, name: englishName, prominence: prominenceBonus(tags) });
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

    // Professional services offices — finance + legal. Feed both axes
    // (wealth as "rich clientele" proxy, business as pure B2B density).
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

    // Corporate offices — business-axis signal. Captures CW / Shoreditch
    // / Silicon Valley patterns where money flows through HQs + tech +
    // consulting rather than consumer retail.
    if (
      office === 'company' ||
      office === 'consulting' ||
      office === 'it' ||
      office === 'advertising_agency' ||
      office === 'coworking' ||
      office === 'research' ||
      office === 'estate_agent' ||
      office === 'government'
    ) {
      amenities.push({ lat, lon, key: 'corporateOffices' });
      continue;
    }

    // Named corporate office buildings. OSM often tags a whole tower with
    // `building=office + name/operator` (HSBC Tower, Barclays HQ, Citi
    // Tower at Canary Wharf) rather than per-floor `office=*` nodes.
    // Requiring name OR operator keeps out generic 2-story office shells.
    if (
      tags.building === 'office' &&
      (Boolean(tags.name) || Boolean(tags.operator))
    ) {
      amenities.push({ lat, lon, key: 'corporateOffices' });
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
/**
 * Octant key for a point within the clamped bbox, using the same 3×3
 * split the neighborhoods route uses for region classification. Kept
 * in sync so a per-octant cap here maps cleanly to per-region coverage
 * downstream.
 */
function octantKey(
  lat: number,
  lon: number,
  bbox: [number, number, number, number]
): string {
  const [south, north, west, east] = bbox;
  const latThird = (north - south) / 3;
  const lonThird = (east - west) / 3;
  const latIdx = lat < south + latThird ? 0 : lat < south + 2 * latThird ? 1 : 2;
  const lonIdx = lon < west + lonThird ? 0 : lon < west + 2 * lonThird ? 1 : 2;
  return `${latIdx},${lonIdx}`;
}

function buildPlaceBasedZones(
  amenities: { lat: number; lon: number; key: AmenityKey }[],
  places: NamedPlace[],
  centerLat: number,
  centerLon: number,
  clampedBbox: [number, number, number, number]
): Zone[] {
  if (places.length < PLACE_SCAN_MIN_PLACES) return [];

  // First: score every place on both axes (wealth + business), then
  // take the max as the headline score and apply the OSM prominence
  // bonus. Prominence nudges near-ties so globally-known landmarks
  // (Canary Wharf, Times Square, Ginza) win the dedupe race against
  // minor nearby places with marginally higher amenity counts.
  const scored = places.map((p, i): Zone => {
    const counts = emptyCounts();
    for (const a of amenities) {
      const d = haversineMeters(p.lat, p.lon, a.lat, a.lon);
      if (d <= ZONE_RADIUS_METERS) {
        counts[a.key] = (counts[a.key] ?? 0) + 1;
        counts.total++;
      }
    }
    const wealthScore = scoreWealth(counts);
    const businessScore = scoreBusiness(counts);
    const score = Math.min(100, Math.max(wealthScore, businessScore) + p.prominence);
    return {
      id: `place-${i}`,
      label: p.name,
      latitude: p.lat,
      longitude: p.lon,
      score,
      wealthScore,
      businessScore,
      archetype: deriveArchetype(wealthScore, businessScore),
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

  // Dedupe + per-octant fairness: process highest-scoring first, skip
  // anything within PLACE_DEDUPE_METERS of a kept zone (suppresses
  // near-duplicate districts covering the same amenities), AND cap each
  // 3×3 octant at PLACE_MAX_PER_OCTANT so dense inner-city scoring
  // doesn't lock outer regions out of the returned set.
  scored.sort((a, b) => b.score - a.score);
  const kept: Zone[] = [];
  const perOctant = new Map<string, number>();
  for (const z of scored) {
    if (z.score <= 0) continue;
    const oct = octantKey(z.latitude, z.longitude, clampedBbox);
    if ((perOctant.get(oct) ?? 0) >= PLACE_MAX_PER_OCTANT) continue;
    const tooClose = kept.some(
      (k) =>
        haversineMeters(z.latitude, z.longitude, k.latitude, k.longitude) <
        PLACE_DEDUPE_METERS
    );
    if (tooClose) continue;
    kept.push(z);
    perOctant.set(oct, (perOctant.get(oct) ?? 0) + 1);
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

  const wealthScore = scoreWealth(counts);
  const businessScore = scoreBusiness(counts);
  const score = Math.max(wealthScore, businessScore);
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
    wealthScore,
    businessScore,
    archetype: deriveArchetype(wealthScore, businessScore),
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
        wealthScore: 0,
        businessScore: 0,
        archetype: 'developing',
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

    // Clamp around the bbox midpoint, not the geocode point. For wide city
    // bboxes (Greater London, NYC metro) these diverge enough that clamping
    // around the geocode point leaves outer regions uncovered on one side.
    const { lat: clampLat, lon: clampLon } = bboxCenter(workingBbox);
    const clamped = clampBbox(workingBbox, clampLat, clampLon);

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
    let zones = buildPlaceBasedZones(
      amenities,
      places,
      centerLat,
      centerLon,
      clamped
    );

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
        const wealthScore = scoreWealth(counts);
        const businessScore = scoreBusiness(counts);
        const score = Math.max(wealthScore, businessScore);
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
          wealthScore,
          businessScore,
          archetype: deriveArchetype(wealthScore, businessScore),
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
