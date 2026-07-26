import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { BusinessSearchResult } from '@/types';
import { createScoreBreakdown } from '@/lib/business/score-breakdown-contract';
import {
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
} from '@/lib/business/search-snapshot';

const { getCurrentUserId, putLastSearch, getLastSearch } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  putLastSearch: vi.fn(),
  getLastSearch: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/business/last-search-store', () => ({
  putLastSearch,
  getLastSearch,
}));

import { GET, POST } from './route';

const result = {
  placeId: 'place-1',
  name: 'Example Co',
  photoCount: 1,
  types: ['store'],
  socialLinks: {},
  contactPoints: 2,
  leadScore: 60,
  scoreBreakdown: createScoreBreakdown({ noWebsite: 20 }),
  opportunities: [],
  industryType: 'retail',
} satisfies BusinessSearchResult;

const payload: PersistedSearchPayload = {
  version: SEARCH_SNAPSHOT_VERSION,
  results: [result],
  businessType: 'retail',
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
  timestamp: 1_725_000_123_456,
};

function postRequest(body: BodyInit) {
  return new Request('http://localhost/api/business/last-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserId.mockResolvedValue('user-1');
  putLastSearch.mockResolvedValue(payload);
  getLastSearch.mockResolvedValue(null);
});

describe('/api/business/last-search', () => {
  test.each([
    ['GET', () => GET()],
    ['POST', () => POST(postRequest(JSON.stringify(payload)))],
  ])('returns the standard 401 response for unauthenticated %s requests', async (_method, call) => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(getLastSearch).not.toHaveBeenCalled();
    expect(putLastSearch).not.toHaveBeenCalled();
  });

  test('returns 400 for malformed JSON', async () => {
    const response = await POST(postRequest('{'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(putLastSearch).not.toHaveBeenCalled();
  });

  test.each([
    ['a malformed nested result', { ...payload, results: [{ ...result, types: [42] }] }],
    ['an invalid timestamp', { ...payload, timestamp: -1 }],
    ['a future timestamp', { ...payload, timestamp: Date.now() + 86_400_000 }],
    ['an invalid version', { ...payload, version: -1 }],
    ['a future version', { ...payload, version: SEARCH_SNAPSHOT_VERSION + 1 }],
  ])('returns 400 for %s', async (_label, invalidPayload) => {
    const response = await POST(postRequest(JSON.stringify(invalidPayload)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Payload must be a valid durable search snapshot',
    });
    expect(putLastSearch).not.toHaveBeenCalled();
  });

  test('strips browser-only fields before writing', async () => {
    const response = await POST(
      postRequest(
        JSON.stringify({
          ...payload,
          selectedForEnrich: ['place-1'],
          enrichStatusMap: { 'place-1': 'complete' },
        })
      )
    );

    expect(response.status).toBe(200);
    expect(putLastSearch).toHaveBeenCalledWith('user-1', payload);
  });

  test('returns the newer server winner when a client submits an older snapshot', async () => {
    const newerAccepted = { ...payload, city: 'York', timestamp: payload.timestamp + 1 };
    putLastSearch.mockResolvedValue(newerAccepted);

    const response = await POST(postRequest(JSON.stringify(payload)));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        ...newerAccepted,
        updatedAt: new Date(newerAccepted.timestamp).toISOString(),
      },
    });
  });

  test('writes a canonical POST that the next GET can read', async () => {
    let storedPayload: PersistedSearchPayload | null = null;
    const updatedAt = new Date('2026-07-25T09:00:00.000Z');
    putLastSearch.mockImplementation(async (_userId, nextPayload) => {
      storedPayload = nextPayload;
      return nextPayload;
    });
    getLastSearch.mockImplementation(async () =>
      storedPayload ? { payload: storedPayload, updatedAt } : null
    );

    const postResponse = await POST(postRequest(JSON.stringify(payload)));
    const getResponse = await GET();

    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toEqual({
      ok: true,
      data: { ...payload, updatedAt: new Date(payload.timestamp).toISOString() },
    });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      data: { ...payload, updatedAt: new Date(payload.timestamp).toISOString() },
    });
  });

  test.each([
    ['GET', getLastSearch, () => GET(), 'Failed to fetch last search'],
    [
      'POST',
      putLastSearch,
      () => POST(postRequest(JSON.stringify(payload))),
      'Failed to save last search',
    ],
  ])(
    'returns a safe 500 when the %s store operation fails',
    async (_method, store, call, message) => {
      store.mockRejectedValueOnce(new Error('SQLite connection details'));

      const response = await call();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: message });
    }
  );
});
