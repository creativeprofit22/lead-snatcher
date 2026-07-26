import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { BusinessSearchResult } from '@/types';
import { createScoreBreakdown } from './score-breakdown-contract';
import { SEARCH_SNAPSHOT_VERSION, type PersistedSearchPayload } from './search-snapshot';

const savedSearchSession = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { savedSearchSession } }));

import {
  CORRUPT_SAVED_SESSION_MESSAGE,
  createSavedSession,
  deleteSavedSession,
  getSavedSession,
  listSavedSessions,
} from './saved-sessions-store';

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

const createdAt = new Date('2026-07-25T09:00:00.000Z');
const updatedAt = new Date('2026-07-25T10:00:00.000Z');

function row(rawPayload: string) {
  return {
    id: 'session-1',
    userId: 'user-1',
    name: 'Leeds retail',
    payload: rawPayload,
    createdAt,
    updatedAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  savedSearchSession.create.mockResolvedValue(row(JSON.stringify(payload)));
  savedSearchSession.findMany.mockResolvedValue([]);
  savedSearchSession.findFirst.mockResolvedValue(null);
  savedSearchSession.delete.mockResolvedValue(row(JSON.stringify(payload)));
});

describe('saved session store', () => {
  test('lists an owned corrupt row explicitly without fabricated search metadata', async () => {
    savedSearchSession.findMany.mockResolvedValue([row('{"results":')]);

    const sessions = await listSavedSessions('user-1');

    expect(savedSearchSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { updatedAt: 'desc' },
    });
    expect(sessions).toEqual([
      {
        id: 'session-1',
        name: 'Leeds retail',
        status: 'corrupt',
        message: CORRUPT_SAVED_SESSION_MESSAGE,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
    ]);
    expect(sessions[0]).not.toHaveProperty('businessType');
    expect(sessions[0]).not.toHaveProperty('city');
    expect(sessions[0]).not.toHaveProperty('resultCount');
  });

  test('returns an explicit corrupt member for an owned invalid row', async () => {
    savedSearchSession.findFirst.mockResolvedValue(row('not-json'));

    await expect(getSavedSession('user-1', 'session-1')).resolves.toEqual({
      id: 'session-1',
      name: 'Leeds retail',
      status: 'corrupt',
      message: CORRUPT_SAVED_SESSION_MESSAGE,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
    expect(savedSearchSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-1', userId: 'user-1' },
    });
  });

  test.each(['missing-session', 'foreign-session'])(
    'keeps an absent owned row indistinguishable for %s',
    async (id) => {
      await expect(getSavedSession('user-1', id)).resolves.toBeNull();
      expect(savedSearchSession.findFirst).toHaveBeenCalledWith({
        where: { id, userId: 'user-1' },
      });
    }
  );

  test('loads a valid legacy row through canonical migration', async () => {
    const legacyPayload = {
      version: 2,
      results: payload.results,
      industry: payload.industry,
      city: payload.city,
      country: payload.country,
      timestamp: payload.timestamp,
    };
    savedSearchSession.findFirst.mockResolvedValue(row(JSON.stringify(legacyPayload)));

    const session = await getSavedSession('user-1', 'session-1');

    expect(session).toMatchObject({
      status: 'ready',
      businessType: 'retail',
      industry: 'retail',
      city: 'Leeds',
      resultCount: 1,
      payload: {
        ...legacyPayload,
        businessType: 'retail',
        version: SEARCH_SNAPSHOT_VERSION,
      },
    });
  });

  test('saves, lists, and loads a valid canonical session', async () => {
    const validRow = row(JSON.stringify(payload));
    savedSearchSession.create.mockResolvedValue(validRow);
    savedSearchSession.findMany.mockResolvedValue([validRow]);
    savedSearchSession.findFirst.mockResolvedValue(validRow);

    const created = await createSavedSession('user-1', '  Leeds retail  ', payload);
    const listed = await listSavedSessions('user-1');
    const loaded = await getSavedSession('user-1', 'session-1');

    expect(savedSearchSession.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        name: 'Leeds retail',
        payload: JSON.stringify(payload),
      },
    });
    expect(created).toEqual({ ...listed[0], payload });
    expect(loaded).toEqual(created);
    expect(created.status).toBe('ready');
  });

  test('deletes a corrupt owned row so it no longer appears', async () => {
    const corruptRow = row('not-json');
    savedSearchSession.findFirst.mockResolvedValue(corruptRow);
    savedSearchSession.findMany.mockResolvedValueOnce([corruptRow]).mockResolvedValueOnce([]);

    expect(await listSavedSessions('user-1')).toHaveLength(1);
    await expect(deleteSavedSession('user-1', 'session-1')).resolves.toBe(true);
    await expect(listSavedSessions('user-1')).resolves.toEqual([]);
    expect(savedSearchSession.delete).toHaveBeenCalledWith({ where: { id: 'session-1' } });
  });
});
