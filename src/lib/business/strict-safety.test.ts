import { afterEach, describe, expect, test, vi } from 'vitest';

import { runBatch } from './enrichment';
import { geocodeCity } from './geocode';
import { scrapePopularTimes } from './popular-times';
import { scrapeWebsite } from './scraper';
import { classifyZoneTags, ZONE_TAG_TO_AMENITY_KEY } from './zone-grid';

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

  test('extracts valid captures and tolerates empty capture candidates', async () => {
    mockFetchResponse(
      '<html lang="en-US"><head><title> Example </title></head><body>© 2024 Example</body></html>'
    );

    await expect(scrapeWebsite('https://example.com')).resolves.toMatchObject({
      isReachable: true,
      title: 'Example',
      language: 'en',
      copyrightYear: 2024,
    });

    mockFetchResponse('<html><head><title></title></head><body>© Example</body></html>');
    const emptyCaptures = await scrapeWebsite('https://example.com');
    expect(emptyCaptures.isReachable).toBe(true);
    expect(emptyCaptures.title).toBeUndefined();
    expect(emptyCaptures.copyrightYear).toBeUndefined();
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
});
