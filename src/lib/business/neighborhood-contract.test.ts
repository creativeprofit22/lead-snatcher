import { describe, expect, test } from 'vitest';
import {
  neighborhoodLookupResponseSchema,
  type NeighborhoodLookupResponse,
} from './neighborhood-contract';

const populatedPayload: NeighborhoodLookupResponse = {
  regions: [
    {
      direction: 'central',
      label: 'Central',
      score: 88,
      zoneCount: 1,
      topLabel: 'Mayfair',
    },
    {
      direction: 'n',
      label: 'North',
      score: 0,
      zoneCount: 0,
      topLabel: null,
    },
  ],
  zones: [
    {
      label: 'Mayfair',
      score: 88,
      wealthScore: 92,
      businessScore: 71,
      archetype: 'luxury',
      level: 'premium',
      latitude: 51.5116,
      longitude: -0.1478,
      region: 'central',
    },
  ],
  singleZone: false,
  city: 'London, Greater London, England, United Kingdom',
};

const emptyPayload: NeighborhoodLookupResponse = {
  regions: [],
  zones: [],
  singleZone: true,
};

describe('neighborhood lookup contract', () => {
  test.each([populatedPayload, emptyPayload])('accepts a complete valid payload', (payload) => {
    expect(neighborhoodLookupResponseSchema.parse(payload)).toEqual(payload);
  });

  test('accepts nullable top labels but rejects null or missing required members', () => {
    expect(populatedPayload.regions[1]?.topLabel).toBeNull();
    expect(neighborhoodLookupResponseSchema.safeParse(populatedPayload).success).toBe(true);
    expect(
      neighborhoodLookupResponseSchema.safeParse({ ...populatedPayload, regions: null }).success
    ).toBe(false);

    const { region, ...zoneWithoutRegion } = populatedPayload.zones[0]!;
    expect(region).toBe('central');
    expect(
      neighborhoodLookupResponseSchema.safeParse({
        ...populatedPayload,
        zones: [zoneWithoutRegion],
      }).success
    ).toBe(false);
  });

  test.each([
    {
      ...populatedPayload,
      regions: [{ ...populatedPayload.regions[0]!, direction: 'up' }],
    },
    {
      ...populatedPayload,
      zones: [{ ...populatedPayload.zones[0]!, region: 'north' }],
    },
  ])('rejects invalid region directions', (payload) => {
    expect(neighborhoodLookupResponseSchema.safeParse(payload).success).toBe(false);
  });

  test('rejects unknown zone archetypes', () => {
    const payload = {
      ...populatedPayload,
      zones: [{ ...populatedPayload.zones[0]!, archetype: 'unknown' }],
    };

    expect(neighborhoodLookupResponseSchema.safeParse(payload).success).toBe(false);
  });

  test.each([
    {
      ...populatedPayload,
      regions: [...populatedPayload.regions, {}],
    },
    {
      ...populatedPayload,
      zones: [...populatedPayload.zones, { label: 'Partial zone' }],
    },
  ])('rejects arrays containing partial members', (payload) => {
    expect(neighborhoodLookupResponseSchema.safeParse(payload).success).toBe(false);
  });
});
