import type { Zone, ZoneAmenities, ZoneArchetype, ZoneLevel } from './zone-contract';

export const DEFAULT_ZONE_RADIUS_METERS = 1_500;

export type ZoneAmenityKey = keyof Omit<ZoneAmenities, 'total'>;

/** One decoded OSM source feature, with every scoring bucket that feature belongs to. */
export interface ZoneAmenityFeature {
  sourceId: string;
  latitude: number;
  longitude: number;
  amenityKeys: readonly ZoneAmenityKey[];
}

export interface ZoneCoordinates {
  latitude: number;
  longitude: number;
}

export interface ZoneAmenityScores {
  score: number;
  wealthScore: number;
  businessScore: number;
  archetype: ZoneArchetype;
  level: ZoneLevel;
}

export interface BuildScoredZoneInput {
  id: string;
  label: string;
  coordinates: ZoneCoordinates;
  cityCenter: ZoneCoordinates;
  amenityFeatures: readonly ZoneAmenityFeature[];
  radiusMeters?: number;
  /** Place prominence affects only the headline score, never either scoring axis. */
  headlineScoreBonus?: number;
}

export function createEmptyZoneAmenities(): ZoneAmenities {
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

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine great-circle distance in meters. */
export function distanceBetweenCoordinatesMeters(
  first: ZoneCoordinates,
  second: ZoneCoordinates
): number {
  const earthRadiusMeters = 6_371_000;
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

/**
 * Count all category memberships inside the radius while counting each OSM
 * source feature once in `total`, even when it belongs to multiple buckets.
 */
export function countZoneAmenitiesWithinRadius(
  amenityFeatures: readonly ZoneAmenityFeature[],
  center: ZoneCoordinates,
  radiusMeters = DEFAULT_ZONE_RADIUS_METERS
): ZoneAmenities {
  const keysBySource = new Map<string, Set<ZoneAmenityKey>>();

  for (const feature of amenityFeatures) {
    const distance = distanceBetweenCoordinatesMeters(center, {
      latitude: feature.latitude,
      longitude: feature.longitude,
    });
    if (distance > radiusMeters) continue;

    const keys = keysBySource.get(feature.sourceId) ?? new Set<ZoneAmenityKey>();
    feature.amenityKeys.forEach((key) => keys.add(key));
    keysBySource.set(feature.sourceId, keys);
  }

  const counts = createEmptyZoneAmenities();
  counts.total = keysBySource.size;
  for (const keys of keysBySource.values()) {
    for (const key of keys) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return counts;
}

/**
 * Log-cap a raw count. The default cap keeps dense zones distinguishable
 * without allowing one extreme cluster to dominate the score.
 */
function logCap(count: number | undefined, cap = 8): number {
  if (!count || count <= 0) return 0;
  return Math.min(cap, Math.log10(count + 1) * 3);
}

function negativesPenalty(counts: ZoneAmenities): number {
  const pawnshops = logCap(counts.pawnshops, 3);
  const moneyLenders = logCap(counts.moneyLenders, 3);
  const socialFacilities = logCap(counts.socialFacilities, 3);
  const charityShops = logCap(counts.charityShops, 3);
  return -6 * pawnshops + -4 * moneyLenders + -4 * socialFacilities + -2 * charityShops;
}

function scoreWealth(counts: ZoneAmenities): number {
  const luxury = logCap(counts.luxuryRetail);
  const professionalServices = logCap(counts.professionalServices);
  const premiumHotels = logCap(counts.premiumHotels);
  const casinos = logCap(counts.casinos);
  const banks = logCap(counts.banks);
  const affluenceSpots = logCap(counts.affluenceSpots);
  const hotels = logCap(counts.hotels);

  const raw =
    5 * luxury +
    3 * premiumHotels +
    2 * affluenceSpots +
    1.5 * banks +
    1.5 * hotels +
    1.5 * casinos +
    professionalServices +
    negativesPenalty(counts);

  return Math.max(0, Math.min(100, Math.round(raw)));
}

function scoreBusiness(counts: ZoneAmenities): number {
  const professionalServices = logCap(counts.professionalServices);
  const corporateOffices = logCap(counts.corporateOffices);
  const banks = logCap(counts.banks);
  const premiumHotels = logCap(counts.premiumHotels);
  const raw =
    5 * professionalServices +
    4.5 * corporateOffices +
    3 * banks +
    2 * premiumHotels +
    negativesPenalty(counts);

  return Math.max(0, Math.min(100, Math.round(raw)));
}

function deriveArchetype(wealthScore: number, businessScore: number): ZoneArchetype {
  if (Math.max(wealthScore, businessScore) < 40) return 'developing';
  if (wealthScore >= 70 && businessScore >= 70) return 'mixed';
  return wealthScore >= businessScore ? 'luxury' : 'corporate';
}

function levelForScore(score: number): ZoneLevel {
  if (score >= 75) return 'premium';
  if (score >= 50) return 'commercial';
  if (score >= 25) return 'moderate';
  return 'developing';
}

/** Score one canonical amenity count set. A headline-only bonus is capped at 100. */
export function scoreZoneAmenities(
  amenities: ZoneAmenities,
  headlineScoreBonus = 0
): ZoneAmenityScores {
  const wealthScore = scoreWealth(amenities);
  const businessScore = scoreBusiness(amenities);
  const score = Math.max(
    0,
    Math.min(100, Math.max(wealthScore, businessScore) + headlineScoreBonus)
  );

  return {
    score,
    wealthScore,
    businessScore,
    archetype: deriveArchetype(wealthScore, businessScore),
    level: levelForScore(score),
  };
}

/** Canonical constructor used by every zone scan mode. */
export function buildScoredZone(input: BuildScoredZoneInput): Zone {
  const radiusMeters = input.radiusMeters ?? DEFAULT_ZONE_RADIUS_METERS;
  const amenities = countZoneAmenitiesWithinRadius(
    input.amenityFeatures,
    input.coordinates,
    radiusMeters
  );
  const scores = scoreZoneAmenities(amenities, input.headlineScoreBonus);

  return {
    id: input.id,
    label: input.label,
    latitude: input.coordinates.latitude,
    longitude: input.coordinates.longitude,
    ...scores,
    amenities,
    radiusMeters,
    distanceFromCenterMeters: distanceBetweenCoordinatesMeters(input.cityCenter, input.coordinates),
  };
}
