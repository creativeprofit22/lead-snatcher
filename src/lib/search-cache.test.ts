import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createScoreBreakdown } from '@/lib/business/score-breakdown-contract';
import {
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
  type SearchSnapshot,
} from '@/lib/business/search-snapshot';
import {
  SEARCH_CACHE_TTL_MS,
  SEARCH_CACHE_VERSION,
  getLastSearch,
  saveLastSearch,
  updateLastSearchEnrichment,
  type SearchCacheEnvelope,
} from './search-cache';

const NOW = 1_725_000_123_456;
const LAST_SEARCH_KEY = 'lead-snatcher-last-search';

const snapshot: SearchSnapshot = {
  version: SEARCH_SNAPSHOT_VERSION,
  results: [
    {
      placeId: 'place-1',
      name: 'Example Co',
      photoCount: 1,
      types: ['store'],
      socialLinks: {},
      contactPoints: 2,
      leadScore: 60,
      scoreBreakdown: createScoreBreakdown({ noWebsite: 20 }),
      opportunities: [],
      industryType: 'retail',
    },
  ],
  businessType: 'retail',
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
};

function persisted(timestamp = NOW - 60 * 60 * 1000): PersistedSearchPayload {
  return { ...snapshot, timestamp };
}

function envelope(overrides: Partial<SearchCacheEnvelope> = {}): SearchCacheEnvelope {
  return {
    version: SEARCH_CACHE_VERSION,
    snapshot: persisted(),
    browserState: {},
    cachedAt: NOW,
    expiresAt: NOW + SEARCH_CACHE_TTL_MS,
    ...overrides,
  };
}

function store(value: unknown): void {
  localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('search cache envelope', () => {
  test('stores a versioned envelope and preserves an existing search timestamp', () => {
    saveLastSearch({
      ...snapshot,
      timestamp: NOW - 30 * 60 * 1000,
      selectedForEnrich: ['place-1'],
    });

    expect(JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) ?? '{}')).toEqual({
      version: SEARCH_CACHE_VERSION,
      snapshot: persisted(NOW - 30 * 60 * 1000),
      browserState: { selectedForEnrich: ['place-1'] },
      cachedAt: NOW,
      expiresAt: NOW + SEARCH_CACHE_TTL_MS,
    });
    expect(getLastSearch()?.timestamp).toBe(NOW - 30 * 60 * 1000);
  });

  test.each([
    ['selection', { selectedForEnrich: 42 }],
    ['status map', { enrichStatusMap: { 'place-1': 'complete' } }],
    ['result map', { enrichResultMap: { 'place-1': { cached: 'yes' } } }],
  ])('strips a malformed %s while keeping a valid core resumable', (_label, corruptState) => {
    store(
      envelope({
        browserState: {
          enrichStatusMap: { 'place-1': 'enriched' },
          ...corruptState,
        } as SearchCacheEnvelope['browserState'],
      })
    );

    const cached = getLastSearch();

    expect(cached).toMatchObject({ city: 'Leeds', results: snapshot.results });
    if ('enrichStatusMap' in corruptState) expect(cached).not.toHaveProperty('enrichStatusMap');
    else expect(cached?.enrichStatusMap).toEqual({ 'place-1': 'enriched' });
    if ('enrichResultMap' in corruptState) expect(cached).not.toHaveProperty('enrichResultMap');
    if ('selectedForEnrich' in corruptState) expect(cached).not.toHaveProperty('selectedForEnrich');
  });

  test('strips unknown browser result fields but retains validated values', () => {
    store(
      envelope({
        browserState: {
          enrichResultMap: {
            'place-1': {
              website: 'https://example.com',
              cached: true,
              futureField: 'discard me',
            },
          },
        } as unknown as SearchCacheEnvelope['browserState'],
      })
    );

    expect(getLastSearch()?.enrichResultMap).toEqual({
      'place-1': { website: 'https://example.com', cached: true },
    });
  });

  test('evicts an invalid durable core instead of hydrating it', () => {
    store(envelope({ snapshot: { ...persisted(), results: 'broken' } as never }));

    expect(getLastSearch()).toBeNull();
    expect(localStorage.getItem(LAST_SEARCH_KEY)).toBeNull();
  });

  test.each([
    ['negative cachedAt', { cachedAt: -1 }],
    ['future cachedAt', { cachedAt: NOW + 1, expiresAt: NOW + 1 + SEARCH_CACHE_TTL_MS }],
    ['out-of-range expiresAt', { expiresAt: 8_640_000_000_000_001 }],
    ['mismatched expiry', { expiresAt: NOW + SEARCH_CACHE_TTL_MS + 1 }],
  ])('evicts cache metadata with %s', (_label, metadata) => {
    store(envelope(metadata));

    expect(getLastSearch()).toBeNull();
    expect(localStorage.getItem(LAST_SEARCH_KEY)).toBeNull();
  });

  test('uses expiresAt for TTL without treating an old search as stale', () => {
    store(envelope({ snapshot: persisted(NOW - 24 * 60 * 60 * 1000) }));

    expect(getLastSearch()?.timestamp).toBe(NOW - 24 * 60 * 60 * 1000);

    vi.setSystemTime(NOW + SEARCH_CACHE_TTL_MS);
    expect(getLastSearch()).toBeNull();
  });

  test('mount and enrichment patches preserve search age and cache lifetime', () => {
    store(envelope({ snapshot: persisted(NOW - 45 * 60 * 1000) }));
    const before = JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) ?? '{}') as SearchCacheEnvelope;

    vi.setSystemTime(NOW + 15 * 60 * 1000);
    updateLastSearchEnrichment({
      enrichStatusMap: {},
      enrichResultMap: {},
      selectedForEnrich: [],
    });
    const afterMount = JSON.parse(
      localStorage.getItem(LAST_SEARCH_KEY) ?? '{}'
    ) as SearchCacheEnvelope;
    expect(afterMount.snapshot.timestamp).toBe(before.snapshot.timestamp);
    expect(afterMount.cachedAt).toBe(before.cachedAt);
    expect(afterMount.expiresAt).toBe(before.expiresAt);

    vi.setSystemTime(NOW + 30 * 60 * 1000);
    updateLastSearchEnrichment({
      enrichStatusMap: { 'place-1': 'enriched' },
      enrichResultMap: { 'place-1': { website: 'https://example.com' } },
      selectedForEnrich: ['place-1'],
    });

    const after = JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) ?? '{}') as SearchCacheEnvelope;
    expect(after.snapshot.timestamp).toBe(before.snapshot.timestamp);
    expect(after.cachedAt).toBe(before.cachedAt);
    expect(after.expiresAt).toBe(before.expiresAt);
    expect(getLastSearch()).toMatchObject({
      enrichStatusMap: { 'place-1': 'enriched' },
      selectedForEnrich: ['place-1'],
    });
  });

  test('migrates a valid legacy flat cache into the envelope', () => {
    const legacyTimestamp = NOW - 60 * 60 * 1000;
    store({
      ...persisted(legacyTimestamp),
      selectedForEnrich: ['place-1'],
    });

    expect(getLastSearch()?.selectedForEnrich).toEqual(['place-1']);
    expect(JSON.parse(localStorage.getItem(LAST_SEARCH_KEY) ?? '{}')).toMatchObject({
      version: SEARCH_CACHE_VERSION,
      snapshot: { timestamp: legacyTimestamp },
      browserState: { selectedForEnrich: ['place-1'] },
      cachedAt: legacyTimestamp,
      expiresAt: legacyTimestamp + SEARCH_CACHE_TTL_MS,
    });
  });
});
