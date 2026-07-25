import { describe, expect, test, vi } from 'vitest';
import { applyBusinessSearchResponse, runBusinessSearch } from './run-business-search';
import type { Zone } from './zone-grid';

const amenities = {
  banks: 1,
  hotels: 2,
  hospitals: 0,
  pharmacies: 1,
  supermarkets: 2,
  fuelStations: 1,
  affluenceSpots: 0,
  total: 7,
};

function zone(id: string, label: string): Zone {
  return {
    id,
    label,
    latitude: 51.5,
    longitude: -0.2,
    score: 70,
    wealthScore: 60,
    businessScore: 80,
    archetype: 'mixed',
    level: 'commercial',
    amenities,
    radiusMeters: 1500,
    distanceFromCenterMeters: 0,
  };
}

const result = {
  placeId: 'place-1',
  name: 'Example Co',
  photoCount: 1,
  types: ['store'],
  socialLinks: {},
  contactPoints: 2,
  leadScore: 60,
  scoreBreakdown: {},
  opportunities: [],
  industryType: 'retail',
};

function response(zones: Zone[], results: unknown[] = [result]) {
  return {
    results,
    marketDensity: {
      count: results.length,
      level: 'high',
      label: zones[0]?.label ?? 'Area',
      description: 'Active commercial area',
      amenities,
    },
    zones,
    zoneBbox: [51, -1, 52, 0],
    singleZone: false,
  };
}

describe('runBusinessSearch', () => {
  test('initial mode focuses the typed zone, waits for the scan floor, and builds its cache', async () => {
    const zones = [zone('top', 'Central'), zone('typed', 'Shepherds Bush')];
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response(zones)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    const applied = await runBusinessSearch(
      {
        businessType: 'retail',
        cacheIndustry: 'retail',
        city: 'shepherds bush',
        country: 'gb',
        deepAnalysis: false,
        mode: { kind: 'initial' },
      },
      { fetch: fetcher, now: () => 100, sleep }
    );

    expect(sleep).toHaveBeenCalledWith(900);
    expect(applied.focusedZoneId).toBe('typed');
    expect(applied.shouldReveal).toBe(true);
    expect(applied.notification).toEqual({ type: 'success', message: 'Found 1 businesses' });
    expect(applied.cachePayload).toMatchObject({ focusedZoneId: 'typed', zones });
    const initialRequest = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(initialRequest.body as string)).not.toHaveProperty('searchLat');
    expect(initialRequest.signal).toBeInstanceOf(AbortSignal);
  });

  test('zone mode keeps initial single-zone state, targets coordinates, and uses zone notifications', async () => {
    const selectedZone = zone('west', 'West End');
    const originalZones = [selectedZone, zone('east', 'East End')];
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response([], [])), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const applied = await runBusinessSearch(
      {
        businessType: 'retail',
        cacheIndustry: 'retail',
        city: 'London',
        country: 'gb',
        deepAnalysis: false,
        mode: {
          kind: 'zone',
          zone: selectedZone,
          currentZones: originalZones,
          currentZoneBbox: [50, -2, 53, 1],
          currentSingleZone: true,
        },
      },
      { fetch: fetcher }
    );

    expect(applied).toMatchObject({
      focusedZoneId: 'west',
      zones: originalZones,
      singleZone: true,
      shouldReveal: false,
      notification: { type: 'info', message: 'No businesses in West End' },
    });
    const zoneRequest = fetcher.mock.calls[0]?.[1] as RequestInit;
    const request = JSON.parse(zoneRequest.body as string);
    expect(request).toMatchObject({ searchLat: 51.5, searchLng: -0.2, zoneLabel: 'West End' });
    expect(zoneRequest.signal).toBeUndefined();
  });

  test('rejects malformed successful responses before they reach page state', () => {
    expect(() =>
      applyBusinessSearchResponse(
        { results: 'not-an-array' },
        {
          businessType: 'retail',
          cacheIndustry: 'retail',
          city: 'London',
          country: 'gb',
          deepAnalysis: false,
          mode: { kind: 'initial' },
        }
      )
    ).toThrow('invalid response');
  });
});
