import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getLastSearch, saveLastSearch } from '@/lib/search-cache';
import {
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
  type SearchSnapshot,
} from './search-snapshot';
import { createSearchSessionClient } from './search-session-client';

const NOW = 1_725_000_123_456;
const LAST_SEARCH_KEY = 'lead-snatcher-last-search';
const DISMISSAL_KEY = 'lead-snatcher-resume-dismissed';

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
      scoreBreakdown: {},
      opportunities: [],
      industryType: 'retail',
    } as unknown as SearchSnapshot['results'][number],
  ],
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
  zones: [],
  zoneBbox: [53.6, 54.0, -1.8, -1.3],
  singleZone: false,
  focusedZoneId: null,
  marketDensity: {
    count: 1,
    level: 'moderate',
    label: 'Leeds',
    description: 'One result in the current area',
  },
};

const persisted: PersistedSearchPayload = {
  ...snapshot,
  timestamp: NOW - 1_000,
};

function serverResponse(payload: PersistedSearchPayload = persisted): Response {
  return new Response(
    JSON.stringify({
      data: { ...payload, updatedAt: new Date(payload.timestamp).toISOString() },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('search session client persistence policy', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  test('a valid local cache suppresses the server GET', async () => {
    saveLastSearch(snapshot);
    const fetcher = vi.fn<typeof fetch>();
    const client = createSearchSessionClient({ fetch: fetcher });

    expect(client.readLocalResume()).toMatchObject({ city: 'Leeds', resultCount: 1 });
    await expect(client.fetchServerResumeIfLocalMissing()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('strips incompatible pre-v2 zones before local resume hydration', () => {
    localStorage.setItem(
      LAST_SEARCH_KEY,
      JSON.stringify({
        ...persisted,
        version: 1,
        zones: [
          {
            id: 'legacy-zone',
            label: 'Legacy Zone',
            latitude: 53.8,
            longitude: -1.55,
            score: 70,
            level: 'commercial',
            amenities: { total: 2 },
            radiusMeters: 1_500,
            distanceFromCenterMeters: 0,
          },
        ],
        focusedZoneId: 'legacy-zone',
      })
    );
    const client = createSearchSessionClient({ fetch: vi.fn<typeof fetch>() });
    const resume = client.readLocalResume();
    const hydrate = vi.fn();

    expect(resume?.payload).toMatchObject({
      version: SEARCH_SNAPSHOT_VERSION,
      results: persisted.results,
      city: 'Leeds',
    });
    expect(resume?.payload).not.toHaveProperty('zones');
    expect(resume?.payload).not.toHaveProperty('marketDensity');
    expect(resume?.payload).not.toHaveProperty('zoneBbox');
    expect(resume?.payload).not.toHaveProperty('focusedZoneId');

    if (resume) client.applySnapshot(resume.payload, hydrate);
    expect(hydrate).toHaveBeenCalledWith(expect.not.objectContaining({ zones: expect.anything() }));
  });

  test.each(['missing', 'stale'] as const)(
    '%s local cache uses the server fallback',
    async (cacheState) => {
      if (cacheState === 'stale') {
        localStorage.setItem(
          LAST_SEARCH_KEY,
          JSON.stringify({ ...persisted, timestamp: NOW - 2 * 60 * 60 * 1_000 - 1 })
        );
      }
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(serverResponse());
      const client = createSearchSessionClient({ fetch: fetcher });

      await expect(client.fetchServerResumeIfLocalMissing()).resolves.toMatchObject({
        city: 'Leeds',
        resultCount: 1,
        payload: persisted,
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledWith('/api/business/last-search');
    }
  );

  test('local save happens before the fire-and-forget POST', () => {
    const events: string[] = [];
    const fetcher = vi.fn<typeof fetch>(() => {
      events.push('post');
      return new Promise<Response>(() => {});
    });
    const client = createSearchSessionClient({
      fetch: fetcher,
      cache: {
        get: getLastSearch,
        save(payload) {
          events.push('local');
          saveLastSearch(payload);
        },
        updateEnrichment: vi.fn(),
      },
    });

    client.persistSearch(snapshot);

    expect(events).toEqual(['local', 'post']);
    expect(getLastSearch()).toMatchObject(snapshot);
  });

  test('POST rejection is silent and preserves local results', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const client = createSearchSessionClient({ fetch: fetcher });

    client.persistSearch(snapshot);
    await Promise.resolve();

    expect(getLastSearch()).toMatchObject(snapshot);
  });

  test('dismissal is tab-scoped and does not clear local or server state', () => {
    saveLastSearch(snapshot);
    const fetcher = vi.fn<typeof fetch>();
    const client = createSearchSessionClient({ fetch: fetcher });

    client.dismissResume();

    expect(sessionStorage.getItem(DISMISSAL_KEY)).toBe('1');
    expect(getLastSearch()).toMatchObject(snapshot);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('resume and named-session payloads use one hydration command', () => {
    const hydrate = vi.fn();
    const client = createSearchSessionClient({ fetch: vi.fn<typeof fetch>() });

    client.applySnapshot(persisted, hydrate);
    client.applySnapshot({ ...persisted, city: 'York' }, hydrate);

    expect(hydrate).toHaveBeenNthCalledWith(1, persisted);
    expect(hydrate).toHaveBeenNthCalledWith(2, { ...persisted, city: 'York' });
    expect(getLastSearch()).toMatchObject({ city: 'York', results: persisted.results });
  });
});
