import { afterEach, describe, expect, test, vi } from 'vitest';

const { auth, findLead } = vi.hoisted(() => ({
  auth: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
  findLead: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { findFirst: findLead },
  },
}));

import { GET } from './route';

const context = { params: Promise.resolve({ id: 'lead-1' }) };

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('GET /api/leads/[id] Prisma query', () => {
  test('loads only relations serialized in the detail response', async () => {
    const response = await GET(new Request('http://localhost/api/leads/lead-1'), context);

    expect(response.status).toBe(404);
    expect(findLead).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1' },
      include: {
        tags: { include: { tag: true } },
      },
    });
  });
});
