import { beforeEach, describe, expect, test, vi } from 'vitest';

const { findTasks } = vi.hoisted(() => ({
  findTasks: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn().mockResolvedValue('user-1') }));
vi.mock('@/lib/db', () => ({
  prisma: {
    task: { findMany: findTasks },
  },
}));

import { GET } from './route';

const sharedDueAt = new Date('2026-07-25T09:00:00.000Z');
const createdAt = new Date('2026-07-24T09:00:00.000Z');

function task(id: string, priority: string, dueAt = sharedDueAt) {
  return {
    id,
    title: `${priority} task`,
    description: null,
    type: 'other',
    dueAt,
    priority,
    completedAt: null,
    leadId: null,
    lead: null,
    createdAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/tasks ordering', () => {
  test('keeps due date primary and ranks equal due dates urgent to low', async () => {
    findTasks
      .mockResolvedValueOnce([
        task('later-urgent', 'urgent', new Date('2026-07-26T09:00:00.000Z')),
        task('medium', 'medium'),
        task('urgent', 'urgent'),
        task('low', 'low'),
        task('high', 'high'),
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(new Request('http://localhost/api/tasks?status=all'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findTasks).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ orderBy: { dueAt: 'asc' } })
    );
    expect(body.tasks.map((item: { id: string }) => item.id)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      'later-urgent',
    ]);
  });
});
