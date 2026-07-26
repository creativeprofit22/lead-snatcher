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

import type { RegionDirection } from './neighborhood-contract';
import type { Zone, ZoneBbox, ZoneGridResult } from './zone-contract';
import { decodeZoneElements, type NamedPlace } from './zone-osm-signals';
import { fetchZoneElements } from './zone-overpass';
import { classifyRegion } from './zone-regions';
import {
  buildScoredZone,
  DEFAULT_ZONE_RADIUS_METERS,
  type ZoneAmenityFeature,
} from './zone-scoring';
export type {
  Zone,
  ZoneAmenities,
  ZoneArchetype,
  ZoneBbox,
  ZoneGridResult,
  ZoneLevel,
} from './zone-contract';
export { classifyZoneTags, ZONE_TAG_TO_AMENITY_KEY } from './zone-osm-signals';

const ZONE_RADIUS_METERS = DEFAULT_ZONE_RADIUS_METERS;
const GRID_SIZE = 3; // 3x3
// 20km bbox keeps Overpass queries tractable in ultra-dense metros (London,
// NYC, Tokyo, Mumbai). Larger bbox + Overpass density = timeouts → single
// zone fallback. 20km still covers central London zones 1-3 worth of leads.
const MAX_BBOX_SIDE_KM = 20;
const SMALL_CITY_DIAGONAL_KM = 4; // below this, skip grid and return single zone
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Bump when the scoring formula or queried tag set changes. Old cached
// results remain in the store under the previous key and will expire
// naturally, but new callers get fresh data under the new version.
const CACHE_SCHEMA_VERSION = 'v15-unique-poi-total';

// Place-based scanning: use OSM named places (Mayfair, Canary Wharf, etc.)
// as zone centers instead of a 3×3 grid. If we find at least this many
// places in the bbox, scan at them. Below that, fall back to the grid so
// sparsely-tagged cities still get some coverage.
const PLACE_SCAN_MIN_PLACES = 4;
// Two places centroid-to-centroid closer than this get merged (keep the
// higher-scoring one) — the 1.5km scan radius would otherwise produce
// near-duplicate zones for adjacent OSM places.
const PLACE_DEDUPE_METERS = 700;
// Cap on returned zones from place-based scan. Raised from 25 → 36 alongside
// the per-region cap below so every RegionPicker cell gets fair coverage.
const PLACE_MAX_ZONES = 36;
// Per-region zone cap. Without this, dense inner-city scores dominate the
// top-N and outer regions (East London, Lower Manhattan, etc.) show up
// empty in the RegionPicker even when legitimate places exist there. This
// uses the shared 3×3 bbox classifier, so capping and API grouping cannot
// disagree. Set to 6 rather than 4 because Central London / Midtown /
// Central Tokyo legitimately have ~6-8 named neighborhoods a user would
// expect to pick (Mayfair, Soho, Knightsbridge, Belgravia, Covent Garden,
// St James's); 4 was cropping recognizable places without helping outer
// regions (which never hit the cap).
const PLACE_MAX_PER_REGION = 6;
// Short TTL for soft-failed lookups (Overpass down). Prevents thrash on
// every autocomplete keystroke while still letting the user retry soon.
const FAILURE_CACHE_TTL_MS = 60 * 1000;

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
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
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
function bboxCenter(bbox: ZoneBbox): { lat: number; lon: number } {
  const [south, north, west, east] = bbox;
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

/** Clamp bbox so no side exceeds MAX_BBOX_SIDE_KM, centered on given point. */
function clampBbox(bbox: ZoneBbox, centerLat: number, centerLon: number): ZoneBbox {
  const [south, north, west, east] = bbox;
  const heightKm = haversineMeters(south, centerLon, north, centerLon) / 1000;
  const widthKm = haversineMeters(centerLat, west, centerLat, east) / 1000;

  const halfMaxLatDeg = MAX_BBOX_SIDE_KM / 2 / 111; // ~111 km per degree lat
  const halfMaxLonDeg = MAX_BBOX_SIDE_KM / 2 / (111 * Math.cos(toRadians(centerLat)) || 1);

  return [
    heightKm > MAX_BBOX_SIDE_KM ? centerLat - halfMaxLatDeg : south,
    heightKm > MAX_BBOX_SIDE_KM ? centerLat + halfMaxLatDeg : north,
    widthKm > MAX_BBOX_SIDE_KM ? centerLon - halfMaxLonDeg : west,
    widthKm > MAX_BBOX_SIDE_KM ? centerLon + halfMaxLonDeg : east,
  ];
}

/** Generate grid points at 20/50/80% across each axis (avoid the very edges). */
function generateGridPoints(
  bbox: ZoneBbox
): { lat: number; lon: number; row: number; col: number }[] {
  const [south, north, west, east] = bbox;
  const fractions = GRID_SIZE === 3 ? [0.2, 0.5, 0.8] : [0.25, 0.5, 0.75];
  const points: { lat: number; lon: number; row: number; col: number }[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const lat = south + (north - south) * (fractions[row] ?? 0.5);
      const lon = west + (east - west) * (fractions[col] ?? 0.5);
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

// ---------- labels and decoded signal aggregation ----------
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
    .map((w) => (w.length > 0 ? `${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase()}` : w))
    .join(' ');
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
  amenities: ZoneAmenityFeature[],
  places: NamedPlace[],
  centerLat: number,
  centerLon: number,
  clampedBbox: ZoneBbox
): Zone[] {
  if (places.length < PLACE_SCAN_MIN_PLACES) return [];

  // Score every place through the canonical builder. Prominence is an
  // explicit headline-only bonus used to break near-ties during dedupe.
  const cityCenter = { latitude: centerLat, longitude: centerLon };
  const scored = places.map(
    (place, index): Zone =>
      buildScoredZone({
        id: `place-${index}`,
        label: place.name,
        coordinates: { latitude: place.lat, longitude: place.lon },
        cityCenter,
        amenityFeatures: amenities,
        headlineScoreBonus: place.prominence,
      })
  );

  // Dedupe + per-region fairness: process highest-scoring first, skip
  // anything within PLACE_DEDUPE_METERS of a kept zone (suppresses
  // near-duplicate districts covering the same amenities), AND cap each
  // region so dense inner-city scoring doesn't lock outer regions out.
  scored.sort((a, b) => b.score - a.score);
  const kept: Zone[] = [];
  const perRegion = new Map<RegionDirection, number>();
  for (const z of scored) {
    if (z.score <= 0) continue;
    const region = classifyRegion(z.latitude, z.longitude, clampedBbox);
    if ((perRegion.get(region) ?? 0) >= PLACE_MAX_PER_REGION) continue;
    const tooClose = kept.some(
      (k) => haversineMeters(z.latitude, z.longitude, k.latitude, k.longitude) < PLACE_DEDUPE_METERS
    );
    if (tooClose) continue;
    kept.push(z);
    perRegion.set(region, (perRegion.get(region) ?? 0) + 1);
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
  const bbox: ZoneBbox = [
    centerLat - halfDeg,
    centerLat + halfDeg,
    centerLon - halfDeg / Math.cos(toRadians(centerLat)),
    centerLon + halfDeg / Math.cos(toRadians(centerLat)),
  ];
  const overpass = await fetchZoneElements(bbox);
  if (overpass.status === 'unavailable') {
    return buildUnavailableResult(centerLat, centerLon, bbox, true);
  }
  const { amenities, places } = decodeZoneElements(overpass.elements);

  // User's search term wins — they should always see what they queried
  // reflected in the focused zone, not an adjacent OSM place name.
  const label =
    userSearchLabel ??
    nearestPlaceName(centerLat, centerLon, places, ZONE_RADIUS_METERS) ??
    'Central';
  const zone = buildScoredZone({
    id: 'zone-0',
    label,
    coordinates: { latitude: centerLat, longitude: centerLon },
    cityCenter: { latitude: centerLat, longitude: centerLon },
    amenityFeatures: amenities,
  });

  return {
    status: 'ok',
    zones: [zone],
    centroid: { latitude: centerLat, longitude: centerLon },
    bbox,
    singleZone: true,
  };
}

/** Provider failures carry no synthetic zone, so unavailable data cannot masquerade as score 0. */
function buildUnavailableResult(
  centerLat: number,
  centerLon: number,
  bbox: ZoneBbox,
  singleZone: boolean
): ZoneGridResult {
  return {
    status: 'unavailable',
    zones: [],
    centroid: { latitude: centerLat, longitude: centerLon },
    bbox,
    singleZone,
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
  bbox?: ZoneBbox
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
      const diagonalKm = haversineMeters(south, west, north, east) / 1000;
      if (diagonalKm < SMALL_CITY_DIAGONAL_KM) {
        workingBbox = undefined;
      }
    }

    const userSearchLabel = formatUserSearchLabel(city);

    if (!workingBbox) {
      const result = await buildSingleZone(centerLat, centerLon, userSearchLabel);
      const ttl = result.status === 'unavailable' ? FAILURE_CACHE_TTL_MS : CACHE_TTL_MS;
      zoneGridCache.set(key, { result, expiresAt: Date.now() + ttl });
      return result;
    }

    // Clamp around the bbox midpoint, not the geocode point. For wide city
    // bboxes (Greater London, NYC metro) these diverge enough that clamping
    // around the geocode point leaves outer regions uncovered on one side.
    const { lat: clampLat, lon: clampLon } = bboxCenter(workingBbox);
    const clamped = clampBbox(workingBbox, clampLat, clampLon);

    const overpass = await fetchZoneElements(clamped);
    if (overpass.status === 'unavailable') {
      const result = buildUnavailableResult(centerLat, centerLon, clamped, false);
      zoneGridCache.set(key, {
        result,
        expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
      });
      return result;
    }

    const { amenities, places } = decodeZoneElements(overpass.elements);

    // Prefer place-based scanning — scan AT named OSM places (Mayfair,
    // Canary Wharf, Ginza, Polanco, etc.) rather than at fixed grid
    // corners. Falls back to the geometric grid when there aren't enough
    // named places (sparsely-tagged cities / rural bboxes).
    let zones = buildPlaceBasedZones(amenities, places, centerLat, centerLon, clamped);

    if (zones.length < PLACE_SCAN_MIN_PLACES) {
      // Fallback: fixed 3×3 grid, label each point with the nearest place
      // name. Keeps old behaviour for cities where OSM places are sparse.
      const gridPoints = generateGridPoints(clamped);
      const cityCenter = { latitude: centerLat, longitude: centerLon };
      zones = gridPoints.map((gridPoint, index) => {
        const nearName = nearestPlaceName(gridPoint.lat, gridPoint.lon, places, ZONE_RADIUS_METERS);
        return buildScoredZone({
          id: `zone-${index}`,
          label: nearName ?? directionalLabel(gridPoint.row, gridPoint.col),
          coordinates: { latitude: gridPoint.lat, longitude: gridPoint.lon },
          cityCenter,
          amenityFeatures: amenities,
        });
      });
    }

    // User-label override — if the user typed a specific neighborhood,
    // honor it. Two cases, in priority order:
    //   1. A place-based zone already matches the label (modulo case /
    //      apostrophes) → rename to canonical form so downstream lookups
    //      by label find it.
    //   2. The search center sits close enough to a place to be "about"
    //      it → rename the nearest zone.
    if (userSearchLabel) {
      const normalizedUser = normalizeLabel(userSearchLabel);
      const matchIdx = zones.findIndex((z) => normalizeLabel(z.label) === normalizedUser);
      if (matchIdx >= 0) {
        const matchedZone = zones[matchIdx];
        if (matchedZone) zones[matchIdx] = { ...matchedZone, label: userSearchLabel };
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
          const nearestZone = zones[nearestIdx];
          if (nearestZone) zones[nearestIdx] = { ...nearestZone, label: userSearchLabel };
        }
      }
    }

    zones.sort((a, b) => b.score - a.score);

    const result: ZoneGridResult = {
      status: 'ok',
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
