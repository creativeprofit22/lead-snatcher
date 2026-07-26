import { afterEach, describe, expect, test, vi } from 'vitest';

const { create, findMany, findUnique } = vi.hoisted(() => ({
  create: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn().mockResolvedValue('user-1') }));
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { create, findMany, findUnique },
  },
}));

import { createScoreBreakdown } from '@/lib/business/score-breakdown-contract';
import { encodeLeadListQuery, type LeadListQuery } from '@/lib/crm-lead-query';
import { GET, POST } from './route';

async function get(query: string) {
  return GET(new Request(`http://localhost/api/leads?${query}`));
}

async function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('GET /api/leads query validation', () => {
  test.each([
    ['minScore=abc', 'minScore must be an integer'],
    ['statuses=new,invalid', 'Invalid option: expected one of'],
    ['followUp=tomorrow', 'Invalid option: expected one of'],
    ['minScore=80&maxScore=20', 'minScore must be less than or equal to maxScore'],
  ])('returns 400 without querying Prisma for %s', async (query, expectedError) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await get(query);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(expectedError);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/leads Prisma query', () => {
  test('loads only relations serialized in the list response', async () => {
    findMany.mockResolvedValueOnce([]);

    const response = await get('');

    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { savedAt: 'desc' },
      include: {
        tags: { include: { tag: true } },
      },
    });
  });

  test('maps a complete canonical query to the current Prisma query', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 25, 15, 30));
    findMany.mockResolvedValueOnce([]);
    const query: LeadListQuery = {
      statuses: ['contacted', 'proposal_sent'],
      industries: ['medical', 'restaurant'],
      tags: ['tag-1', 'tag-2'],
      minScore: 20,
      maxScore: 85,
      followUp: 'this_week',
      sortBy: 'nextFollowUpAt',
      sortOrder: 'asc',
    };
    const startOfDay = new Date(2026, 6, 25);
    const endOfWeek = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

    const response = await get(encodeLeadListQuery(query).toString());

    expect(response.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: { in: ['contacted', 'proposal_sent'] },
        leadScore: { gte: 20, lte: 85 },
        industryType: { in: ['medical', 'restaurant'] },
        nextFollowUpAt: { gte: startOfDay, lte: endOfWeek },
        tags: { some: { tagId: { in: ['tag-1', 'tag-2'] } } },
      },
      orderBy: { nextFollowUpAt: 'asc' },
      include: {
        tags: { include: { tag: true } },
      },
    });
  });
});

describe('POST /api/leads score breakdown contract', () => {
  test('rejects malformed score field types before querying Prisma', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post({
      placeId: 'place-1',
      name: 'Acme Dental',
      scoreBreakdown: { qualityChips: 'No website' },
    });

    expect(response.status).toBe(400);
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test('normalizes legacy partial records and strips unknown keys before persistence', async () => {
    const normalizedScoreBreakdown = createScoreBreakdown({ noWebsite: 20 });
    const timestamp = new Date('2026-07-25T10:00:00.000Z');

    create.mockResolvedValueOnce({
      id: 'lead-1',
      userId: 'user-1',
      placeId: 'place-1',
      name: 'Acme Dental',
      address: null,
      phone: null,
      website: null,
      rating: null,
      reviewCount: null,
      industryType: 'other',
      photoUrl: null,
      mapsUrl: null,
      leadScore: 0,
      scoreBreakdown: JSON.stringify(normalizedScoreBreakdown),
      opportunities: '[]',
      status: 'new',
      notes: null,
      lastContactedAt: null,
      nextFollowUpAt: null,
      popularTimesData: null,
      popularTimesScrapedAt: null,
      savedAt: timestamp,
      updatedAt: timestamp,
      tags: [],
    });

    const response = await post({
      placeId: 'place-1',
      name: 'Acme Dental',
      scoreBreakdown: { noWebsite: 20, futureSignal: 9 },
    });

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          industryType: 'other',
          leadScore: 0,
          scoreBreakdown: JSON.stringify(normalizedScoreBreakdown),
        }),
      })
    );
    expect((await response.json()).lead.scoreBreakdown).toEqual(normalizedScoreBreakdown);
  });
});
