import { describe, expect, test } from 'vitest';
import type { PersistedSearchPayload } from './search-snapshot';
import { parsePersistedSearchPayload } from './search-snapshot';

const durablePayload: PersistedSearchPayload = {
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
    } as unknown as PersistedSearchPayload['results'][number],
  ],
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
  timestamp: 1_725_000_123_456,
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

describe('parsePersistedSearchPayload', () => {
  test('round-trips the current durable payload without changing serialized fields', () => {
    expect(parsePersistedSearchPayload(JSON.stringify(durablePayload))).toEqual(durablePayload);
  });

  test('accepts legacy payloads without optional zone fields', () => {
    const legacyPayload = {
      results: durablePayload.results,
      industry: durablePayload.industry,
      city: durablePayload.city,
      country: durablePayload.country,
      timestamp: durablePayload.timestamp,
    };

    expect(parsePersistedSearchPayload(JSON.stringify(legacyPayload))).toEqual(legacyPayload);
  });

  test('returns null for malformed stored JSON', () => {
    expect(parsePersistedSearchPayload('{"results":')).toBeNull();
  });

  test('preserves the stored search timestamp exactly', () => {
    const parsed = parsePersistedSearchPayload(JSON.stringify(durablePayload));

    expect(parsed?.timestamp).toBe(1_725_000_123_456);
  });
});
