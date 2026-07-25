import { afterEach, describe, expect, test, vi } from 'vitest';

import { estimateBudget } from './budget-estimate';
import { runBatch } from './enrichment';
import { geocodeCity } from './geocode';
import { scrapePopularTimes } from './popular-times';
import { clearZoneGridCache, scanCityZones } from './zone-grid';
import { classifyZoneTags, ZONE_TAG_TO_AMENITY_KEY } from './zone-osm-signals';
import { buildZoneOverpassQuery, fetchZoneElements, type OverpassFetch } from './zone-overpass';
import {
  buildScoredZone,
  countZoneAmenitiesWithinRadius,
  createEmptyZoneAmenities,
  distanceBetweenCoordinatesMeters,
  scoreZoneAmenities,
} from './zone-scoring';

function mockFetchResponse(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: vi.fn().mockResolvedValue(body),
      text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    })
  );
}

function overpassResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function popularTimesResponse(rawWeekly: unknown[]): string {
  const popularity: Record<number, unknown> = {
    0: rawWeekly,
    7: [null, 63],
  };
  const info: Record<number, unknown> = {
    84: popularity,
    117: ['20–40 min'],
  };
  return JSON.stringify({ 0: { 1: { 0: { 14: info } } } });
}

afterEach(() => {
  clearZoneGridCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('business strict indexed-access and null safety', () => {
  test('handles an empty geocoding response', async () => {
    mockFetchResponse([]);

    await expect(geocodeCity('Nowhere')).resolves.toBeNull();
  });

  test('ignores a malformed geocoding bounding box', async () => {
    mockFetchResponse([
      {
        lat: '-33.8688',
        lon: '151.2093',
        display_name: 'Sydney, Australia',
        boundingbox: ['bad', '-33.5', '150.5', '151.5'],
      },
    ]);

    await expect(geocodeCity('Sydney')).resolves.toMatchObject({
      latitude: -33.8688,
      longitude: 151.2093,
      bbox: undefined,
    });
  });

  test('preserves a valid four-edge geocoding bounding box', async () => {
    mockFetchResponse([
      {
        lat: '-33.8688',
        lon: '151.2093',
        display_name: 'Sydney, Australia',
        boundingbox: ['-34.2', '-33.5', '150.5', '151.5'],
        address: { country_code: 'au' },
      },
    ]);

    await expect(geocodeCity('Sydney')).resolves.toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
      displayName: 'Sydney, Australia',
      country: 'AU',
      bbox: [-34.2, -33.5, 150.5, 151.5],
    });
  });

  test('runs empty, boundary-sized, and undefined-valued batches in input order', async () => {
    const worker = vi.fn(async (item: number | undefined, index: number) => `${index}:${item}`);

    await expect(runBatch([], worker, 2)).resolves.toEqual([]);
    await expect(runBatch([undefined, 7], worker, 1)).resolves.toEqual(['0:undefined', '1:7']);
  });

  test('rejects a malformed popular-times response', async () => {
    mockFetchResponse('not-json');

    await expect(scrapePopularTimes('Malformed Place')).resolves.toMatchObject({
      ok: false,
      failure: { reason: 'response_unparseable' },
    });
  });

  test('ignores out-of-range hours and preserves valid boundary hours', async () => {
    mockFetchResponse(
      popularTimesResponse([
        [
          1,
          [
            [-1, 10],
            [0, 20],
            [23, 80],
            [24, 90],
            ['bad', 50],
          ],
        ],
      ])
    );

    const result = await scrapePopularTimes('Valid Place');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.weekly[0]?.[0]).toBe(20);
    expect(result.data.weekly[0]?.[23]).toBe(80);
    expect(result.data.weekly[0]).toHaveLength(24);
    expect(result.data.currentPopularity).toBe(63);
    expect(result.data.timeSpent).toBe('20–40 min');
  });

  test('classifies every queried zone tag into its declared amenity bucket', () => {
    for (const [tagName, fixtures] of Object.entries(ZONE_TAG_TO_AMENITY_KEY)) {
      for (const [tagValue, expectedKey] of Object.entries(fixtures)) {
        expect(
          classifyZoneTags({ [tagName]: tagValue }),
          `${tagName}=${tagValue} should map to ${expectedKey}`
        ).toBe(expectedKey);
      }
    }
  });

  test('builds query tag coverage from the classification mapping', () => {
    const query = buildZoneOverpassQuery([51.4, 51.6, -0.2, 0]);

    for (const [tagName, fixtures] of Object.entries(ZONE_TAG_TO_AMENITY_KEY)) {
      const values = Object.keys(fixtures).join('|');
      expect(query).toContain(`["${tagName}"~"^(${values})$"]`);
    }
  });

  test('rejects an empty 200 and accepts the first mirror with elements', async () => {
    const fetchRequest: OverpassFetch = vi.fn(async (input) =>
      overpassResponse({
        elements:
          String(input) === 'valid'
            ? [{ type: 'node', id: 7, lat: 51.5, lon: -0.1, tags: { amenity: 'bank' } }]
            : [],
      })
    );

    await expect(
      fetchZoneElements([51.4, 51.6, -0.2, 0], {
        fetch: fetchRequest,
        mirrors: ['empty', 'valid'],
        logger: { error: vi.fn() },
      })
    ).resolves.toMatchObject({ status: 'ok', elements: [expect.objectContaining({ id: 7 })] });
  });

  test('aborts slower mirror requests after the first valid response', async () => {
    const slowerSignals: AbortSignal[] = [];
    const fetchRequest: OverpassFetch = vi.fn((input, init) => {
      if (String(input) === 'winner') {
        return Promise.resolve(
          overpassResponse({ elements: [{ type: 'node', id: 11, lat: 51.5, lon: -0.1 }] })
        );
      }

      const signal = init?.signal;
      if (!signal) throw new Error('Expected an abort signal');
      slowerSignals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });

    const result = await fetchZoneElements([51.4, 51.6, -0.2, 0], {
      fetch: fetchRequest,
      mirrors: ['slow-one', 'winner', 'slow-two'],
      logger: { error: vi.fn() },
    });

    expect(result).toMatchObject({ status: 'ok', elements: [expect.objectContaining({ id: 11 })] });
    expect(slowerSignals).toHaveLength(2);
    expect(slowerSignals.every((signal) => signal.aborted)).toBe(true);
  });

  test('soft-returns unavailable when every injected mirror request fails', async () => {
    const fetchRequest: OverpassFetch = vi.fn(async () => overpassResponse({}, false, 503));

    const result = await fetchZoneElements([51.4, 51.6, -0.2, 0], {
      fetch: fetchRequest,
      mirrors: ['failed-one', 'failed-two'],
      logger: { error: vi.fn() },
    });

    expect(result).toEqual({ status: 'unavailable', elements: [] });
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  test('includes amenities exactly on the scan radius and excludes those beyond it', () => {
    const center = { latitude: 0, longitude: 0 };
    const boundaryPoint = { latitude: 0, longitude: 0.01 };
    const radiusMeters = distanceBetweenCoordinatesMeters(center, boundaryPoint);

    const counts = countZoneAmenitiesWithinRadius(
      [
        {
          sourceId: 'node:boundary',
          ...boundaryPoint,
          amenityKeys: ['banks'],
        },
        {
          sourceId: 'node:outside',
          latitude: 0,
          longitude: 0.010_001,
          amenityKeys: ['hotels'],
        },
      ],
      center,
      radiusMeters
    );

    expect(counts).toMatchObject({ banks: 1, hotels: 0, total: 1 });
  });

  test.each([
    { score: 24, level: 'developing' },
    { score: 25, level: 'moderate' },
    { score: 50, level: 'commercial' },
    { score: 75, level: 'premium' },
  ] as const)('keeps the $score zone threshold at $level', ({ score, level }) => {
    expect(scoreZoneAmenities(createEmptyZoneAmenities(), score)).toMatchObject({ score, level });
  });

  test('caps the place prominence headline bonus without changing either score axis', () => {
    const input = {
      id: 'place-1',
      label: 'Landmark',
      coordinates: { latitude: 51.5, longitude: -0.1 },
      cityCenter: { latitude: 51.5, longitude: -0.1 },
      amenityFeatures: [
        {
          sourceId: 'node:1',
          latitude: 51.5,
          longitude: -0.1,
          amenityKeys: ['luxuryRetail'] as const,
        },
      ],
    };

    const baseline = buildScoredZone(input);
    const promoted = buildScoredZone({ ...input, headlineScoreBonus: 1_000 });

    expect(promoted.score).toBe(100);
    expect(promoted.wealthScore).toBe(baseline.wealthScore);
    expect(promoted.businessScore).toBe(baseline.businessScore);
  });

  test('produces equivalent scoring in place, grid, and single-zone modes', async () => {
    const center = { latitude: 51.5, longitude: -0.1 };
    const premiumHotel = {
      type: 'node',
      id: 100,
      lat: center.latitude,
      lon: center.longitude,
      tags: { tourism: 'hotel', stars: '5' },
    };
    const places = [
      { id: 1, lat: center.latitude, lon: center.longitude, name: 'Center' },
      { id: 2, lat: center.latitude + 0.009, lon: center.longitude, name: 'North' },
      { id: 3, lat: center.latitude - 0.009, lon: center.longitude, name: 'South' },
      { id: 4, lat: center.latitude, lon: center.longitude + 0.014, name: 'East' },
    ].map((place) => ({
      type: 'node',
      id: place.id,
      lat: place.lat,
      lon: place.lon,
      tags: { place: 'neighbourhood', name: place.name },
    }));

    mockFetchResponse({ elements: [premiumHotel, ...places] });
    const placeResult = await scanCityZones(
      'Place City',
      'gb',
      center.latitude,
      center.longitude,
      [51.4, 51.6, -0.2, 0]
    );

    mockFetchResponse({ elements: [premiumHotel] });
    const gridResult = await scanCityZones(
      'Grid City',
      'gb',
      center.latitude,
      center.longitude,
      [51.4, 51.6, -0.2, 0]
    );

    mockFetchResponse({ elements: [premiumHotel] });
    const singleResult = await scanCityZones(
      'Single City',
      'gb',
      center.latitude,
      center.longitude
    );

    const centerZone = placeResult.zones.find(
      (zone) => zone.latitude === center.latitude && zone.longitude === center.longitude
    );
    const gridCenterZone = gridResult.zones.find(
      (zone) => zone.latitude === center.latitude && zone.longitude === center.longitude
    );
    const singleZone = singleResult.zones[0];
    const scoringOutput = (zone: NonNullable<typeof centerZone>) => ({
      score: zone.score,
      wealthScore: zone.wealthScore,
      businessScore: zone.businessScore,
      archetype: zone.archetype,
      level: zone.level,
      amenities: zone.amenities,
      radiusMeters: zone.radiusMeters,
      distanceFromCenterMeters: zone.distanceFromCenterMeters,
    });

    expect(centerZone?.id).toBe('place-0');
    expect(gridCenterZone?.id).toBe('zone-4');
    expect(singleZone?.id).toBe('zone-0');
    expect(scoringOutput(gridCenterZone!)).toEqual(scoringOutput(centerZone!));
    expect(scoringOutput(singleZone!)).toEqual(scoringOutput(centerZone!));
    expect(centerZone?.amenities).toMatchObject({ hotels: 1, premiumHotels: 1, total: 1 });
  });

  test('omits every zone-derived budget point when the area scan is unavailable', () => {
    const estimate = estimateBudget({
      reviewCount: 0,
      hasMarketingBudget: false,
      hasWebsite: false,
      contactPoints: 0,
    });

    expect(estimate.points).toBe(0);
    expect(estimate.reasons).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Located')])
    );
  });

  test('reports unavailable without synthesizing a zero-score zone when every mirror fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFetchResponse({}, false, 503);

    const result = await scanCityZones('Outage City', 'gb', 51.5, -0.1, [51.4, 51.6, -0.2, 0]);

    expect(result).toMatchObject({ status: 'unavailable', zones: [], singleZone: false });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  test('preserves score zero for a successful scan with no qualifying signals', async () => {
    mockFetchResponse({
      elements: [{ type: 'node', id: 999, lat: 51.5, lon: -0.1, tags: { natural: 'tree' } }],
    });

    const result = await scanCityZones('Empty City', 'gb', 51.5, -0.1, [51.4, 51.6, -0.2, 0]);

    expect(result.status).toBe('ok');
    expect(result.zones).toHaveLength(9);
    expect(result.zones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          score: 0,
          wealthScore: 0,
          businessScore: 0,
          archetype: 'developing',
          level: 'developing',
        }),
      ])
    );
  });
});
