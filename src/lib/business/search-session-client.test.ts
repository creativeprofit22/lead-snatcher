import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  decodeSearchCacheBrowserState,
  getLastSearch,
  getPendingLastSearch,
  markLastSearchPending,
  saveLastSearch,
  type SearchCacheBrowserState,
} from '@/lib/search-cache';
import {
  SEARCH_SNAPSHOT_VERSION,
  comparePersistedSearchPayloads,
  decodePersistedSearchPayload,
  hasSameSearchSnapshotIdentity,
  type PersistedSearchPayload,
  type SearchSnapshot,
} from './search-snapshot';
import { createSearchSessionClient, type SearchSessionPayload } from './search-session-client';

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
  businessType: 'retail',
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

function persisted(timestamp = NOW - 1_000, overrides: Partial<SearchSnapshot> = {}) {
  return { ...snapshot, ...overrides, timestamp } satisfies PersistedSearchPayload;
}

function serverResponse(payload: PersistedSearchPayload | null): Response {
  return new Response(
    JSON.stringify({
      data: payload ? { ...payload, updatedAt: new Date(payload.timestamp).toISOString() } : null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function requestBodyText(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new TypeError('Expected a JSON string request body');
  return body;
}

function createMemoryCache(initial: SearchSessionPayload | null = null) {
  let current = initial;
  let pending: PersistedSearchPayload | null = null;

  return {
    cache: {
      get: () => current,
      save: (payload: SearchSnapshot & SearchCacheBrowserState & { timestamp?: number }) => {
        const durable = decodePersistedSearchPayload(payload, Date.now());
        if (!durable) throw new TypeError('Invalid search snapshot');
        current = { ...durable, ...decodeSearchCacheBrowserState(payload) };
      },
      updateEnrichment: (patch: SearchCacheBrowserState) => {
        if (current) current = { ...current, ...patch };
      },
      getPending: () => pending,
      markPending: (payload: PersistedSearchPayload) => {
        pending = payload;
      },
      acknowledge: (accepted: PersistedSearchPayload) => {
        if (pending && comparePersistedSearchPayloads(accepted, pending) >= 0) pending = null;
      },
    },
    read: () => current,
    pending: () => pending,
  };
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('search session client reconciliation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  test('newer server snapshot replaces an older valid local cache', async () => {
    saveLastSearch({
      ...persisted(NOW - 2_000),
      enrichStatusMap: { 'place-1': 'enriched' },
      selectedForEnrich: ['place-1'],
    });
    const newerServer = persisted(NOW - 1_000, { city: 'York' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(serverResponse(newerServer));
    const client = createSearchSessionClient({ fetch: fetcher });

    await expect(client.reconcileServerResume()).resolves.toMatchObject({
      city: 'York',
      payload: expect.not.objectContaining({ selectedForEnrich: expect.anything() }),
    });
    expect(getLastSearch()).toMatchObject({ city: 'York', timestamp: NOW - 1_000 });
    expect(getLastSearch()).not.toHaveProperty('enrichStatusMap');
    expect(fetcher).toHaveBeenCalledWith('/api/business/last-search');
  });

  test('newer local snapshot replaces an older server snapshot and is acknowledged', async () => {
    const newerLocal = persisted(NOW - 1_000, { city: 'York' });
    const olderServer = persisted(NOW - 2_000);
    saveLastSearch(newerLocal);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(serverResponse(olderServer))
      .mockResolvedValueOnce(serverResponse(newerLocal));
    const client = createSearchSessionClient({ fetch: fetcher });

    await expect(client.reconcileServerResume()).resolves.toMatchObject({ city: 'York' });
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/business/last-search');
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      '/api/business/last-search',
      expect.objectContaining({ method: 'POST' })
    );
    expect(getPendingLastSearch()).toBeNull();
  });

  test('failed POST stays pending, then a later reconciliation retries and acknowledges it', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'));
    const client = createSearchSessionClient({ fetch: fetcher });

    client.persistSearch(snapshot);
    await flushPromises();
    const pending = getPendingLastSearch();
    expect(pending).toMatchObject({ city: 'Leeds', timestamp: NOW });
    expect(getLastSearch()).toMatchObject(snapshot);

    fetcher.mockResolvedValueOnce(serverResponse(pending));
    await client.reconcileServerResume();

    expect(fetcher).toHaveBeenLastCalledWith(
      '/api/business/last-search',
      expect.objectContaining({ method: 'POST' })
    );
    expect(getPendingLastSearch()).toBeNull();
  });

  test('offline resume keeps validated local state and its durable retry marker', async () => {
    const local = persisted(NOW - 1_000);
    saveLastSearch(local);
    markLastSearchPending(local);
    const client = createSearchSessionClient({
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
    });

    await expect(client.reconcileServerResume()).resolves.toMatchObject({
      city: 'Leeds',
      payload: local,
    });
    expect(getPendingLastSearch()).toMatchObject(local);
  });

  test('loading a named session promotes one consistent local and durable last-search snapshot', async () => {
    const namedSession = persisted(NOW - 86_400_000, { city: 'York' });
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      const posted = decodePersistedSearchPayload(JSON.parse(requestBodyText(init?.body)));
      return Promise.resolve(serverResponse(posted));
    });
    const replace = vi.fn();
    const client = createSearchSessionClient({ fetch: fetcher });

    client.loadSavedSession(namedSession, replace);
    await flushPromises();

    const promoted = decodePersistedSearchPayload({ ...namedSession, timestamp: NOW });
    expect(promoted).not.toBeNull();
    expect(replace).toHaveBeenCalledWith(promoted);
    expect(getLastSearch()).toMatchObject({ city: 'York', timestamp: NOW });
    expect(JSON.parse(requestBodyText(fetcher.mock.calls[0]?.[1]?.body))).toEqual(promoted);
    expect(getPendingLastSearch()).toBeNull();
  });

  test('two clients converge on the newer accepted snapshot regardless of POST order', async () => {
    const firstCache = createMemoryCache();
    const secondCache = createMemoryCache();
    let accepted: PersistedSearchPayload | null = null;
    const sharedFetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (!init) return serverResponse(accepted);
      const candidate = decodePersistedSearchPayload(JSON.parse(requestBodyText(init.body)));
      if (candidate && (!accepted || comparePersistedSearchPayloads(candidate, accepted) > 0)) {
        accepted = candidate;
      }
      return serverResponse(accepted);
    });
    const firstClient = createSearchSessionClient({
      fetch: sharedFetcher,
      cache: firstCache.cache,
    });
    const secondClient = createSearchSessionClient({
      fetch: sharedFetcher,
      cache: secondCache.cache,
    });

    vi.setSystemTime(NOW - 1);
    firstClient.persistSearch({ ...snapshot, city: 'Leeds' });
    vi.setSystemTime(NOW);
    secondClient.persistSearch({ ...snapshot, city: 'York' });
    await flushPromises();
    await Promise.all([firstClient.reconcileServerResume(), secondClient.reconcileServerResume()]);

    expect(accepted).toMatchObject({ city: 'York', timestamp: NOW });
    expect(firstCache.read()).toMatchObject({ city: 'York', timestamp: NOW });
    expect(secondCache.read()).toMatchObject({ city: 'York', timestamp: NOW });
    expect(firstCache.pending()).toBeNull();
    expect(secondCache.pending()).toBeNull();
  });

  test('browser enrichment survives only when local and server snapshot identities match', async () => {
    const durable = persisted();
    saveLastSearch({
      ...durable,
      enrichStatusMap: { 'place-1': 'enriched' },
      selectedForEnrich: ['place-1'],
    });
    const client = createSearchSessionClient({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(serverResponse(durable)),
    });

    await expect(client.reconcileServerResume()).resolves.toMatchObject({
      payload: {
        enrichStatusMap: { 'place-1': 'enriched' },
        selectedForEnrich: ['place-1'],
      },
    });
    const canonicalDurable = decodePersistedSearchPayload(durable);
    expect(canonicalDurable).not.toBeNull();
    expect(
      hasSameSearchSnapshotIdentity(
        canonicalDurable as PersistedSearchPayload,
        decodePersistedSearchPayload(getLastSearch()) as PersistedSearchPayload
      )
    ).toBe(true);
  });

  test('auto-resume preserves a custom business query instead of its scoring category', () => {
    saveLastSearch({ ...snapshot, businessType: 'HVAC contractors', industry: 'other' });
    const client = createSearchSessionClient({ fetch: vi.fn<typeof fetch>() });

    expect(client.readLocalResume()).toMatchObject({
      businessType: 'HVAC contractors',
      payload: { businessType: 'HVAC contractors', industry: 'other' },
    });
  });

  test('strips incompatible legacy zones before local resume hydration', () => {
    localStorage.setItem(
      LAST_SEARCH_KEY,
      JSON.stringify({
        ...persisted(),
        version: 1,
        zones: [{ id: 'legacy-zone', label: 'Legacy Zone', latitude: 53.8 }],
        focusedZoneId: 'legacy-zone',
      })
    );
    const client = createSearchSessionClient({ fetch: vi.fn<typeof fetch>() });
    const resume = client.readLocalResume();
    const replace = vi.fn();

    expect(resume?.payload).toMatchObject({
      version: SEARCH_SNAPSHOT_VERSION,
      city: 'Leeds',
    });
    expect(resume?.payload).not.toHaveProperty('zones');
    if (resume) client.replaceSession(resume.payload, replace);
    expect(replace).toHaveBeenCalledWith(expect.not.objectContaining({ zones: expect.anything() }));
  });

  test('rejects invalid server timestamps without replacing local state', async () => {
    const local = persisted();
    saveLastSearch(local);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { ...local, timestamp: -1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const client = createSearchSessionClient({ fetch: fetcher });

    await expect(client.reconcileServerResume()).resolves.toMatchObject({ payload: local });
    expect(getLastSearch()).toMatchObject(local);
  });

  test('dismissal survives a same-tab reload without clearing local or server state', () => {
    const durable = persisted();
    saveLastSearch(durable);
    const tabStorage = createMemoryStorage();
    const fetcher = vi.fn<typeof fetch>();
    const firstClient = createSearchSessionClient({ fetch: fetcher, sessionStorage: tabStorage });

    firstClient.dismissResume(durable);
    const reloadedClient = createSearchSessionClient({
      fetch: fetcher,
      sessionStorage: tabStorage,
    });

    expect(reloadedClient.isResumeDismissed(durable)).toBe(true);
    expect(JSON.parse(tabStorage.getItem(DISMISSAL_KEY) ?? '')).toEqual(
      decodePersistedSearchPayload(durable)
    );
    expect(getLastSearch()).toMatchObject(durable);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('dismissal does not carry into a new browser tab', () => {
    const durable = persisted();
    const firstTabClient = createSearchSessionClient({ sessionStorage: createMemoryStorage() });
    const secondTabClient = createSearchSessionClient({ sessionStorage: createMemoryStorage() });

    firstTabClient.dismissResume(durable);

    expect(firstTabClient.isResumeDismissed(durable)).toBe(true);
    expect(secondTabClient.isResumeDismissed(durable)).toBe(false);
  });

  test('a server fallback on a new device is eligible to show', async () => {
    const durable = persisted();
    const memoryCache = createMemoryCache();
    const client = createSearchSessionClient({
      cache: memoryCache.cache,
      fetch: vi.fn<typeof fetch>().mockResolvedValue(serverResponse(durable)),
      sessionStorage: createMemoryStorage(),
    });

    const resume = await client.reconcileServerResume();

    expect(resume).toMatchObject({ city: 'Leeds', payload: durable });
    expect(client.isResumeDismissed(resume!.payload)).toBe(false);
  });

  test('a newly completed search is eligible after the previous search was dismissed', async () => {
    const previous = persisted(NOW - 1_000);
    const memoryCache = createMemoryCache(previous);
    const client = createSearchSessionClient({
      cache: memoryCache.cache,
      fetch: vi.fn<typeof fetch>((_input, init) => {
        const posted = decodePersistedSearchPayload(JSON.parse(requestBodyText(init?.body)));
        return Promise.resolve(serverResponse(posted));
      }),
      sessionStorage: createMemoryStorage(),
    });
    client.dismissResume(previous);

    client.persistSearch({ ...snapshot, city: 'York' });
    await flushPromises();
    const nextResume = client.readLocalResume();

    expect(nextResume).toMatchObject({ city: 'York', payload: { timestamp: NOW } });
    expect(client.isResumeDismissed(nextResume!.payload)).toBe(false);
  });

  test('dismissal matches complete snapshot identity, including same-timestamp snapshots', () => {
    const dismissed = persisted(NOW - 1_000, { city: 'Leeds' });
    const replacement = persisted(NOW - 1_000, { city: 'York' });
    const client = createSearchSessionClient({ sessionStorage: createMemoryStorage() });

    client.dismissResume(dismissed);

    expect(client.isResumeDismissed(dismissed)).toBe(true);
    expect(client.isResumeDismissed(replacement)).toBe(false);
  });

  test('enrichment updates remain browser-only and do not create a durable write', () => {
    saveLastSearch(persisted());
    const client = createSearchSessionClient({ fetch: vi.fn<typeof fetch>() });

    client.updateEnrichment({ selectedForEnrich: ['place-1'] });

    expect(getLastSearch()?.selectedForEnrich).toEqual(['place-1']);
    expect(getPendingLastSearch()).toBeNull();
  });
});
