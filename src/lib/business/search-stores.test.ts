import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { BusinessSearchResult } from '@/types';
import { createScoreBreakdown } from './score-breakdown-contract';
import { putLastSearch } from './last-search-store';
import { createSavedSession, listSavedSessions } from './saved-sessions-store';
import {
  SEARCH_SNAPSHOT_RESULT_LIMIT,
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
} from './search-snapshot';

const prismaMocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  lastSearchFindUnique: vi.fn(),
  lastSearchUpsert: vi.fn(),
  savedSessionCreate: vi.fn(),
  savedSessionFindMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: prismaMocks.transaction,
    lastSearchSession: {
      findUnique: prismaMocks.lastSearchFindUnique,
      upsert: prismaMocks.lastSearchUpsert,
    },
    savedSearchSession: {
      create: prismaMocks.savedSessionCreate,
      findMany: prismaMocks.savedSessionFindMany,
    },
  },
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMocks.lastSearchFindUnique.mockResolvedValue(null);
  prismaMocks.lastSearchUpsert.mockResolvedValue({});
  prismaMocks.transaction.mockImplementation((callback) =>
    callback({
      lastSearchSession: {
        findUnique: prismaMocks.lastSearchFindUnique,
        upsert: prismaMocks.lastSearchUpsert,
      },
    })
  );
  prismaMocks.savedSessionCreate.mockResolvedValue({
    id: 'session-1',
    name: 'Leeds retail',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  prismaMocks.savedSessionFindMany.mockResolvedValue([]);
});

describe('durable search store boundaries', () => {
  test('last-search rejects asserted payloads that bypass the TypeScript contract', async () => {
    const invalidPayload = {
      ...payload,
      results: [{ ...result, types: [42] }],
    } as unknown as PersistedSearchPayload;

    await expect(putLastSearch('user-1', invalidPayload)).rejects.toThrow(
      'Invalid persisted search payload'
    );
    expect(prismaMocks.lastSearchUpsert).not.toHaveBeenCalled();
  });

  test('saved sessions reject oversized asserted result arrays before writing', async () => {
    const invalidPayload = {
      ...payload,
      results: Array.from({ length: SEARCH_SNAPSHOT_RESULT_LIMIT + 1 }, (_, index) => ({
        ...result,
        placeId: `place-${index}`,
      })),
    } as PersistedSearchPayload;

    await expect(createSavedSession('user-1', 'Too large', invalidPayload)).rejects.toThrow(
      'Invalid persisted search payload'
    );
    expect(prismaMocks.savedSessionCreate).not.toHaveBeenCalled();
  });

  test('stores only the canonical payload after stripping unknown top-level state', async () => {
    const payloadWithBrowserState = {
      ...payload,
      selectedForEnrich: ['place-1'],
      futureTopLevelField: true,
    } as PersistedSearchPayload;

    await putLastSearch('user-1', payloadWithBrowserState);

    const call = prismaMocks.lastSearchUpsert.mock.calls[0]?.[0];
    const stored = JSON.parse(call.create.payload) as Record<string, unknown>;
    expect(stored).toEqual(payload);
    expect(stored).not.toHaveProperty('selectedForEnrich');
    expect(stored).not.toHaveProperty('futureTopLevelField');
  });

  test('keeps a newer accepted snapshot when an older client writes later', async () => {
    const newer = { ...payload, city: 'York', timestamp: payload.timestamp + 1 };
    prismaMocks.lastSearchFindUnique.mockResolvedValue({ payload: JSON.stringify(newer) });

    await expect(putLastSearch('user-1', payload)).resolves.toEqual(newer);

    expect(prismaMocks.lastSearchUpsert).not.toHaveBeenCalled();
  });

  test('replaces an older accepted snapshot with a newer client write', async () => {
    const older = { ...payload, timestamp: payload.timestamp - 1 };
    prismaMocks.lastSearchFindUnique.mockResolvedValue({ payload: JSON.stringify(older) });

    await expect(putLastSearch('user-1', payload)).resolves.toEqual(payload);

    expect(prismaMocks.lastSearchUpsert).toHaveBeenCalledOnce();
  });

  test('uses the custom business query in saved-session summaries', async () => {
    prismaMocks.savedSessionFindMany.mockResolvedValue([
      {
        id: 'session-1',
        name: 'Austin HVAC',
        payload: JSON.stringify({
          ...payload,
          businessType: 'HVAC contractors',
          industry: 'other',
          city: 'Austin',
          country: 'us',
        }),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    await expect(listSavedSessions('user-1')).resolves.toEqual([
      expect.objectContaining({
        businessType: 'HVAC contractors',
        industry: 'other',
        city: 'Austin',
      }),
    ]);
  });
});
