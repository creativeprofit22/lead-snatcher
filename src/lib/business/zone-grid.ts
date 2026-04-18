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

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

const PREMIUM_AMENITIES = [
  'bank',
  'atm',
  'hotel',
  'hospital',
  'pharmacy',
  'supermarket',
  'fuel',
  'car_rental',
] as const;

const AFFLUENCE_AMENITIES = ['gym', 'spa', 'cinema', 'theatre'] as const;

const ALL_AMENITIES = [...PREMIUM_AMENITIES, ...AFFLUENCE_AMENITIES];

const ZONE_RADIUS_METERS = 1500;
const GRID_SIZE = 3; // 3x3
const MAX_BBOX_SIDE_KM = 30; // clamp huge metro bboxes
const SMALL_CITY_DIAGONAL_KM = 4; // below this, skip grid and return single zone
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type ZoneLevel = 'premium' | 'commercial' | 'moderate' | 'developing';

export interface ZoneAmenities {
  banks: number;
  hotels: number;
  hospitals: number;
  pharmacies: number;
  supermarkets: number;
  fuelStations: number;
  affluenceSpots: number;
  total: number;
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

function cacheKey(city: string, country: string): string {
  return `${country.toLowerCase()}|${city.trim().toLowerCase()}`;
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

function scoreCounts(counts: ZoneAmenities): number {
  return Math.min(
    100,
    Math.round(
      counts.banks * 6 +
        counts.hotels * 5 +
        counts.hospitals * 8 +
        counts.pharmacies * 3 +
        counts.supermarkets * 2 +
        counts.fuelStations * 2 +
        counts.affluenceSpots * 4
    )
  );
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
  };
}

// ---------- overpass ----------

/** Single Overpass query: all premium amenities + named places in a bbox. */
async function fetchOverpassForBbox(
  bbox: [number, number, number, number]
): Promise<OverpassElement[]> {
  const [south, north, west, east] = bbox;
  const bboxClause = `${south},${west},${north},${east}`;
  const amenityRegex = ALL_AMENITIES.join('|');

  const query = `
    [out:json][timeout:20];
    (
      node["amenity"~"^(${amenityRegex})$"](${bboxClause});
      way["amenity"~"^(${amenityRegex})$"](${bboxClause});
      node["tourism"="hotel"](${bboxClause});
      way["tourism"="hotel"](${bboxClause});
      node["place"~"^(suburb|neighbourhood|quarter|city_district|borough)$"](${bboxClause});
    );
    out center tags;
  `;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error('Overpass (zone grid) error:', response.status);
      return [];
    }

    const data = (await response.json()) as OverpassResponse;
    return data.elements ?? [];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Overpass (zone grid) timeout');
    } else {
      console.error('Overpass (zone grid) failed:', error);
    }
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- aggregation ----------

interface NamedPlace {
  lat: number;
  lon: number;
  name: string;
}

function splitElements(elements: OverpassElement[]): {
  amenities: { lat: number; lon: number; key: string }[];
  places: NamedPlace[];
} {
  const amenities: { lat: number; lon: number; key: string }[] = [];
  const places: NamedPlace[] = [];

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const tags = el.tags ?? {};
    const placeTag = tags.place;
    if (placeTag && tags.name) {
      places.push({ lat, lon, name: tags.name });
      continue;
    }

    const amenity = tags.amenity ?? '';
    const tourism = tags.tourism ?? '';

    if (amenity === 'bank' || amenity === 'atm') amenities.push({ lat, lon, key: 'banks' });
    else if (amenity === 'hotel' || tourism === 'hotel') amenities.push({ lat, lon, key: 'hotels' });
    else if (amenity === 'hospital') amenities.push({ lat, lon, key: 'hospitals' });
    else if (amenity === 'pharmacy') amenities.push({ lat, lon, key: 'pharmacies' });
    else if (amenity === 'supermarket') amenities.push({ lat, lon, key: 'supermarkets' });
    else if (amenity === 'fuel' || amenity === 'car_rental')
      amenities.push({ lat, lon, key: 'fuelStations' });
    else if (['gym', 'spa', 'cinema', 'theatre'].includes(amenity))
      amenities.push({ lat, lon, key: 'affluenceSpots' });
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

// ---------- single-zone fallback ----------

async function buildSingleZone(
  centerLat: number,
  centerLon: number
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
      counts[a.key as keyof Omit<ZoneAmenities, 'total'>]++;
      counts.total++;
    }
  }

  const score = scoreCounts(counts);
  const label =
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

  if (!workingBbox) {
    const result = await buildSingleZone(centerLat, centerLon);
    zoneGridCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  const clamped = clampBbox(workingBbox, centerLat, centerLon);
  const gridPoints = generateGridPoints(clamped);

  const elements = await fetchOverpassForBbox(clamped);
  if (elements.length === 0) {
    // Overpass failed — fall back to single zone
    const result = await buildSingleZone(centerLat, centerLon);
    zoneGridCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  const { amenities, places } = splitElements(elements);

  // For each grid point, tally amenities within ZONE_RADIUS_METERS
  const zones: Zone[] = gridPoints.map((gp, i) => {
    const counts = emptyCounts();
    for (const a of amenities) {
      const d = haversineMeters(gp.lat, gp.lon, a.lat, a.lon);
      if (d <= ZONE_RADIUS_METERS) {
        counts[a.key as keyof Omit<ZoneAmenities, 'total'>]++;
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

  zones.sort((a, b) => b.score - a.score);

  const result: ZoneGridResult = {
    zones,
    centroid: { latitude: centerLat, longitude: centerLon },
    bbox: clamped,
    singleZone: false,
  };

  zoneGridCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Exported for tests / manual cache invalidation. */
export function clearZoneGridCache(): void {
  zoneGridCache.clear();
}
