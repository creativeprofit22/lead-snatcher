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
import { getRegionAt } from '@/app/api/business/neighborhoods/route';
import { getFallbackZoneLabel } from '@/app/api/business/search/route';
import { HttpError, parseRouteBody, routeErrorResponse } from '@/lib/route-utils';

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

  test('preserves valid city labels and defaults empty or missing labels', () => {
    expect(getFallbackZoneLabel(' Sydney, New South Wales ')).toBe('Sydney');
    expect(getFallbackZoneLabel('')).toBe('Area');
    expect(getFallbackZoneLabel('   ')).toBe('Area');
    expect(getFallbackZoneLabel(undefined)).toBe('Area');
    expect(getFallbackZoneLabel(null)).toBe('Area');
  });
});
