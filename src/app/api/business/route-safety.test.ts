import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/business', () => ({
  geocodeCity: vi.fn(),
  scanCityZones: vi.fn(),
  searchBusinesses: vi.fn(),
}));
vi.mock('@/lib/business/enrichment', () => ({
  discoverSocials: vi.fn(),
  discoverWebsite: vi.fn(),
}));
vi.mock('@/lib/business/enrichment-cache', () => ({
  getEnrichmentMany: vi.fn(),
  putEnrichment: vi.fn(),
}));
vi.mock('@/lib/business/pagespeed-key', () => ({ getPageSpeedKey: vi.fn() }));
vi.mock('@/lib/business/budget-estimate', () => ({
  buildBudgetInput: vi.fn(),
  computeFitScore: vi.fn(),
  estimateBudget: vi.fn(),
}));
vi.mock('@/lib/constants', () => ({ DEFAULT_COUNTRY_CODE: 'us', getSearchQuery: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  RATE_LIMITS: { enrich: {}, search: {}, standard: {} },
}));

import { getQueuedLead } from '@/app/api/business/enrich/route';
import { getFallbackZoneLabel, selectFocusedZone } from '@/app/api/business/search/route';
import type { Zone, ZoneBbox } from '@/lib/business/zone-contract';
import { classifyRegion, getRegionAt } from '@/lib/business/zone-regions';
import { HttpError, parseRouteBody, routeErrorResponse } from '@/lib/route-utils';

function searchZone(
  id: string,
  label: string,
  latitude: number,
  longitude: number,
  score: number
): Zone {
  return {
    id,
    label,
    latitude,
    longitude,
    score,
    wealthScore: score,
    businessScore: score,
    archetype: 'mixed',
    level: 'commercial',
    amenities: {
      banks: 0,
      hotels: 0,
      hospitals: 0,
      pharmacies: 0,
      supermarkets: 0,
      fuelStations: 0,
      affluenceSpots: 0,
      total: 0,
    },
    radiusMeters: 1500,
    distanceFromCenterMeters: 0,
  };
}

describe('route request safety helpers', () => {
  test('maps malformed JSON to a 400 response', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      body: '{',
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseRouteBody(request, z.object({ name: z.string() }))).rejects.toEqual(
      expect.objectContaining({ message: 'Invalid JSON body', status: 400 })
    );
  });

  test('maps schema failures to a 400 response', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      body: JSON.stringify({ name: 1 }),
      headers: { 'content-type': 'application/json' },
    });

    await expect(parseRouteBody(request, z.object({ name: z.string() }))).rejects.toEqual(
      expect.objectContaining({ status: 400 })
    );
  });

  test('maps typed HTTP errors and hides unexpected failures', async () => {
    const unauthorized = routeErrorResponse(new HttpError('Unauthorized', 401), 'Fallback');
    const unexpected = routeErrorResponse(new Error('database secret'), 'Fallback');

    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(unexpected.status).toBe(500);
    await expect(unexpected.json()).resolves.toEqual({ error: 'Fallback' });
  });
});

describe('business route strict-safety helpers', () => {
  test('returns a queued lead unchanged for a valid index', () => {
    const lead = { businessId: 'business-1' };

    expect(getQueuedLead([lead], 0)).toBe(lead);
  });

  test('returns undefined for missing and out-of-range queued leads', () => {
    const sparseLeads = Array<{ businessId: string }>(1);

    expect(getQueuedLead(sparseLeads, 0)).toBeUndefined();
    expect(getQueuedLead([{ businessId: 'business-1' }], 4)).toBeUndefined();
  });

  test('preserves valid region-grid responses', () => {
    const regions = [
      ['sw', 's', 'se'],
      ['w', 'central', 'e'],
      ['nw', 'n', 'ne'],
    ] as const;

    expect(getRegionAt(regions, 0, 0)).toBe('sw');
    expect(getRegionAt(regions, 1, 1)).toBe('central');
    expect(getRegionAt(regions, 2, 2)).toBe('ne');
  });

  test('uses central for empty or out-of-range region cells', () => {
    expect(getRegionAt([], 0, 0)).toBe('central');
    expect(getRegionAt([[]], 0, 2)).toBe('central');
    expect(getRegionAt([['n']], 3, 0)).toBe('central');
  });

  test.each([
    [0.5, 0.5, 'sw'],
    [0.5, 1.5, 's'],
    [0.5, 2.5, 'se'],
    [1.5, 0.5, 'w'],
    [1.5, 1.5, 'central'],
    [1.5, 2.5, 'e'],
    [2.5, 0.5, 'nw'],
    [2.5, 1.5, 'n'],
    [2.5, 2.5, 'ne'],
  ])('classifies bbox cell at lat %s and lon %s as %s', (lat, lon, expected) => {
    const bbox: ZoneBbox = [0, 3, 0, 3];

    expect(classifyRegion(lat, lon, bbox)).toBe(expected);
  });

  test('assigns exact one-third and two-third boundaries to the next region', () => {
    const bbox: ZoneBbox = [0, 3, 0, 3];

    expect(classifyRegion(1, 0.5, bbox)).toBe('w');
    expect(classifyRegion(2, 0.5, bbox)).toBe('nw');
    expect(classifyRegion(0.5, 1, bbox)).toBe('s');
    expect(classifyRegion(0.5, 2, bbox)).toBe('se');
    expect(classifyRegion(1, 1, bbox)).toBe('central');
    expect(classifyRegion(2, 2, bbox)).toBe('ne');
  });

  test('preserves valid city labels and defaults empty or missing labels', () => {
    expect(getFallbackZoneLabel(' Sydney, New South Wales ')).toBe('Sydney');
    expect(getFallbackZoneLabel('')).toBe('Area');
    expect(getFallbackZoneLabel('   ')).toBe('Area');
    expect(getFallbackZoneLabel(undefined)).toBe('Area');
    expect(getFallbackZoneLabel(null)).toBe('Area');
  });

  test('focuses the zone nearest the initial Maps center when it ranks second', () => {
    const topZone = searchZone('top', 'Top Scorer', 51.7, -0.3, 95);
    const centeredZone = searchZone('centered', 'Typed Area', 51.5001, -0.1001, 70);

    expect(
      selectFocusedZone([topZone, centeredZone], { latitude: 51.5, longitude: -0.1 })?.id
    ).toBe('centered');
  });

  test('falls back to the zone nearest the targeted center when its label is absent', () => {
    const topZone = searchZone('top', 'Top Scorer', 51.7, -0.3, 95);
    const centeredZone = searchZone('centered', 'Nearby Area', 51.5001, -0.1001, 70);

    expect(
      selectFocusedZone(
        [topZone, centeredZone],
        { latitude: 51.5, longitude: -0.1 },
        'Missing Target'
      )?.id
    ).toBe('centered');
  });
});
