import { describe, expect, test, vi } from 'vitest';
import type { BusinessSearchResult } from '@/types';
import { createScoreBreakdown } from './score-breakdown-contract';
import {
  applyBusinessSearchResponse,
  BusinessSearchError,
  runBusinessSearch,
} from './run-business-search';
import type { Zone, ZoneAmenities } from './zone-contract';

const legacyAmenities = {
  banks: 1,
  hotels: 2,
  hospitals: 0,
  pharmacies: 1,
  supermarkets: 2,
  fuelStations: 1,
  affluenceSpots: 0,
  total: 7,
} satisfies ZoneAmenities;

const amenities = {
  ...legacyAmenities,
  luxuryRetail: 3,
  professionalServices: 4,
  premiumHotels: 5,
  casinos: 6,
  corporateOffices: 7,
  pawnshops: 8,
  moneyLenders: 9,
  socialFacilities: 10,
  charityShops: 11,
} satisfies ZoneAmenities;

function zone(id: string, label: string, zoneAmenities: ZoneAmenities = amenities): Zone {
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
    amenities: zoneAmenities,
    radiusMeters: 1500,
    distanceFromCenterMeters: 0,
  };
}

const currentScoreBreakdown = createScoreBreakdown({
  noWebsite: 20,
  noPhone: 10,
  qualityChips: ['No website'],
  hasMarketingBudget: true,
  marketingPlatforms: ['Google Ads'],
  demandSignal: 'high',
  demandLabel: 'Strong review volume',
});

const result = {
  placeId: 'place-1',
  name: 'Example Co',
  photoCount: 1,
  types: ['store'],
  socialLinks: {},
  contactPoints: 2,
  leadScore: 60,
  scoreBreakdown: currentScoreBreakdown,
  opportunities: [],
  industryType: 'retail',
} satisfies BusinessSearchResult;

function response(
  zones: Zone[],
  focusedZoneId: string | null = zones[0]?.id ?? 'zone-fallback',
  results: unknown[] = [result],
  marketAmenities: ZoneAmenities = amenities
) {
  return {
    results,
    marketDensity: {
      status: 'ok',
      count: results.length,
      level: 'high',
      label: zones[0]?.label ?? 'Area',
      description: 'Active commercial area',
      amenities: marketAmenities,
    },
    zoneScanStatus: 'ok',
    zones,
    zoneBbox: [51, -1, 52, 0],
    singleZone: false,
    focusedZoneId,
  };
}

describe('runBusinessSearch', () => {
  test('initial mode persists the server-focused second-ranked zone and builds its cache', async () => {
    const zones = [zone('top', 'Central'), zone('typed', 'Shepherds Bush')];
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response(zones, 'typed')), {
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
    expect(applied.cachePayload).toMatchObject({
      focusedZoneId: 'typed',
      zoneScanStatus: 'ok',
      zones,
    });
    const initialRequest = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(initialRequest.body as string)).not.toHaveProperty('searchLat');
    expect(initialRequest.signal).toBeInstanceOf(AbortSignal);
  });

  test('accepts and preserves a complete current score breakdown', () => {
    const applied = applyBusinessSearchResponse(response([zone('central', 'Central')]), {
      businessType: 'retail',
      cacheIndustry: 'retail',
      city: 'London',
      country: 'gb',
      deepAnalysis: false,
      mode: { kind: 'initial' },
    });

    expect(applied.results[0]?.scoreBreakdown).toEqual(currentScoreBreakdown);
    expect(applied.cachePayload.results[0]?.scoreBreakdown).toEqual(currentScoreBreakdown);
  });

  test('accepts unknown future score keys without exposing them to UI state', () => {
    const futureResult = {
      ...result,
      scoreBreakdown: { ...currentScoreBreakdown, futureSignal: 15 },
    };

    const applied = applyBusinessSearchResponse(
      response([zone('central', 'Central')], undefined, [futureResult]),
      {
        businessType: 'retail',
        cacheIndustry: 'retail',
        city: 'London',
        country: 'gb',
        deepAnalysis: false,
        mode: { kind: 'initial' },
      }
    );

    expect(applied.results[0]?.scoreBreakdown).toEqual(currentScoreBreakdown);
    expect(applied.results[0]?.scoreBreakdown).not.toHaveProperty('futureSignal');
  });

  test('rejects malformed live score breakdown fields through the safe error path', () => {
    const malformedResult = {
      ...result,
      scoreBreakdown: { ...currentScoreBreakdown, noWebsite: '20' },
    };

    expect(() =>
      applyBusinessSearchResponse(
        response([zone('central', 'Central')], undefined, [malformedResult]),
        {
          businessType: 'retail',
          cacheIndustry: 'retail',
          city: 'London',
          country: 'gb',
          deepAnalysis: false,
          mode: { kind: 'initial' },
        }
      )
    ).toThrowError(
      expect.objectContaining<Partial<BusinessSearchError>>({
        kind: 'invalid-response',
        message: expect.stringContaining('invalid response'),
      })
    );
  });

  test('preserves every v2 and negative amenity field in state and cache payloads', () => {
    const applied = applyBusinessSearchResponse(response([zone('central', 'Central')]), {
      businessType: 'retail',
      cacheIndustry: 'retail',
      city: 'London',
      country: 'gb',
      deepAnalysis: false,
      mode: { kind: 'initial' },
    });

    expect(applied.zones[0]?.amenities).toEqual(amenities);
    expect(applied.marketDensity?.amenities).toEqual(amenities);
    expect(applied.cachePayload.zones?.[0]?.amenities).toEqual(amenities);
    expect(applied.cachePayload.marketDensity?.amenities).toEqual(amenities);
  });

  test('accepts responses created before optional v2 amenity fields existed', () => {
    const legacyZone = zone('legacy', 'Legacy Area', legacyAmenities);
    const applied = applyBusinessSearchResponse(
      response([legacyZone], 'legacy', [result], legacyAmenities),
      {
        businessType: 'retail',
        cacheIndustry: 'retail',
        city: 'London',
        country: 'gb',
        deepAnalysis: false,
        mode: { kind: 'initial' },
      }
    );

    expect(applied.zones[0]?.amenities).toEqual(legacyAmenities);
    expect(applied.marketDensity?.amenities).toEqual(legacyAmenities);
  });

  test('zone mode keeps initial single-zone state, targets coordinates, and uses zone notifications', async () => {
    const selectedZone = zone('west', 'West End');
    const originalZones = [selectedZone, zone('east', 'East End')];
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response([], null, [])), {
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

  test('accepts unavailable area scans without requiring a focused zone or numeric density', () => {
    const rawResponse = {
      ...response([], null),
      zoneScanStatus: 'unavailable',
      marketDensity: {
        status: 'unavailable',
        count: 1,
        level: 'unavailable',
        label: 'London',
        description: 'Area scan unavailable. Retry the search.',
      },
    };

    const applied = applyBusinessSearchResponse(rawResponse, {
      businessType: 'retail',
      cacheIndustry: 'retail',
      city: 'London',
      country: 'gb',
      deepAnalysis: false,
      mode: { kind: 'initial' },
    });

    expect(applied).toMatchObject({
      zoneScanStatus: 'unavailable',
      focusedZoneId: null,
      zones: [],
      marketDensity: {
        status: 'unavailable',
        level: 'unavailable',
        description: expect.stringContaining('Retry'),
      },
    });
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

  test('rejects unknown zone archetypes before they reach page state', () => {
    const rawResponse = response([zone('central', 'Central')]);
    const firstZone = rawResponse.zones[0];
    if (!firstZone) throw new Error('Expected response fixture zone');
    (firstZone as { archetype: string }).archetype = 'unknown';

    expect(() =>
      applyBusinessSearchResponse(rawResponse, {
        businessType: 'retail',
        cacheIndustry: 'retail',
        city: 'London',
        country: 'gb',
        deepAnalysis: false,
        mode: { kind: 'initial' },
      })
    ).toThrow('invalid response');
  });
});
