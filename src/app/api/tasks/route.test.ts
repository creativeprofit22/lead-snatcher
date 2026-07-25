import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { countTasks, createTask, findTasks } = vi.hoisted(() => ({
  countTasks: vi.fn(),
  createTask: vi.fn(),
  findTasks: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn().mockResolvedValue('user-1') }));
vi.mock('@/lib/db', () => ({
  prisma: {
    task: { count: countTasks, create: createTask, findMany: findTasks },
  },
}));

import { GET, POST } from './route';

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

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/tasks ordering', () => {
  test('keeps due date primary and ranks equal due dates urgent to low', async () => {
    findTasks.mockResolvedValueOnce([
      task('later-urgent', 'urgent', new Date('2026-07-26T09:00:00.000Z')),
      task('medium', 'medium'),
      task('urgent', 'urgent'),
      task('low', 'low'),
      task('high', 'high'),
    ]);

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
    expect(body.tasks[0]).toEqual(
      expect.objectContaining({
        description: null,
        dueAt: sharedDueAt.toISOString(),
        completedAt: null,
        leadId: null,
        lead: null,
        createdAt: createdAt.toISOString(),
      })
    );
    expect(body).not.toHaveProperty('stats');
    expect(countTasks).not.toHaveBeenCalled();
  });
});

describe('POST /api/tasks serialization', () => {
  test('returns explicit nulls and ISO timestamps for a standalone task', async () => {
    createTask.mockResolvedValue(task('created', 'medium'));

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New task', dueAt: sharedDueAt.toISOString() }),
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      task: {
        id: 'created',
        title: 'medium task',
        description: null,
        type: 'other',
        dueAt: sharedDueAt.toISOString(),
        priority: 'medium',
        completedAt: null,
        leadId: null,
        lead: null,
        createdAt: createdAt.toISOString(),
      },
      message: 'Task created successfully',
    });
  });

  test.each([
    { title: '   ', dueAt: '2026-07-25T09:00:00Z' },
    { title: 'Follow up', dueAt: 'not-a-date' },
    { title: 'Follow up', dueAt: '2026-02-30T09:00:00Z' },
  ])('returns 400 without persistence for invalid task input %#', async (body) => {
    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    expect(response.status).toBe(400);
    expect(createTask).not.toHaveBeenCalled();
  });

  test('trims the title and persists a UTC-offset ISO due date', async () => {
    createTask.mockResolvedValue(task('created', 'medium'));
    const dueAt = '2026-07-25T09:00:00+05:30';

    const response = await POST(
      new Request('http://localhost/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '  New task  ', dueAt }),
      })
    );

    expect(response.status).toBe(200);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'New task', dueAt: new Date(dueAt) }),
      })
    );
  });
});

describe('GET /api/tasks calendar-day rules', () => {
  test('uses local calendar days for list filters without running summary queries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 25, 14, 0));

    const yesterday = task('yesterday', 'medium', new Date(2026, 6, 24, 16, 0));
    const earlierToday = task('earlier-today', 'medium', new Date(2026, 6, 25, 10, 0));
    const laterToday = task('later-today', 'medium', new Date(2026, 6, 25, 18, 0));

    findTasks.mockResolvedValueOnce([earlierToday, laterToday]).mockResolvedValueOnce([yesterday]);

    const todayResponse = await GET(new Request('http://localhost/api/tasks?due=today'));
    const todayBody = await todayResponse.json();
    const overdueResponse = await GET(new Request('http://localhost/api/tasks?due=overdue'));
    const overdueBody = await overdueResponse.json();

    const startOfToday = new Date(2026, 6, 25);
    const startOfTomorrow = new Date(2026, 6, 26);

    expect(findTasks).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          dueAt: { gte: startOfToday, lt: startOfTomorrow },
        }),
      })
    );
    expect(findTasks).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          completedAt: null,
          dueAt: { lt: startOfToday },
        }),
      })
    );
    expect(todayBody.tasks.map((item: { id: string }) => item.id)).toEqual([
      'earlier-today',
      'later-today',
    ]);
    expect(overdueBody.tasks.map((item: { id: string }) => item.id)).toEqual(['yesterday']);
    expect(todayBody).not.toHaveProperty('stats');
    expect(overdueBody).not.toHaveProperty('stats');
    expect(countTasks).not.toHaveBeenCalled();
  });

  test('returns opt-in summary counts from Prisma count queries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 25, 14, 0));
    findTasks.mockResolvedValueOnce([]);
    countTasks
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    const response = await GET(
      new Request('http://localhost/api/tasks?status=pending&include=stats')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      tasks: [],
      stats: { total: 5, pending: 4, completed: 1, overdue: 1, dueToday: 2 },
    });

    const userScope = { userId: 'user-1' };
    const startOfToday = new Date(2026, 6, 25);
    const startOfTomorrow = new Date(2026, 6, 26);
    expect(countTasks).toHaveBeenNthCalledWith(1, {
      where: { ...userScope, completedAt: null },
    });
    expect(countTasks).toHaveBeenNthCalledWith(2, {
      where: { ...userScope, completedAt: { not: null } },
    });
    expect(countTasks).toHaveBeenNthCalledWith(3, {
      where: { ...userScope, completedAt: null, dueAt: { lt: startOfToday } },
    });
    expect(countTasks).toHaveBeenNthCalledWith(4, {
      where: {
        ...userScope,
        completedAt: null,
        dueAt: { gte: startOfToday, lt: startOfTomorrow },
      },
    });
  });
});
