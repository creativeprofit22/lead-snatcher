import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AppliedBusinessSearch, runBusinessSearch } from '@/lib/business/run-business-search';
import { BusinessSearchError } from '@/lib/business/run-business-search';
import { SEARCH_SNAPSHOT_VERSION, type SearchSnapshot } from '@/lib/business/search-snapshot';
import type { BusinessSearchResult, ScoreBreakdown } from '@/types';
import {
  EMPTY_SEARCH_RESULT_SNAPSHOT,
  useBusinessSearchController,
  type BusinessSearchQuery,
  type SearchNotification,
} from './useBusinessSearchController';

const query: BusinessSearchQuery = {
  businessType: 'retail',
  cacheIndustry: 'retail',
  city: ' London ',
  country: 'gb',
  deepAnalysis: false,
};

const amenities = {
  banks: 1,
  hotels: 0,
  hospitals: 0,
  pharmacies: 0,
  supermarkets: 0,
  fuelStations: 0,
  affluenceSpots: 0,
  total: 1,
};

const zone = {
  id: 'central',
  label: 'Central',
  latitude: 51.5,
  longitude: -0.1,
  score: 70,
  wealthScore: 60,
  businessScore: 70,
  archetype: 'corporate' as const,
  level: 'commercial' as const,
  amenities,
  radiusMeters: 1500,
  distanceFromCenterMeters: 0,
};

const result: BusinessSearchResult = {
  placeId: 'place-1',
  name: 'Example Co',
  photoCount: 1,
  types: ['store'],
  socialLinks: {},
  contactPoints: 2,
  leadScore: 60,
  scoreBreakdown: {} as ScoreBreakdown,
  opportunities: [],
  industryType: 'retail',
};

function applied(overrides: Partial<AppliedBusinessSearch> = {}): AppliedBusinessSearch {
  const cachePayload: SearchSnapshot = {
    version: SEARCH_SNAPSHOT_VERSION,
    results: [result],
    industry: 'retail',
    city: 'London',
    country: 'gb',
    zones: [zone],
    zoneBbox: [51, 52, -1, 0],
    singleZone: false,
    focusedZoneId: zone.id,
    zoneScanStatus: 'ok',
    marketDensity: {
      status: 'ok',
      count: 1,
      level: 'high',
      label: 'Central',
      description: 'Active area',
    },
  };

  return {
    results: cachePayload.results,
    marketDensity: cachePayload.marketDensity ?? null,
    zoneScanStatus: cachePayload.zoneScanStatus ?? 'ok',
    zones: cachePayload.zones ?? [],
    zoneBbox: cachePayload.zoneBbox ?? null,
    singleZone: cachePayload.singleZone ?? false,
    focusedZoneId: cachePayload.focusedZoneId ?? null,
    cachePayload,
    notification: { type: 'success', message: 'Found 1 businesses' },
    shouldReveal: true,
    shouldPersist: true,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(runSearch = vi.fn<typeof runBusinessSearch>()) {
  const notify = vi.fn<(notification: SearchNotification) => void>();
  const persistSearch = vi.fn<(snapshot: SearchSnapshot) => void>();
  const hook = renderHook(() => useBusinessSearchController({ query, runSearch, notify }));
  return { ...hook, runSearch, notify, persistSearch };
}

afterEach(() => cleanup());

describe('useBusinessSearchController', () => {
  test('moves initial success from scanning to revealing to results', async () => {
    const pending = deferred<AppliedBusinessSearch>();
    const harness = setup(vi.fn<typeof runBusinessSearch>().mockReturnValue(pending.promise));

    let search!: Promise<void>;
    act(() => {
      search = harness.result.current.runInitialSearch(harness.persistSearch);
    });
    expect(harness.result.current).toMatchObject({
      viewMode: 'search',
      isSearching: true,
      radarPhase: 'scanning',
    });

    pending.resolve(applied());
    await act(async () => search);

    expect(harness.result.current).toMatchObject({
      viewMode: 'search',
      isSearching: false,
      radarPhase: 'revealing',
      searchResults: [result],
      focusedZoneId: 'central',
    });
    expect(harness.persistSearch).toHaveBeenCalledTimes(1);
    expect(harness.runSearch).toHaveBeenCalledWith({
      businessType: 'retail',
      cacheIndustry: 'retail',
      city: 'London',
      country: 'gb',
      deepAnalysis: false,
      mode: { kind: 'initial' },
    });

    act(() => harness.result.current.completeRadar());
    expect(harness.result.current).toMatchObject({ viewMode: 'results', radarPhase: 'off' });
  });

  test('keeps an empty initial response on search view and does not persist it', async () => {
    const empty = applied({
      results: [],
      cachePayload: { ...applied().cachePayload, results: [] },
      notification: { type: 'error', message: 'No businesses returned', duration: 8000 },
      shouldReveal: false,
      shouldPersist: false,
    });
    const harness = setup(vi.fn<typeof runBusinessSearch>().mockResolvedValue(empty));

    await act(async () => harness.result.current.runInitialSearch(harness.persistSearch));

    expect(harness.result.current).toMatchObject({
      viewMode: 'search',
      radarPhase: 'off',
      isSearching: false,
      searchResults: [],
      searchBannerError: {
        message: 'No businesses returned',
        severity: 'error',
        isAuthError: false,
      },
    });
    expect(harness.persistSearch).not.toHaveBeenCalled();
    expect(harness.notify).toHaveBeenCalledWith(empty.notification);
  });

  test.each([
    {
      label: '401',
      error: new BusinessSearchError('Log in again', 401, 'http'),
      isAuthError: true,
      duration: undefined,
    },
    {
      label: 'timeout',
      error: new BusinessSearchError('Sweep timed out', null, 'timeout'),
      isAuthError: false,
      duration: 10_000,
    },
  ])('maps $label failures into the existing banner and toast behavior', async (scenario) => {
    const harness = setup(vi.fn<typeof runBusinessSearch>().mockRejectedValue(scenario.error));

    await act(async () => harness.result.current.runInitialSearch(harness.persistSearch));

    expect(harness.result.current).toMatchObject({
      viewMode: 'search',
      radarPhase: 'off',
      isSearching: false,
      searchBannerError: {
        message: scenario.error.message,
        severity: 'error',
        isAuthError: scenario.isAuthError,
      },
    });
    expect(harness.notify).toHaveBeenCalledWith({
      type: 'error',
      message: scenario.error.message,
      duration: scenario.duration,
    });
  });

  test('applies a zone rescan atomically and cleans its busy state', async () => {
    const pending = deferred<AppliedBusinessSearch>();
    const zoneResult = applied({
      focusedZoneId: 'west',
      notification: { type: 'success', message: 'Scanning West End — 1 found' },
    });
    const harness = setup(vi.fn<typeof runBusinessSearch>().mockReturnValue(pending.promise));
    act(() => harness.result.current.hydrateSnapshot(applied().cachePayload));

    const west = { ...zone, id: 'west', label: 'West End' };
    let rescan!: Promise<void>;
    act(() => {
      rescan = harness.result.current.rescanZone(west, harness.persistSearch);
    });
    expect(harness.result.current.rescanningZoneId).toBe('west');

    pending.resolve(zoneResult);
    await act(async () => rescan);

    expect(harness.result.current).toMatchObject({
      viewMode: 'results',
      rescanningZoneId: null,
      focusedZoneId: 'west',
      searchResults: [result],
    });
    expect(harness.persistSearch).toHaveBeenCalledWith(zoneResult.cachePayload);
    expect(harness.runSearch).toHaveBeenCalledWith({
      businessType: 'retail',
      cacheIndustry: 'retail',
      city: 'London',
      country: 'gb',
      deepAnalysis: false,
      mode: {
        kind: 'zone',
        zone: west,
        currentZones: [zone],
        currentZoneBbox: [51, 52, -1, 0],
        currentSingleZone: false,
      },
    });
  });

  test('zone failures only toast and always clear the zone busy state', async () => {
    const harness = setup(
      vi
        .fn<typeof runBusinessSearch>()
        .mockRejectedValue(new BusinessSearchError('Zone rescan failed', 500, 'http'))
    );
    act(() => harness.result.current.hydrateSnapshot(applied().cachePayload));

    await act(async () =>
      harness.result.current.rescanZone(
        { ...zone, id: 'west', label: 'West End' },
        harness.persistSearch
      )
    );

    expect(harness.result.current.rescanningZoneId).toBeNull();
    expect(harness.result.current.searchBannerError).toBeNull();
    expect(harness.notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'Zone rescan failed',
    });
  });

  test('cleans initial busy state after an unexpected failure', async () => {
    const harness = setup(vi.fn<typeof runBusinessSearch>().mockRejectedValue(new Error('boom')));

    await act(async () => harness.result.current.runInitialSearch(harness.persistSearch));

    expect(harness.result.current.isSearching).toBe(false);
    expect(harness.result.current.radarPhase).toBe('off');
  });

  test('hydrates legacy snapshots with absent optional fields into coherent defaults', () => {
    const harness = setup();
    act(() => harness.result.current.hydrateSnapshot(applied().cachePayload));

    act(() =>
      harness.result.current.hydrateSnapshot({
        version: SEARCH_SNAPSHOT_VERSION,
        results: [],
        industry: 'retail',
        city: 'Leeds',
        country: 'gb',
      })
    );

    expect(harness.result.current).toMatchObject({
      viewMode: 'results',
      searchResults: [],
      marketDensity: null,
      zones: [],
      zoneBbox: null,
      singleZone: false,
      focusedZoneId: null,
    });
  });

  test('reset clears exactly the previous result and zone fields', async () => {
    const emptyWithBanner = applied({
      results: [],
      notification: { type: 'error', message: 'No businesses returned' },
      shouldReveal: false,
      shouldPersist: false,
    });
    const harness = setup(vi.fn<typeof runBusinessSearch>().mockResolvedValue(emptyWithBanner));
    act(() => harness.result.current.hydrateSnapshot(applied().cachePayload));
    await act(async () => harness.result.current.runInitialSearch(harness.persistSearch));

    act(() => harness.result.current.resetSearch());

    expect(harness.result.current).toMatchObject({
      viewMode: 'search',
      ...EMPTY_SEARCH_RESULT_SNAPSHOT,
      rescanningZoneId: null,
      searchBannerError: {
        message: 'No businesses returned',
        severity: 'error',
        isAuthError: false,
      },
    });
  });
});
