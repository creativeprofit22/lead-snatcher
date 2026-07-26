import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  buildNeighborhoodLookupMock,
  checkRateLimitMock,
  geocodeCityMock,
  getClientIpMock,
  scanCityZonesMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  buildNeighborhoodLookupMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  geocodeCityMock: vi.fn(),
  getClientIpMock: vi.fn(),
  scanCityZonesMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/business', () => ({
  geocodeCity: geocodeCityMock,
  scanCityZones: scanCityZonesMock,
}));
vi.mock('@/lib/business/zone-neighborhoods', () => ({
  buildNeighborhoodLookup: buildNeighborhoodLookupMock,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
  getClientIp: getClientIpMock,
  RATE_LIMITS: { standard: { limit: 30 } },
}));

import { GET } from './route';

const emptyLookup = { regions: [], zones: [], singleZone: true };
const geocodeResult = {
  latitude: 51.5,
  longitude: -0.1,
  bbox: [51.4, 51.6, -0.2, 0],
  displayName: 'London, England, United Kingdom',
};

function neighborhoodsRequest(city?: string, country?: string) {
  const url = new URL('http://localhost/api/business/neighborhoods');
  if (city !== undefined) url.searchParams.set('city', city);
  if (country !== undefined) url.searchParams.set('country', country);
  return new NextRequest(url);
}

describe('business neighborhoods GET', () => {
  beforeEach(() => {
    authMock.mockReset();
    buildNeighborhoodLookupMock.mockReset();
    checkRateLimitMock.mockReset();
    geocodeCityMock.mockReset();
    getClientIpMock.mockReset();
    scanCityZonesMock.mockReset();

    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    checkRateLimitMock.mockReturnValue({ success: true });
    getClientIpMock.mockReturnValue('127.0.0.1');
  });

  test('returns 401 before rate limiting when authentication is missing', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(neighborhoodsRequest('London'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(geocodeCityMock).not.toHaveBeenCalled();
  });

  test('returns 429 before provider work when the rate limit is exhausted', async () => {
    checkRateLimitMock.mockReturnValue({ success: false });

    const response = await GET(neighborhoodsRequest('London'));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Too many requests. Slow down a touch.',
    });
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      'neighborhoods:user-1:127.0.0.1',
      expect.anything()
    );
    expect(geocodeCityMock).not.toHaveBeenCalled();
  });

  test.each([undefined, '', ' ', 'L'])(
    'soft-returns an empty lookup for short city %j',
    async (city) => {
      const response = await GET(neighborhoodsRequest(city));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(emptyLookup);
      expect(geocodeCityMock).not.toHaveBeenCalled();
      expect(scanCityZonesMock).not.toHaveBeenCalled();
    }
  );

  test('soft-returns an empty lookup when geocoding misses', async () => {
    geocodeCityMock.mockResolvedValue(null);

    const response = await GET(neighborhoodsRequest(' London ', ' GB '));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(emptyLookup);
    expect(geocodeCityMock).toHaveBeenCalledWith('London', 'GB');
    expect(scanCityZonesMock).not.toHaveBeenCalled();
  });

  test('serializes the helper result with the geocoded city label', async () => {
    const zoneGrid = { zones: [{ label: 'Mayfair' }] };
    const lookup = {
      regions: [
        {
          direction: 'central',
          label: 'Central',
          score: 88,
          zoneCount: 1,
          topLabel: 'Mayfair',
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
    };
    geocodeCityMock.mockResolvedValue(geocodeResult);
    scanCityZonesMock.mockResolvedValue(zoneGrid);
    buildNeighborhoodLookupMock.mockReturnValue(lookup);

    const response = await GET(neighborhoodsRequest('London', 'gb'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ...lookup,
      city: geocodeResult.displayName,
    });
    expect(scanCityZonesMock).toHaveBeenCalledWith(
      'London',
      'gb',
      geocodeResult.latitude,
      geocodeResult.longitude,
      geocodeResult.bbox
    );
    expect(buildNeighborhoodLookupMock).toHaveBeenCalledWith(zoneGrid);
  });

  test('soft-returns an empty lookup when a provider dependency fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    geocodeCityMock.mockResolvedValue(geocodeResult);
    scanCityZonesMock.mockRejectedValue(new Error('provider unavailable'));

    const response = await GET(neighborhoodsRequest('London'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(emptyLookup);
    expect(buildNeighborhoodLookupMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Neighborhoods lookup error:',
      expect.objectContaining({ message: 'provider unavailable' })
    );
    consoleError.mockRestore();
  });
});
