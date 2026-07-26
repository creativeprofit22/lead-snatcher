import type { Zone, ZoneBbox } from '@/lib/business/zone-contract';
import type { BusinessSearchResult } from '@/types';
import { isDirectionalFallbackLabel } from './zone-presentation';

export const RADAR_SIZE = 500;
export const RADAR_CENTER = RADAR_SIZE / 2;
export const RADAR_RADIUS = RADAR_CENTER - 24;
export const MAX_RADAR_PINS = 60;

const RADAR_PROJECTION_SCALE = 0.85;
const LABELED_ZONE_COUNT = 3;

export interface RadarCoordinate {
  latitude?: number;
  longitude?: number;
}

export interface RadarPoint {
  x: number;
  y: number;
}

export interface RadarPin extends RadarPoint {
  key: string;
  angle: number;
}

export interface RadarZoneDot extends RadarPoint {
  id: string;
  label: string;
  score: number;
  labeled: boolean;
}

type RadarPinSource = Pick<BusinessSearchResult, 'placeId' | 'latitude' | 'longitude'>;
type RadarZoneSource = Pick<Zone, 'id' | 'label' | 'score' | 'latitude' | 'longitude'>;

function hasFiniteCoordinates(
  point: RadarCoordinate
): point is { latitude: number; longitude: number } {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

function polarAngle(x: number, y: number): number {
  const radians = Math.atan2(y - RADAR_CENTER, x - RADAR_CENTER);
  const degrees = (radians * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** Calculate [south, north, west, east] bounds, ignoring invalid coordinates. */
export function calculatePointBbox(points: readonly RadarCoordinate[]): ZoneBbox | null {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  for (const point of points) {
    if (!hasFiniteCoordinates(point)) continue;
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
  }

  return Number.isFinite(south) ? [south, north, west, east] : null;
}

/** Project a geographic coordinate into radar SVG space. */
export function projectPointToRadar(
  latitude: number,
  longitude: number,
  bbox: ZoneBbox
): RadarPoint | null {
  if (![latitude, longitude, ...bbox].every(Number.isFinite)) return null;

  const [south, north, west, east] = bbox;
  const latitudeSpan = north - south;
  const longitudeSpan = east - west;
  const normalizedX = longitudeSpan === 0 ? 0.5 : (longitude - west) / longitudeSpan;
  const normalizedY = latitudeSpan === 0 ? 0.5 : 1 - (latitude - south) / latitudeSpan;

  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) return null;

  const offsetX = (normalizedX - 0.5) * 2;
  const offsetY = (normalizedY - 0.5) * 2;
  const magnitude = Math.min(1, Math.hypot(offsetX, offsetY));
  const radians = Math.atan2(offsetY, offsetX);
  const radius = magnitude * RADAR_RADIUS * RADAR_PROJECTION_SCALE;
  const x = RADAR_CENTER + Math.cos(radians) * radius;
  const y = RADAR_CENTER + Math.sin(radians) * radius;

  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/** Return whether a clockwise sweep crossed a target angle, including wrap-around at 360°. */
export function crossedAngle(previous: number, current: number, target: number): boolean {
  if (![previous, current, target].every(Number.isFinite)) return false;
  if (current >= previous) return target > previous && target <= current;
  return target > previous || target <= current;
}

/** Build score-ordered zone dots without mutating the source zone array. */
export function buildZoneDots(
  zones: readonly RadarZoneSource[],
  bbox: ZoneBbox | null,
  focusedZoneId: string | null
): RadarZoneDot[] {
  if (!bbox) return [];

  const projectedZones = zones.flatMap((zone) => {
    const point = projectPointToRadar(zone.latitude, zone.longitude, bbox);
    return point ? [{ zone, point }] : [];
  });
  projectedZones.sort((a, b) => b.zone.score - a.zone.score);

  const nameableZones = projectedZones.filter(
    ({ zone }) => !isDirectionalFallbackLabel(zone.label)
  );
  const labeledIds = new Set(nameableZones.slice(0, LABELED_ZONE_COUNT).map(({ zone }) => zone.id));
  if (focusedZoneId) labeledIds.add(focusedZoneId);

  return projectedZones.map(({ zone, point }) => ({
    id: zone.id,
    label: zone.label,
    score: zone.score,
    ...point,
    labeled: labeledIds.has(zone.id),
  }));
}

/** Build coordinate-projected pins when possible, otherwise use the deterministic spiral. */
export function buildRadarPins(
  results: readonly RadarPinSource[],
  bbox: ZoneBbox | null
): RadarPin[] {
  if (results.length === 0) return [];

  if (bbox) {
    const projectedPins: RadarPin[] = [];
    for (const result of results) {
      if (projectedPins.length >= MAX_RADAR_PINS) break;
      if (!hasFiniteCoordinates(result)) continue;
      const point = projectPointToRadar(result.latitude, result.longitude, bbox);
      if (!point) continue;
      projectedPins.push({
        key: result.placeId,
        ...point,
        angle: polarAngle(point.x, point.y),
      });
    }
    if (projectedPins.length > 0) return projectedPins;
  }

  return results.slice(0, MAX_RADAR_PINS).map((result, index) => {
    const radians = (index / results.length) * Math.PI * 2;
    const distance = 0.35 + ((index * 37) % 55) / 100;
    const x = RADAR_CENTER + Math.cos(radians) * RADAR_RADIUS * distance;
    const y = RADAR_CENTER + Math.sin(radians) * RADAR_RADIUS * distance;
    return {
      key: result.placeId,
      x,
      y,
      angle: polarAngle(x, y),
    };
  });
}
