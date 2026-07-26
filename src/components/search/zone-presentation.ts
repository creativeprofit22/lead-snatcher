import type { Zone } from '@/lib/business/zone-contract';

const MAX_VISIBLE_ZONE_CHIPS = 7;

const DIRECTIONAL_FALLBACK_LABELS = new Set([
  'SW Quadrant',
  'South',
  'SE Quadrant',
  'West',
  'Central',
  'East',
  'NW Quadrant',
  'North',
  'NE Quadrant',
  'Zone',
]);

export interface VisibleZoneChips {
  visibleZones: Zone[];
  eligibleTotal: number;
}

export function isDirectionalFallbackLabel(label: string): boolean {
  return DIRECTIONAL_FALLBACK_LABELS.has(label);
}

export function selectVisibleZoneChips(
  zones: readonly Zone[],
  focusedZoneId?: string | null
): VisibleZoneChips {
  const eligibleZones = zones
    .filter((zone) => zone.score > 0 && zone.amenities.total > 0)
    .sort((a, b) => b.score - a.score);
  const visibleZones = eligibleZones.slice(0, MAX_VISIBLE_ZONE_CHIPS);
  const focusedZone = focusedZoneId ? zones.find((zone) => zone.id === focusedZoneId) : undefined;

  if (focusedZone && !visibleZones.some((zone) => zone.id === focusedZone.id)) {
    if (visibleZones.length === MAX_VISIBLE_ZONE_CHIPS) {
      visibleZones[MAX_VISIBLE_ZONE_CHIPS - 1] = focusedZone;
    } else {
      visibleZones.push(focusedZone);
    }
  }

  return { visibleZones, eligibleTotal: eligibleZones.length };
}
