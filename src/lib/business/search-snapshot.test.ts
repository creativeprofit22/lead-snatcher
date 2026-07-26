import { describe, expect, test } from 'vitest';
import type { BusinessSearchResult } from '@/types';
import { createScoreBreakdown } from './score-breakdown-contract';
import type { PersistedSearchPayload } from './search-snapshot';
import { SEARCH_SNAPSHOT_VERSION, parsePersistedSearchPayload } from './search-snapshot';

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
  test('round-trips every current v2 zone and amenity field', () => {
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

  test('discards malformed zone analysis without dropping unrelated passthrough data', () => {
    const malformedPayload = {
      ...currentPayload,
      browserEnrichment: { completedPlaceIds: ['place-1'] },
      zones: [{ ...currentZone, archetype: 'residential' }],
    };

    const parsed = parsePersistedSearchPayload(JSON.stringify(malformedPayload));

    expect(parsed?.results).toEqual(currentPayload.results);
    expect(parsed?.city).toBe(currentPayload.city);
    expect(parsed).toHaveProperty('browserEnrichment', { completedPlaceIds: ['place-1'] });
    expect(parsed).not.toHaveProperty('zones');
    expect(parsed).not.toHaveProperty('marketDensity');
    expect(parsed).not.toHaveProperty('zoneBbox');
    expect(parsed).not.toHaveProperty('focusedZoneId');
  });

  test('keeps a legacy payload with no zone analysis valid', () => {
    const legacyPayload = {
      results: currentPayload.results,
      industry: currentPayload.industry,
      city: currentPayload.city,
      country: currentPayload.country,
      timestamp: currentPayload.timestamp,
    };

    expect(parsePersistedSearchPayload(JSON.stringify(legacyPayload))).toEqual({
      ...legacyPayload,
      version: SEARCH_SNAPSHOT_VERSION,
    });
  });

  test('returns null for malformed stored JSON', () => {
    expect(parsePersistedSearchPayload('{"results":')).toBeNull();
  });

  test('preserves the stored search timestamp exactly', () => {
    const parsed = parsePersistedSearchPayload(JSON.stringify(currentPayload));

    expect(parsed?.timestamp).toBe(1_725_000_123_456);
  });
});
