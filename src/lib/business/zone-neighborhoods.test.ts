import { describe, expect, test } from 'vitest';
import type { Zone, ZoneGridResult } from './zone-contract';
import { buildNeighborhoodLookup } from './zone-neighborhoods';

const GENERATED_FALLBACK_LABELS = [
  'SW Quadrant',
  'South',
  'SE Quadrant',
  'West',
  'Central',
  'East',
  'NW Quadrant',
  'North',
  'NE Quadrant',
  'Zone',
];

function makeZone(overrides: Partial<Zone> & Pick<Zone, 'label'>): Zone {
  return {
    id: `zone-${overrides.label}`,
    latitude: 1.5,
    longitude: 1.5,
    score: 50,
    wealthScore: 60,
    businessScore: 40,
    archetype: 'mixed',
    level: 'commercial',
    amenities: {
      banks: 1,
      hotels: 0,
      hospitals: 0,
      pharmacies: 0,
      supermarkets: 0,
      fuelStations: 0,
      affluenceSpots: 0,
      total: 1,
    },
    radiusMeters: 1500,
    distanceFromCenterMeters: 0,
    ...overrides,
  };
}

function makeGrid(zones: Zone[], singleZone = false): ZoneGridResult {
  return {
    status: 'ok',
    zones,
    centroid: { latitude: 1.5, longitude: 1.5 },
    bbox: [0, 3, 0, 3],
    singleZone,
  };
}

describe('buildNeighborhoodLookup', () => {
  test('rejects every generated directional fallback label', () => {
    const result = buildNeighborhoodLookup(
      makeGrid(GENERATED_FALLBACK_LABELS.map((label) => makeZone({ label })))
    );

    expect(result.zones).toEqual([]);
    expect(result.regions.every((region) => region.zoneCount === 0)).toBe(true);
  });

  test('rejects zero-score and empty-amenity zones while retaining a named zone', () => {
    const result = buildNeighborhoodLookup(
      makeGrid([
        makeZone({ label: 'Zero Score', score: 0 }),
        makeZone({
          label: 'No Amenities',
          amenities: {
            banks: 0,
            hotels: 0,
            hospitals: 0,
            pharmacies: 0,
            supermarkets: 0,
            fuelStations: 0,
            affluenceSpots: 0,
            total: 0,
          },
        }),
        makeZone({ label: 'Named District', score: 77, latitude: 0.5, longitude: 2.5 }),
      ])
    );

    expect(result.zones).toEqual([
      {
        label: 'Named District',
        score: 77,
        wealthScore: 60,
        businessScore: 40,
        archetype: 'mixed',
        level: 'commercial',
        latitude: 0.5,
        longitude: 2.5,
        region: 'se',
      },
    ]);
  });

  test('assigns retained zones to central for a single-zone grid', () => {
    const result = buildNeighborhoodLookup(
      makeGrid([makeZone({ label: 'Small Town', latitude: 2.8, longitude: 2.8 })], true)
    );

    expect(result.singleZone).toBe(true);
    expect(result.zones[0]?.region).toBe('central');
    expect(result.regions.find((region) => region.direction === 'central')).toEqual({
      direction: 'central',
      label: 'Central',
      score: 50,
      zoneCount: 1,
      topLabel: 'Small Town',
    });
  });

  test('builds summaries in stable nine-region order with count and top-scoring label', () => {
    const result = buildNeighborhoodLookup(
      makeGrid([
        makeZone({ label: 'Northwest Place', latitude: 2.5, longitude: 0.5, score: 11 }),
        makeZone({ label: 'North Runner-up', latitude: 2.5, longitude: 1.5, score: 45 }),
        makeZone({ label: 'North Winner', latitude: 2.7, longitude: 1.7, score: 91 }),
        makeZone({ label: 'Northeast Place', latitude: 2.5, longitude: 2.5, score: 22 }),
        makeZone({ label: 'West Place', latitude: 1.5, longitude: 0.5, score: 33 }),
        makeZone({ label: 'Central Place', latitude: 1.5, longitude: 1.5, score: 44 }),
        makeZone({ label: 'East Place', latitude: 1.5, longitude: 2.5, score: 55 }),
        makeZone({ label: 'Southwest Place', latitude: 0.5, longitude: 0.5, score: 66 }),
        makeZone({ label: 'South Place', latitude: 0.5, longitude: 1.5, score: 77 }),
        makeZone({ label: 'Southeast Place', latitude: 0.5, longitude: 2.5, score: 88 }),
      ])
    );

    expect(result.regions.map((region) => region.direction)).toEqual([
      'nw',
      'n',
      'ne',
      'w',
      'central',
      'e',
      'sw',
      's',
      'se',
    ]);
    expect(result.regions.find((region) => region.direction === 'n')).toEqual({
      direction: 'n',
      label: 'North',
      score: 91,
      zoneCount: 2,
      topLabel: 'North Winner',
    });
  });

  test('returns nine empty summaries for an empty grid', () => {
    const result = buildNeighborhoodLookup(makeGrid([]));

    expect(result).toEqual({
      regions: [
        ['nw', 'Northwest'],
        ['n', 'North'],
        ['ne', 'Northeast'],
        ['w', 'West'],
        ['central', 'Central'],
        ['e', 'East'],
        ['sw', 'Southwest'],
        ['s', 'South'],
        ['se', 'Southeast'],
      ].map(([direction, label]) => ({
        direction,
        label,
        score: 0,
        zoneCount: 0,
        topLabel: null,
      })),
      zones: [],
      singleZone: false,
    });
  });

  test('does not mutate the zone grid or its zones', () => {
    const zoneGrid = makeGrid([
      makeZone({ label: 'Lower Score', score: 10 }),
      makeZone({ label: 'Higher Score', score: 90 }),
    ]);
    const original = structuredClone(zoneGrid);

    buildNeighborhoodLookup(zoneGrid);

    expect(zoneGrid).toEqual(original);
  });
});
