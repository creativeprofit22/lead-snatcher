import { beforeEach, describe, expect, test, vi } from 'vitest';

const { findTask, findLead, updateTask } = vi.hoisted(() => ({
  findTask: vi.fn(),
  findLead: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn().mockResolvedValue('user-1') }));
vi.mock('@/lib/db', () => ({
  prisma: {
    task: { findFirst: findTask, update: updateTask },
    lead: { findFirst: findLead },
  },
}));

import { PATCH } from './route';

const params = Promise.resolve({ id: 'task-1' });
const storedTask = {
  id: 'task-1',
  title: 'Follow up',
  description: null,
  type: 'call',
  dueAt: new Date('2026-07-25T09:00:00.000Z'),
  priority: 'medium',
  completedAt: null,
  leadId: 'lead-2',
  lead: { id: 'lead-2', name: 'New Lead' },
  createdAt: new Date('2026-07-24T09:00:00.000Z'),
};

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findTask.mockResolvedValue({ id: 'task-1', userId: 'user-1' });
  findLead.mockResolvedValue({ id: 'lead-2', userId: 'user-1' });
  updateTask.mockResolvedValue(storedTask);
});

describe('PATCH /api/tasks/[id] lead assignment', () => {
  test('verifies ownership, connects the lead, and returns the updated relation', async () => {
    const response = await patch({ leadId: 'lead-2' });

    expect(response.status).toBe(200);
    expect(findLead).toHaveBeenCalledWith({ where: { id: 'lead-2', userId: 'user-1' } });
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lead: { connect: { id: 'lead-2' } } } })
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        task: expect.objectContaining({
          leadId: 'lead-2',
          lead: { id: 'lead-2', name: 'New Lead' },
        }),
      })
    );
  });

  test('disconnects the current lead when leadId is null', async () => {
    updateTask.mockResolvedValue({ ...storedTask, leadId: null, lead: null });

    const response = await patch({ leadId: null });

    expect(response.status).toBe(200);
    expect(findLead).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lead: { disconnect: true } } })
    );
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ task: expect.objectContaining({ leadId: null, lead: null }) })
    );
  });

  test('clears the description when description is null', async () => {
    const response = await patch({ description: null });

    expect(response.status).toBe(200);
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ data: { description: null } })
    );
  });

  test('returns a completed timestamp as ISO JSON', async () => {
    const completedAt = new Date('2026-07-25T11:30:00.000Z');
    updateTask.mockResolvedValue({ ...storedTask, completedAt });

    const response = await patch({ completedAt: completedAt.toISOString() });

    expect(updateTask).toHaveBeenCalledWith(expect.objectContaining({ data: { completedAt } }));
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        task: expect.objectContaining({ completedAt: completedAt.toISOString() }),
      })
    );
  });

  test('rejects a lead that does not belong to the authenticated user', async () => {
    findLead.mockResolvedValue(null);

    const response = await patch({ leadId: 'foreign-lead' });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tasks/[id] validation', () => {
  test.each([{ title: '   ' }, { dueAt: 'not-a-date' }, { dueAt: '2026-02-30T09:00:00Z' }])(
    'returns 400 before querying Prisma for invalid input %#',
    async (body) => {
      const response = await patch(body);

      expect(response.status).toBe(400);
      expect(findTask).not.toHaveBeenCalled();
      expect(findLead).not.toHaveBeenCalled();
      expect(updateTask).not.toHaveBeenCalled();
    }
  );

  test('accepts a UTC-offset ISO due date', async () => {
    const dueAt = '2026-07-25T09:00:00-04:00';

    const response = await patch({ dueAt });

    expect(response.status).toBe(200);
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ data: { dueAt: new Date(dueAt) } })
    );
  });

  test('does not add omitted fields to PATCH data', async () => {
    const response = await patch({ priority: 'high' });

    expect(response.status).toBe(200);
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ data: { priority: 'high' } })
    );
  });
});
