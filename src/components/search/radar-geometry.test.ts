import { describe, expect, test } from 'vitest';

import type { ZoneBbox } from '@/lib/business/zone-contract';
import {
  buildRadarPins,
  buildZoneDots,
  calculatePointBbox,
  crossedAngle,
  MAX_RADAR_PINS,
  projectPointToRadar,
  RADAR_CENTER,
  RADAR_RADIUS,
} from './radar-geometry';

const bbox: ZoneBbox = [0, 10, 0, 10];
const projectedEdge = RADAR_CENTER + RADAR_RADIUS * 0.85;

describe('calculatePointBbox', () => {
  test('calculates bounds while ignoring missing and non-finite coordinates', () => {
    expect(
      calculatePointBbox([
        { latitude: 2, longitude: 8 },
        { latitude: -1, longitude: 3 },
        { latitude: Number.NaN, longitude: 5 },
        { latitude: 4, longitude: Number.POSITIVE_INFINITY },
        {},
      ])
    ).toEqual([-1, 2, 3, 8]);
    expect(calculatePointBbox([{ latitude: Number.NaN, longitude: 1 }])).toBeNull();
  });
});

describe('projectPointToRadar', () => {
  test('projects the center and cardinal bbox edges', () => {
    expect(projectPointToRadar(5, 5, bbox)).toEqual({ x: RADAR_CENTER, y: RADAR_CENTER });

    const east = projectPointToRadar(5, 10, bbox);
    expect(east?.x).toBeCloseTo(projectedEdge);
    expect(east?.y).toBeCloseTo(RADAR_CENTER);

    const north = projectPointToRadar(10, 5, bbox);
    expect(north?.x).toBeCloseTo(RADAR_CENTER);
    expect(north?.y).toBeCloseTo(RADAR_CENTER - RADAR_RADIUS * 0.85);
  });

  test('centers each zero-span axis independently', () => {
    expect(projectPointToRadar(5, 5, [5, 5, 5, 5])).toEqual({
      x: RADAR_CENTER,
      y: RADAR_CENTER,
    });

    const zeroLongitudeSpan = projectPointToRadar(10, 5, [0, 10, 5, 5]);
    expect(zeroLongitudeSpan?.x).toBeCloseTo(RADAR_CENTER);
    expect(zeroLongitudeSpan?.y).toBeCloseTo(RADAR_CENTER - RADAR_RADIUS * 0.85);

    const zeroLatitudeSpan = projectPointToRadar(5, 10, [5, 5, 0, 10]);
    expect(zeroLatitudeSpan?.x).toBeCloseTo(projectedEdge);
    expect(zeroLatitudeSpan?.y).toBeCloseTo(RADAR_CENTER);
  });

  test('centers singleton and identical-coordinate auto bounds', () => {
    const singletonBbox = calculatePointBbox([{ latitude: 51.5, longitude: -0.1 }]);
    const identicalBbox = calculatePointBbox([
      { latitude: 51.5, longitude: -0.1 },
      { latitude: 51.5, longitude: -0.1 },
    ]);

    expect(singletonBbox && projectPointToRadar(51.5, -0.1, singletonBbox)).toEqual({
      x: RADAR_CENTER,
      y: RADAR_CENTER,
    });
    expect(identicalBbox && projectPointToRadar(51.5, -0.1, identicalBbox)).toEqual({
      x: RADAR_CENTER,
      y: RADAR_CENTER,
    });
  });

  test('rejects non-finite coordinates and bounds', () => {
    expect(projectPointToRadar(Number.NaN, 5, bbox)).toBeNull();
    expect(projectPointToRadar(5, 5, [0, Number.POSITIVE_INFINITY, 0, 10])).toBeNull();
  });
});

describe('crossedAngle', () => {
  test('detects ordinary and wrap-around sweep crossings', () => {
    expect(crossedAngle(20, 40, 30)).toBe(true);
    expect(crossedAngle(20, 40, 10)).toBe(false);
    expect(crossedAngle(350, 10, 355)).toBe(true);
    expect(crossedAngle(350, 10, 5)).toBe(true);
    expect(crossedAngle(350, 10, 180)).toBe(false);
  });
});

describe('buildZoneDots', () => {
  test('sorts without mutation and includes the authoritative focused label', () => {
    const zones = [
      { id: 'focused', label: 'North', score: 10, latitude: 5, longitude: 5 },
      { id: 'fourth', label: 'Fourth', score: 60, latitude: 4, longitude: 4 },
      { id: 'first', label: 'First', score: 90, latitude: 1, longitude: 1 },
      { id: 'third', label: 'Third', score: 70, latitude: 3, longitude: 3 },
      { id: 'second', label: 'Second', score: 80, latitude: 2, longitude: 2 },
    ];
    const originalOrder = zones.map(({ id }) => id);

    const dots = buildZoneDots(zones, bbox, 'focused');

    expect(dots.map(({ id }) => id)).toEqual(['first', 'second', 'third', 'fourth', 'focused']);
    expect(zones.map(({ id }) => id)).toEqual(originalOrder);
    expect(dots.filter(({ labeled }) => labeled).map(({ id }) => id)).toEqual([
      'first',
      'second',
      'third',
      'focused',
    ]);
    expect(dots.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(dots[0]).not.toHaveProperty('order');
  });

  test('omits zones with non-finite coordinates', () => {
    const dots = buildZoneDots(
      [
        { id: 'valid', label: 'Valid', score: 50, latitude: 5, longitude: 5 },
        { id: 'invalid', label: 'Invalid', score: 100, latitude: Infinity, longitude: 5 },
      ],
      bbox,
      null
    );

    expect(dots.map(({ id }) => id)).toEqual(['valid']);
  });
});

describe('buildRadarPins', () => {
  test('projects finite coordinate pins and ignores invalid coordinates', () => {
    const pins = buildRadarPins(
      [
        { placeId: 'missing' },
        { placeId: 'center', latitude: 5, longitude: 5 },
        { placeId: 'invalid', latitude: Infinity, longitude: 5 },
        { placeId: 'edge', latitude: 5, longitude: 10 },
      ],
      bbox
    );

    expect(pins.map(({ key }) => key)).toEqual(['center', 'edge']);
    expect(pins[0]).toMatchObject({ x: RADAR_CENTER, y: RADAR_CENTER, angle: 0 });
    expect(
      pins.every(({ x, y, angle }) => [x, y, angle].every((value) => Number.isFinite(value)))
    ).toBe(true);
  });

  test('falls back to finite spiral pins when coordinates cannot be projected', () => {
    const pins = buildRadarPins(
      [{ placeId: 'missing' }, { placeId: 'invalid', latitude: Number.NaN, longitude: 5 }],
      bbox
    );

    expect(pins.map(({ key }) => key)).toEqual(['missing', 'invalid']);
    expect(pins[0]).toMatchObject({
      x: RADAR_CENTER + RADAR_RADIUS * 0.35,
      y: RADAR_CENTER,
      angle: 0,
    });
    expect(
      pins.every(({ x, y, angle }) => [x, y, angle].every((value) => Number.isFinite(value)))
    ).toBe(true);
  });

  test.each([
    ['projected', bbox],
    ['fallback', null],
  ] as const)('caps %s pins at the radar limit', (_placement, pinBbox) => {
    const results = Array.from({ length: MAX_RADAR_PINS + 5 }, (_, index) => ({
      placeId: `place-${index}`,
      latitude: 5,
      longitude: 5,
    }));

    expect(buildRadarPins(results, pinBbox)).toHaveLength(MAX_RADAR_PINS);
  });
});
