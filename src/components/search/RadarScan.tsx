'use client';

import { useMemo } from 'react';
import type { Zone, ZoneBbox } from '@/lib/business/zone-contract';
import type { BusinessSearchResult } from '@/types';
import { buildRadarPins, buildZoneDots, calculatePointBbox } from './radar-geometry';
import { RadarViewport } from './RadarViewport';
import { useRadarScanSequence } from './useRadarScanSequence';

interface RadarScanProps {
  city: string;
  results: BusinessSearchResult[] | null;
  zones?: Zone[] | null;
  /** [south, north, west, east], used to place both zones and pins consistently. */
  zoneBbox?: ZoneBbox | null;
  focusedZoneId: string | null;
  singleZone?: boolean;
  onComplete?: () => void;
}

export function RadarScan({
  city,
  results,
  zones,
  zoneBbox,
  focusedZoneId,
  singleZone,
  onComplete,
}: RadarScanProps) {
  const effectiveBbox = useMemo<ZoneBbox | null>(() => {
    if (zoneBbox) return zoneBbox;
    if (zones && zones.length > 0) {
      const zoneBounds = calculatePointBbox(zones);
      if (zoneBounds) return zoneBounds;
    }
    return results && results.length > 0 ? calculatePointBbox(results) : null;
  }, [results, zoneBbox, zones]);

  const zoneDots = useMemo(
    () => buildZoneDots(zones ?? [], effectiveBbox, focusedZoneId),
    [effectiveBbox, focusedZoneId, zones]
  );
  const pins = useMemo(
    () => buildRadarPins(results ?? [], effectiveBbox),
    [effectiveBbox, results]
  );
  const sequenceKey = useMemo(
    () =>
      JSON.stringify({
        results: results?.map((result) => result.placeId) ?? null,
        zones: (zones ?? []).map((zone) => zone.id),
      }),
    [results, zones]
  );
  const { phase, bloomedCount, litPinIds } = useRadarScanSequence({
    sequenceKey,
    resultsPending: results === null,
    zoneDots,
    pins,
    onComplete,
  });

  return (
    <RadarViewport
      city={city}
      phase={phase}
      bloomedCount={bloomedCount}
      litPinIds={litPinIds}
      pins={pins}
      zoneDots={zoneDots}
      focusedZoneId={focusedZoneId}
      singleZone={singleZone}
    />
  );
}
