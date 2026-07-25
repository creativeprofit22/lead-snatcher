import type { ZoneBbox } from './zone-contract';

export type RegionDirection = 'nw' | 'n' | 'ne' | 'w' | 'central' | 'e' | 'sw' | 's' | 'se';

/** Geographic lookup rows ordered from south to north. */
export const REGION_CLASSIFICATION_GRID = [
  ['sw', 's', 'se'],
  ['w', 'central', 'e'],
  ['nw', 'n', 'ne'],
] as const satisfies readonly (readonly RegionDirection[])[];

/** Picker rows ordered from north to south for screen display. */
export const REGION_DISPLAY_LAYOUT = [
  ['nw', 'n', 'ne'],
  ['w', 'central', 'e'],
  ['sw', 's', 'se'],
] as const satisfies readonly (readonly RegionDirection[])[];

/** Stable north-to-south order used for API responses and display. */
export const REGION_ORDER: readonly RegionDirection[] = REGION_DISPLAY_LAYOUT.flat();

export const REGION_LABELS = {
  nw: 'Northwest',
  n: 'North',
  ne: 'Northeast',
  w: 'West',
  central: 'Central',
  e: 'East',
  sw: 'Southwest',
  s: 'South',
  se: 'Southeast',
} as const satisfies Record<RegionDirection, string>;

export const REGION_SHORT_LABELS = {
  nw: 'NW',
  n: 'N',
  ne: 'NE',
  w: 'W',
  central: 'Central',
  e: 'E',
  sw: 'SW',
  s: 'S',
  se: 'SE',
} as const satisfies Record<RegionDirection, string>;

export function getRegionAt(
  grid: readonly (readonly RegionDirection[])[],
  latIndex: number,
  lonIndex: number
): RegionDirection {
  return grid[latIndex]?.[lonIndex] ?? 'central';
}

/** Classify a point into one of nine regions within a bounding box. */
export function classifyRegion(lat: number, lon: number, bbox: ZoneBbox): RegionDirection {
  const [south, north, west, east] = bbox;
  const latThird = (north - south) / 3;
  const lonThird = (east - west) / 3;
  const latIndex = lat < south + latThird ? 0 : lat < south + 2 * latThird ? 1 : 2;
  const lonIndex = lon < west + lonThird ? 0 : lon < west + 2 * lonThird ? 1 : 2;

  return getRegionAt(REGION_CLASSIFICATION_GRID, latIndex, lonIndex);
}
