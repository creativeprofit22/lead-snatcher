import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { BusinessSearchResult } from '@/types';
import { createScoreBreakdown } from '@/lib/business/score-breakdown-contract';
import {
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
} from '@/lib/business/search-snapshot';

const {
  getCurrentUserId,
  createSavedSession,
  listSavedSessions,
  getSavedSession,
  deleteSavedSession,
} = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  createSavedSession: vi.fn(),
  listSavedSessions: vi.fn(),
  getSavedSession: vi.fn(),
  deleteSavedSession: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/business/saved-sessions-store', () => ({
  createSavedSession,
  listSavedSessions,
  getSavedSession,
  deleteSavedSession,
}));

import { GET as GET_COLLECTION, POST } from './route';
import { DELETE as DELETE_MEMBER, GET as GET_MEMBER } from './[id]/route';

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
const createdAt = '2026-07-25T09:00:00.000Z';
const savedRecord = {
  id: 'session-1',
  name: 'Leeds retail',
  status: 'ready' as const,
  businessType: 'retail',
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
  resultCount: 1,
  createdAt,
  updatedAt: createdAt,
  payload,
};
const corruptMember = {
  id: 'session-corrupt',
  name: 'Damaged session',
  status: 'corrupt' as const,
  message: 'Saved session data is corrupted and cannot be loaded.',
  createdAt,
  updatedAt: createdAt,
};

function postRequest(body: BodyInit) {
  return new Request('http://localhost/api/business/saved-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function memberRequest(method: 'GET' | 'DELETE') {
  return new Request('http://localhost/api/business/saved-sessions/session-1', { method });
}

function params(id = 'session-1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserId.mockResolvedValue('user-1');
  createSavedSession.mockResolvedValue(savedRecord);
  listSavedSessions.mockResolvedValue([]);
  getSavedSession.mockResolvedValue(savedRecord);
  deleteSavedSession.mockResolvedValue(true);
});

describe('/api/business/saved-sessions', () => {
  test.each([
    ['collection GET', () => GET_COLLECTION()],
    [
      'collection POST',
      () => POST(postRequest(JSON.stringify({ name: 'Leeds retail', ...payload }))),
    ],
    ['member GET', () => GET_MEMBER(memberRequest('GET'), params())],
    ['member DELETE', () => DELETE_MEMBER(memberRequest('DELETE'), params())],
  ])('returns the standard 401 response for unauthenticated %s requests', async (_route, call) => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await call();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(createSavedSession).not.toHaveBeenCalled();
    expect(listSavedSessions).not.toHaveBeenCalled();
    expect(getSavedSession).not.toHaveBeenCalled();
    expect(deleteSavedSession).not.toHaveBeenCalled();
  });

  test('returns 400 for malformed JSON', async () => {
    const response = await POST(postRequest('{'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(createSavedSession).not.toHaveBeenCalled();
  });

  test.each([
    ['a malformed nested result', { ...payload, results: [{ ...result, types: [42] }] }],
    ['an invalid timestamp', { ...payload, timestamp: -1 }],
    ['a future timestamp', { ...payload, timestamp: Date.now() + 86_400_000 }],
    ['an invalid version', { ...payload, version: -1 }],
    ['a future version', { ...payload, version: SEARCH_SNAPSHOT_VERSION + 1 }],
  ])('returns 400 for %s', async (_label, invalidPayload) => {
    const response = await POST(
      postRequest(JSON.stringify({ name: 'Leeds retail', ...invalidPayload }))
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Payload must include a valid durable search snapshot',
    });
    expect(createSavedSession).not.toHaveBeenCalled();
  });

  test.each([
    ['', 'Name is required'],
    ['x'.repeat(121), 'Name must be at most 120 characters'],
  ])('bounds the saved-session name %#', async (name, message) => {
    const response = await POST(postRequest(JSON.stringify({ name, ...payload })));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(createSavedSession).not.toHaveBeenCalled();
  });

  test('strips browser-only fields before creating a session', async () => {
    const response = await POST(
      postRequest(
        JSON.stringify({
          name: '  Leeds retail  ',
          ...payload,
          selectedForEnrich: ['place-1'],
          enrichStatusMap: { 'place-1': 'complete' },
        })
      )
    );

    expect(response.status).toBe(200);
    expect(createSavedSession).toHaveBeenCalledWith('user-1', 'Leeds retail', payload);
  });

  test('lists a corrupt owned row with an explicit recovery status', async () => {
    listSavedSessions.mockResolvedValue([corruptMember]);

    const response = await GET_COLLECTION();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sessions: [corruptMember] });
  });

  test('returns a successful corrupt member status and message for its owner', async () => {
    getSavedSession.mockResolvedValue(corruptMember);

    const response = await GET_MEMBER(memberRequest('GET'), params('session-corrupt'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ session: corruptMember });
  });

  test('deletes a corrupt member so a subsequent lookup is absent', async () => {
    getSavedSession.mockResolvedValueOnce(corruptMember).mockResolvedValueOnce(null);

    const beforeDelete = await GET_MEMBER(memberRequest('GET'), params('session-corrupt'));
    const deleteResponse = await DELETE_MEMBER(memberRequest('DELETE'), params('session-corrupt'));
    const afterDelete = await GET_MEMBER(memberRequest('GET'), params('session-corrupt'));

    expect(beforeDelete.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({ ok: true });
    expect(afterDelete.status).toBe(404);
  });

  test('creates a canonical POST that the member GET can read', async () => {
    let storedRecord: typeof savedRecord | null = null;
    createSavedSession.mockImplementation(async (_userId, name, nextPayload) => {
      storedRecord = { ...savedRecord, name, payload: nextPayload };
      return storedRecord;
    });
    getSavedSession.mockImplementation(async () => storedRecord);

    const postResponse = await POST(
      postRequest(JSON.stringify({ name: 'Leeds retail', ...payload }))
    );
    const getResponse = await GET_MEMBER(memberRequest('GET'), params());

    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toEqual({ session: savedRecord });
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({ session: savedRecord });
  });

  test.each(['missing-session', 'foreign-session'])(
    'returns the same 404 for an absent or foreign member GET: %s',
    async (id) => {
      getSavedSession.mockResolvedValue(null);

      const response = await GET_MEMBER(memberRequest('GET'), params(id));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Not found' });
    }
  );

  test('returns the same 404 for a foreign-user member DELETE', async () => {
    deleteSavedSession.mockResolvedValue(false);

    const response = await DELETE_MEMBER(memberRequest('DELETE'), params('foreign-session'));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
  });

  test.each([
    ['collection GET', listSavedSessions, () => GET_COLLECTION(), 'Failed to fetch saved sessions'],
    [
      'collection POST',
      createSavedSession,
      () => POST(postRequest(JSON.stringify({ name: 'Leeds retail', ...payload }))),
      'Failed to create saved session',
    ],
    [
      'member GET',
      getSavedSession,
      () => GET_MEMBER(memberRequest('GET'), params()),
      'Failed to fetch saved session',
    ],
    [
      'member DELETE',
      deleteSavedSession,
      () => DELETE_MEMBER(memberRequest('DELETE'), params()),
      'Failed to delete saved session',
    ],
  ])(
    'returns a safe 500 when the %s store operation fails',
    async (_route, store, call, message) => {
      store.mockRejectedValueOnce(new Error('SQLite connection details'));

      const response = await call();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: message });
    }
  );
});
