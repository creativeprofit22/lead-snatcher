import { describe, expect, test, vi } from 'vitest';

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
vi.mock('@/lib/constants', () => ({ getSearchQuery: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  RATE_LIMITS: { enrich: {}, search: {}, standard: {} },
}));

import { getQueuedLead } from '@/app/api/business/enrich/route';
import { getRegionAt } from '@/app/api/business/neighborhoods/route';
import { getFallbackZoneLabel } from '@/app/api/business/search/route';

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
