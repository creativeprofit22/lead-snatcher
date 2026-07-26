import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { checkRateLimit, geocodeCity, getClientIp, getCurrentUserId } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  geocodeCity: vi.fn(),
  getClientIp: vi.fn(),
  getCurrentUserId: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/business', () => ({ geocodeCity }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit,
  getClientIp,
  RATE_LIMITS: { standard: { maxRequests: 60, windowMs: 60_000 } },
}));

import { GET } from './route';

function get(query: string) {
  return GET(new Request(`http://localhost/api/business/geocode?${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  getCurrentUserId.mockResolvedValue('user-1');
  getClientIp.mockReturnValue('127.0.0.1');
  checkRateLimit.mockReturnValue({ success: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/business/geocode', () => {
  test('requires authentication before rate limiting or provider work', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await get('city=Chicago');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(geocodeCity).not.toHaveBeenCalled();
  });

  test('uses the canonical country default when country is omitted', async () => {
    const result = { latitude: 41.8781, longitude: -87.6298 };
    geocodeCity.mockResolvedValue(result);

    const response = await get('city=%20Chicago%20');

    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledWith(
      'geocode:user-1:127.0.0.1',
      expect.objectContaining({ maxRequests: 60 })
    );
    expect(geocodeCity).toHaveBeenCalledWith('Chicago', 'us');
    await expect(response.json()).resolves.toEqual(result);
  });

  test('returns 429 before provider work when the user exceeds the limit', async () => {
    checkRateLimit.mockReturnValue({ success: false });

    const response = await get('city=Chicago');

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Too many geocoding requests. Please wait a moment and try again.',
    });
    expect(geocodeCity).not.toHaveBeenCalled();
  });

  test('validates city and preserves the not-found response', async () => {
    const missing = await get('country=us');
    geocodeCity.mockResolvedValue(null);
    const unknown = await get('city=Unknown');

    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: 'City is required' });
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: 'Could not find location: Unknown' });
  });

  test('maps unexpected failures to safe endpoint JSON', async () => {
    geocodeCity.mockRejectedValue(new Error('provider secret'));

    const response = await get('city=Chicago');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Geocoding failed. Please try again.',
    });
  });
});
