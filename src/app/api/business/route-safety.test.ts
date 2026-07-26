import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const {
  authMock,
  businessSearchCreateMock,
  checkRateLimitMock,
  geocodeCityMock,
  getClientIpMock,
  getEnrichmentManyMock,
  getPageSpeedKeyMock,
  getSearchQueryMock,
  scanCityZonesMock,
  searchBusinessesMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  businessSearchCreateMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  geocodeCityMock: vi.fn(),
  getClientIpMock: vi.fn(),
  getEnrichmentManyMock: vi.fn(),
  getPageSpeedKeyMock: vi.fn(),
  getSearchQueryMock: vi.fn(),
  scanCityZonesMock: vi.fn(),
  searchBusinessesMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/db', () => ({
  prisma: { businessSearch: { create: businessSearchCreateMock } },
}));
vi.mock('@/lib/business', () => ({
  geocodeCity: geocodeCityMock,
  scanCityZones: scanCityZonesMock,
  searchBusinesses: searchBusinessesMock,
}));
vi.mock('@/lib/business/enrichment', () => ({
  discoverSocials: vi.fn(),
  discoverWebsite: vi.fn(),
}));
vi.mock('@/lib/business/enrichment-cache', () => ({
  getEnrichmentMany: getEnrichmentManyMock,
  putEnrichment: vi.fn(),
}));
vi.mock('@/lib/business/pagespeed-key', () => ({ getPageSpeedKey: getPageSpeedKeyMock }));
vi.mock('@/lib/business/budget-estimate', () => ({
  buildBudgetInput: vi.fn(),
  computeFitScore: vi.fn(),
  estimateBudget: vi.fn(),
}));
vi.mock('@/lib/constants', () => ({
  DEFAULT_COUNTRY_CODE: 'us',
  getSearchQuery: getSearchQueryMock,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
  getClientIp: getClientIpMock,
  RATE_LIMITS: { enrich: {}, search: {}, standard: {} },
}));

import { getQueuedLead, POST as enrichBusinesses } from '@/app/api/business/enrich/route';
import {
  getFallbackZoneLabel,
  POST as searchBusinesses,
  selectFocusedZone,
} from '@/app/api/business/search/route';
import type { Zone, ZoneBbox } from '@/lib/business/zone-contract';
import { classifyRegion, getRegionAt } from '@/lib/business/zone-regions';
import { ApiError } from '@/lib/errors';
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

function enrichmentRequest(body: BodyInit = JSON.stringify(validEnrichmentBody())) {
  return new NextRequest('http://localhost/api/business/enrich', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

function validEnrichmentBody() {
  return {
    leads: [
      {
        businessId: 'business-1',
        name: 'Business One',
        needsWebsite: true,
        needsSocials: true,
      },
    ],
    city: 'London',
    country: 'GB',
  };
}

function searchRequest(body: BodyInit = JSON.stringify(validSearchBody())) {
  return new NextRequest('http://localhost/api/business/search', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

function validSearchBody() {
  return {
    businessType: 'restaurant',
    city: 'London',
    country: 'GB',
    limit: 10,
    deepAnalysis: false,
  };
}

describe('business enrich POST pre-stream safety', () => {
  beforeEach(() => {
    authMock.mockReset();
    getEnrichmentManyMock.mockReset();
  });

  test('preserves the unauthorized JSON response', async () => {
    authMock.mockResolvedValue(null);

    const response = await enrichBusinesses(enrichmentRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  test('preserves malformed JSON and schema validation responses', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });

    const malformed = await enrichBusinesses(enrichmentRequest('{'));
    const invalid = await enrichBusinesses(
      enrichmentRequest(JSON.stringify({ ...validEnrichmentBody(), leads: [] }))
    );

    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Invalid JSON' });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: 'At least one lead is required' });
  });

  test.each([
    ['auth', () => authMock.mockRejectedValue(new Error('auth secret'))],
    [
      'cache lookup',
      () => {
        authMock.mockResolvedValue({ user: { id: 'user-1' } });
        getEnrichmentManyMock.mockRejectedValue(new Error('cache secret'));
      },
    ],
  ])('maps unexpected %s failures to safe endpoint JSON', async (_source, rejectDependency) => {
    rejectDependency();

    const response = await enrichBusinesses(enrichmentRequest());

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({ error: 'Failed to start enrichment' });
  });

  test('returns the successful NDJSON stream unchanged with cached rows first', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    getEnrichmentManyMock.mockResolvedValue(
      new Map([['business-1', { website: 'https://cached.example' }]])
    );

    const response = await enrichBusinesses(enrichmentRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    await expect(response.text()).resolves.toBe(
      '{"businessId":"business-1","status":"cached","website":"https://cached.example"}\n'
    );
  });
});

describe('business search POST safety', () => {
  beforeEach(() => {
    authMock.mockReset();
    businessSearchCreateMock.mockReset();
    checkRateLimitMock.mockReset();
    geocodeCityMock.mockReset();
    getClientIpMock.mockReset();
    getPageSpeedKeyMock.mockReset();
    getSearchQueryMock.mockReset();
    scanCityZonesMock.mockReset();
    searchBusinessesMock.mockReset();

    authMock.mockResolvedValue({ user: { id: 'route-user' } });
    checkRateLimitMock.mockReturnValue({ success: true });
    getClientIpMock.mockReturnValue('127.0.0.1');
    getSearchQueryMock.mockReturnValue('restaurants');
  });

  test.each([
    ['malformed JSON', '{', { error: 'Invalid JSON body' }],
    [
      'schema-invalid JSON',
      JSON.stringify({ ...validSearchBody(), businessType: '' }),
      { error: 'Business type is required' },
    ],
  ])('returns 400 for %s before external work', async (_case, body, expectedBody) => {
    const response = await searchBusinesses(searchRequest(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expectedBody);
    expect(geocodeCityMock).not.toHaveBeenCalled();
    expect(getPageSpeedKeyMock).not.toHaveBeenCalled();
    expect(searchBusinessesMock).not.toHaveBeenCalled();
    expect(scanCityZonesMock).not.toHaveBeenCalled();
    expect(businessSearchCreateMock).not.toHaveBeenCalled();
  });

  test('returns 401 when authentication is missing', async () => {
    authMock.mockResolvedValue(null);

    const response = await searchBusinesses(searchRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(geocodeCityMock).not.toHaveBeenCalled();
  });

  test('preserves ApiError status and code', async () => {
    geocodeCityMock.mockResolvedValue({
      latitude: 51.5,
      longitude: -0.1,
      bbox: [51.4, 51.6, -0.2, 0],
      displayName: 'London, UK',
    });
    searchBusinessesMock.mockRejectedValue(
      new ApiError('Provider quota exhausted', 'PROVIDER_QUOTA', 429)
    );
    scanCityZonesMock.mockResolvedValue({ status: 'unavailable', zones: [] });

    const response = await searchBusinesses(searchRequest());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Provider quota exhausted',
      code: 'PROVIDER_QUOTA',
    });
  });

  test('uses the authenticated user ID for PageSpeed, providers, and persistence', async () => {
    geocodeCityMock.mockResolvedValue({
      latitude: 51.5,
      longitude: -0.1,
      bbox: [51.4, 51.6, -0.2, 0],
      displayName: 'London, UK',
    });
    getPageSpeedKeyMock.mockResolvedValue('pagespeed-key');
    searchBusinessesMock.mockResolvedValue([]);
    scanCityZonesMock.mockResolvedValue({ status: 'unavailable', zones: [] });
    businessSearchCreateMock.mockResolvedValue({});

    const response = await searchBusinesses(
      searchRequest(JSON.stringify({ ...validSearchBody(), deepAnalysis: true }))
    );

    expect(response.status).toBe(200);
    expect(getPageSpeedKeyMock).toHaveBeenCalledWith('route-user');
    expect(searchBusinessesMock).toHaveBeenCalledWith(
      'route-user',
      'restaurants',
      51.5,
      -0.1,
      10,
      expect.objectContaining({ pageSpeedApiKey: 'pagespeed-key' })
    );
    expect(businessSearchCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'route-user' }),
    });
  });

  test('maps unknown failures to the current safe 500 response', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockRejectedValue(new Error('auth secret'));

    const response = await searchBusinesses(searchRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Search failed. Please try again.',
    });
    consoleError.mockRestore();
  });
});

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
