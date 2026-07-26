import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { checkRateLimit, getClientIp, getCurrentUserId, scrapePopularTimes } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
  getCurrentUserId: vi.fn(),
  scrapePopularTimes: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/business/popular-times', () => ({
  scrapePopularTimes,
  toPopularTimesFailureBody: (failure: { message: string; reason: string }) => ({
    error: failure.message,
    reason: failure.reason,
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit,
  getClientIp,
  RATE_LIMITS: { expensive: { maxRequests: 10, windowMs: 60_000 } },
}));

import { POST } from './route';

function post(body: BodyInit = JSON.stringify({ name: 'Acme Cafe', address: '1 Main St' })) {
  return POST(
    new NextRequest('http://localhost/api/business/popular-times', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  getCurrentUserId.mockResolvedValue('user-1');
  getClientIp.mockReturnValue('127.0.0.1');
  checkRateLimit.mockReturnValue({ success: true });
  scrapePopularTimes.mockResolvedValue({
    ok: true,
    data: { weekly: [], dayLabels: [] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/business/popular-times', () => {
  test('requires authentication before parsing or external work', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await post('{');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(scrapePopularTimes).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed JSON', '{', 'Invalid JSON body'],
    ['schema-invalid JSON', JSON.stringify({ name: '' }), 'Too small'],
  ])('returns 400 for %s before rate limiting or external work', async (_case, body, error) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(error);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(scrapePopularTimes).not.toHaveBeenCalled();
  });

  test('shares the expensive provider limit and preserves an error reason on 429', async () => {
    checkRateLimit.mockReturnValue({ success: false });

    const response = await post();

    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith(
      'popular-times:user-1:127.0.0.1',
      expect.objectContaining({ maxRequests: 10 })
    );
    await expect(response.json()).resolves.toEqual({
      error: 'Too many Popular Times requests. Please wait a moment.',
      reason: 'rate_limited',
    });
    expect(scrapePopularTimes).not.toHaveBeenCalled();
  });

  test('preserves provider failure error and reason', async () => {
    scrapePopularTimes.mockResolvedValue({
      ok: false,
      failure: { message: 'No visit data', reason: 'no_data_found' },
    });

    const response = await post();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'No visit data',
      reason: 'no_data_found',
    });
  });

  test('scrapes the validated business query and returns data', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expect(scrapePopularTimes).toHaveBeenCalledWith('Acme Cafe 1 Main St');
    await expect(response.json()).resolves.toEqual({
      data: { weekly: [], dayLabels: [] },
      scrapedAt: expect.any(String),
    });
  });

  test('preserves the structured server-error contract for unexpected failures', async () => {
    scrapePopularTimes.mockRejectedValue(new Error('provider secret'));

    const response = await post();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Server error during scrape',
      reason: 'server_error',
    });
  });
});
