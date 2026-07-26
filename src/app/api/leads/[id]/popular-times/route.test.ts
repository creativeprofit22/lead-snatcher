import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { checkRateLimit, findLead, getClientIp, getCurrentUserId, scrapePopularTimes, updateLead } =
  vi.hoisted(() => ({
    checkRateLimit: vi.fn(),
    findLead: vi.fn(),
    getClientIp: vi.fn(),
    getCurrentUserId: vi.fn(),
    scrapePopularTimes: vi.fn(),
    updateLead: vi.fn(),
  }));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({
  prisma: { lead: { findFirst: findLead, update: updateLead } },
}));
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

const context = { params: Promise.resolve({ id: 'lead-1' }) };
const popularTimesData = { weekly: [], dayLabels: [] };
const lead = {
  id: 'lead-1',
  userId: 'user-1',
  name: 'Acme Cafe',
  address: '1 Main St',
  popularTimesData: null,
  popularTimesScrapedAt: null,
};

function post(query = '') {
  return POST(
    new NextRequest(`http://localhost/api/leads/lead-1/popular-times${query}`, {
      method: 'POST',
    }),
    context
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  getCurrentUserId.mockResolvedValue('user-1');
  getClientIp.mockReturnValue('127.0.0.1');
  checkRateLimit.mockReturnValue({ success: true });
  findLead.mockResolvedValue({ ...lead });
  scrapePopularTimes.mockResolvedValue({ ok: true, data: popularTimesData });
  updateLead.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/leads/[id]/popular-times', () => {
  test('requires authentication before querying the lead or provider', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await post();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findLead).not.toHaveBeenCalled();
    expect(scrapePopularTimes).not.toHaveBeenCalled();
  });

  test('scopes lead lookup to the authenticated user and preserves 404', async () => {
    findLead.mockResolvedValue(null);

    const response = await post();

    expect(findLead).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1' },
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test('returns valid cached data without consuming the provider limit', async () => {
    const scrapedAt = new Date('2026-07-25T12:00:00.000Z');
    findLead.mockResolvedValue({
      ...lead,
      popularTimesData: JSON.stringify(popularTimesData),
      popularTimesScrapedAt: scrapedAt,
    });

    const response = await post();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: popularTimesData,
      scrapedAt: scrapedAt.toISOString(),
      fromCache: true,
    });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(scrapePopularTimes).not.toHaveBeenCalled();
  });

  test('rate limits uncached provider work with the shared Popular Times key', async () => {
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

  test('preserves provider failure error and reason without writing', async () => {
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
    expect(updateLead).not.toHaveBeenCalled();
  });

  test('force refreshes cached data and persists a successful scrape', async () => {
    findLead.mockResolvedValue({
      ...lead,
      popularTimesData: JSON.stringify({ weekly: [[1]], dayLabels: [] }),
      popularTimesScrapedAt: new Date('2026-07-24T12:00:00.000Z'),
    });

    const response = await post('?force=true');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(scrapePopularTimes).toHaveBeenCalledWith('Acme Cafe 1 Main St');
    expect(updateLead).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        popularTimesData: JSON.stringify(popularTimesData),
        popularTimesScrapedAt: expect.any(Date),
      },
    });
    expect(body).toEqual({
      data: popularTimesData,
      scrapedAt: expect.any(String),
      fromCache: false,
    });
  });

  test('preserves the structured server-error contract for unexpected failures', async () => {
    findLead.mockRejectedValue(new Error('database secret'));

    const response = await post();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Server error during scrape',
      reason: 'server_error',
    });
  });
});
