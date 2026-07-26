import { describe, expect, test } from 'vitest';
import type { BusinessSearchResult } from '@/types';
import { createScoreBreakdown } from './score-breakdown-contract';
import type { PersistedSearchPayload } from './search-snapshot';
import {
  SEARCH_SNAPSHOT_RESULT_LIMIT,
  SEARCH_SNAPSHOT_VERSION,
  decodePersistedSearchPayload,
  parsePersistedSearchPayload,
} from './search-snapshot';

const currentScoreBreakdown = createScoreBreakdown({
  noWebsite: 20,
  noPhone: 10,
  qualityChips: ['No website'],
  hasMarketingBudget: true,
  marketingPlatforms: ['Google Ads'],
  demandSignal: 'high',
  demandLabel: 'Strong review volume',
});

const result = {
  placeId: 'place-1',
  name: 'Example Co',
  photoCount: 1,
  types: ['store'],
  socialLinks: {},
  contactPoints: 2,
  leadScore: 60,
  scoreBreakdown: currentScoreBreakdown,
  opportunities: [],
  industryType: 'retail',
} satisfies BusinessSearchResult;

const currentZone: NonNullable<PersistedSearchPayload['zones']>[number] = {
  id: 'central',
  label: 'Central',
  latitude: 53.8,
  longitude: -1.55,
  score: 88,
  wealthScore: 91,
  businessScore: 84,
  archetype: 'luxury',
  level: 'premium',
  amenities: {
    banks: 2,
    hotels: 3,
    hospitals: 1,
    pharmacies: 4,
    supermarkets: 5,
    fuelStations: 1,
    affluenceSpots: 6,
    total: 31,
    luxuryRetail: 7,
    professionalServices: 8,
    premiumHotels: 2,
    casinos: 1,
    corporateOffices: 9,
    pawnshops: 1,
    moneyLenders: 2,
    socialFacilities: 3,
    charityShops: 4,
  },
  radiusMeters: 1_500,
  distanceFromCenterMeters: 250,
};

const currentPayload: PersistedSearchPayload = {
  version: SEARCH_SNAPSHOT_VERSION,
  results: [result],
  businessType: 'retail',
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
  timestamp: 1_725_000_123_456,
  zones: [currentZone],
  zoneBbox: [53.6, 54.0, -1.8, -1.3],
  singleZone: false,
  focusedZoneId: currentZone.id,
  zoneScanStatus: 'ok',
  marketDensity: {
    status: 'ok',
    count: 1,
    level: 'moderate',
    label: 'Leeds',
    description: 'One result in the current area',
    amenities: currentZone.amenities,
  },
};

const preV2Zone = {
  id: 'central',
  label: 'Central',
  latitude: 53.8,
  longitude: -1.55,
  score: 75,
  level: 'commercial',
  amenities: {
    banks: 2,
    hotels: 3,
    hospitals: 1,
    pharmacies: 4,
    supermarkets: 5,
    fuelStations: 1,
    affluenceSpots: 6,
    total: 22,
  },
  radiusMeters: 1_500,
  distanceFromCenterMeters: 250,
};

describe('parsePersistedSearchPayload', () => {
  test('round-trips every current v3 query, zone, and amenity field', () => {
    expect(parsePersistedSearchPayload(JSON.stringify(currentPayload))).toEqual(currentPayload);
  });

  test('migrates a legacy partial score breakdown to complete canonical defaults', () => {
    const legacyPayload = {
      ...currentPayload,
      results: [
        {
          ...result,
          scoreBreakdown: { noWebsite: 20, total: 999 },
        },
      ],
    };

    const parsed = parsePersistedSearchPayload(JSON.stringify(legacyPayload));

    expect(parsed?.results[0]?.scoreBreakdown).toEqual(createScoreBreakdown({ noWebsite: 20 }));
  });

  test('clamps lead scores written by the legacy uncapped scorer', () => {
    const legacyPayload = {
      ...currentPayload,
      results: [{ ...result, leadScore: 135 }],
    };

    const parsed = parsePersistedSearchPayload(JSON.stringify(legacyPayload));

    expect(parsed?.results[0]?.leadScore).toBe(100);
  });

  test('returns null when a cached score breakdown contains malformed fields', () => {
    const malformedPayload = {
      ...currentPayload,
      results: [
        {
          ...result,
          scoreBreakdown: { ...currentScoreBreakdown, qualityChips: 'No website' },
        },
      ],
    };

    expect(parsePersistedSearchPayload(JSON.stringify(malformedPayload))).toBeNull();
  });

  test('accepts unknown future score keys without exposing them to hydrated UI state', () => {
    const futurePayload = {
      ...currentPayload,
      results: [
        {
          ...result,
          scoreBreakdown: { ...currentScoreBreakdown, futureSignal: 15 },
        },
      ],
    };

    const parsed = parsePersistedSearchPayload(JSON.stringify(futurePayload));

    expect(parsed?.results[0]?.scoreBreakdown).toEqual(currentScoreBreakdown);
    expect(parsed?.results[0]?.scoreBreakdown).not.toHaveProperty('futureSignal');
  });

  test('migrates a pre-v2 multi-zone payload by discarding incompatible zone analysis', () => {
    const preV2Payload = {
      ...currentPayload,
      version: 1,
      zones: [preV2Zone, { ...preV2Zone, id: 'north', label: 'North' }],
    };

    const parsed = parsePersistedSearchPayload(JSON.stringify(preV2Payload));

    expect(parsed).toMatchObject({
      version: SEARCH_SNAPSHOT_VERSION,
      results: currentPayload.results,
      industry: 'retail',
      city: 'Leeds',
      country: 'gb',
      timestamp: currentPayload.timestamp,
    });
    expect(parsed).not.toHaveProperty('zones');
    expect(parsed).not.toHaveProperty('marketDensity');
    expect(parsed).not.toHaveProperty('zoneBbox');
    expect(parsed).not.toHaveProperty('focusedZoneId');
  });

  test('rejects malformed zone analysis in a current payload', () => {
    const malformedPayload = {
      ...currentPayload,
      zones: [{ ...currentZone, archetype: 'residential' }],
    };

    expect(parsePersistedSearchPayload(JSON.stringify(malformedPayload))).toBeNull();
  });

  test('strips browser-only and unknown top-level fields', () => {
    const parsed = decodePersistedSearchPayload({
      ...currentPayload,
      enrichStatusMap: { 'place-1': 'complete' },
      selectedForEnrich: ['place-1'],
      futureTopLevelField: true,
    });

    expect(parsed).toEqual(currentPayload);
    expect(parsed).not.toHaveProperty('enrichStatusMap');
    expect(parsed).not.toHaveProperty('selectedForEnrich');
    expect(parsed).not.toHaveProperty('futureTopLevelField');
  });

  test('keeps a legacy payload with no zone analysis valid', () => {
    const legacyPayload = {
      version: 2,
      results: currentPayload.results,
      industry: currentPayload.industry,
      city: currentPayload.city,
      country: currentPayload.country,
      timestamp: currentPayload.timestamp,
    };

    expect(parsePersistedSearchPayload(JSON.stringify(legacyPayload))).toEqual({
      ...legacyPayload,
      businessType: 'retail',
      version: SEARCH_SNAPSHOT_VERSION,
    });
  });

  test('rejects a current snapshot missing its canonical business type', () => {
    const missingBusinessType: Partial<PersistedSearchPayload> = { ...currentPayload };
    delete missingBusinessType.businessType;

    expect(decodePersistedSearchPayload(missingBusinessType)).toBeNull();
  });

  test('returns null for malformed stored JSON', () => {
    expect(parsePersistedSearchPayload('{"results":')).toBeNull();
  });

  test('preserves the stored search timestamp exactly', () => {
    const parsed = parsePersistedSearchPayload(JSON.stringify(currentPayload));

    expect(parsed?.timestamp).toBe(1_725_000_123_456);
  });

  test('round-trips a current object through the canonical codec', () => {
    expect(decodePersistedSearchPayload(currentPayload)).toEqual(currentPayload);
  });

  test('rejects an invalid industry', () => {
    expect(
      decodePersistedSearchPayload({ ...currentPayload, industry: 'not-an-industry' })
    ).toBeNull();
  });

  test('rejects malformed nested search results', () => {
    expect(
      decodePersistedSearchPayload({
        ...currentPayload,
        results: [{ ...result, types: ['store', 42] }],
      })
    ).toBeNull();
  });

  test('rejects malformed nested zone amenities', () => {
    expect(
      decodePersistedSearchPayload({
        ...currentPayload,
        zones: [
          {
            ...currentZone,
            amenities: { ...currentZone.amenities, banks: 'two' },
          },
        ],
      })
    ).toBeNull();
  });

  test('rejects payloads from a future snapshot version', () => {
    expect(
      decodePersistedSearchPayload({
        ...currentPayload,
        version: SEARCH_SNAPSHOT_VERSION + 1,
      })
    ).toBeNull();
  });

  test('accepts timestamps within normal clock skew', () => {
    const timestamp = Date.now() + 60_000;

    expect(decodePersistedSearchPayload({ ...currentPayload, timestamp })?.timestamp).toBe(timestamp);
  });

  test.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['fractional', currentPayload.timestamp + 0.5],
    ['future', Date.now() + 86_400_000],
    ['outside the Date range', 8_640_000_000_000_001],
  ])('rejects a %s timestamp', (_label, timestamp) => {
    expect(decodePersistedSearchPayload({ ...currentPayload, timestamp })).toBeNull();
  });

  test('rejects result arrays over the search limit', () => {
    const results = Array.from({ length: SEARCH_SNAPSHOT_RESULT_LIMIT + 1 }, (_, index) => ({
      ...result,
      placeId: `place-${index}`,
    }));

    expect(decodePersistedSearchPayload({ ...currentPayload, results })).toBeNull();
  });

  test('can apply an API timestamp only when the field is absent', () => {
    const withoutTimestamp: Partial<PersistedSearchPayload> = { ...currentPayload };
    delete withoutTimestamp.timestamp;

    expect(decodePersistedSearchPayload(withoutTimestamp, 1_725_000_999_000)?.timestamp).toBe(
      1_725_000_999_000
    );
    expect(
      decodePersistedSearchPayload({ ...withoutTimestamp, timestamp: null }, Date.now())
    ).toBeNull();
  });
});
