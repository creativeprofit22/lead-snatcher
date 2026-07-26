import { afterEach, describe, expect, test, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn().mockResolvedValue('user-1') }));
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { findMany },
  },
}));

import { GET } from './route';

async function get(query: string) {
  return GET(new Request(`http://localhost/api/leads?${query}`));
}

afterEach(() => {
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
});
