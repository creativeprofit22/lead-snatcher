import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  findLeads,
  updateLeads,
  deleteLeads,
  findTag,
  findLinks,
  createLinks,
  createLink,
  runTransaction,
} = vi.hoisted(() => ({
  findLeads: vi.fn(),
  updateLeads: vi.fn(),
  deleteLeads: vi.fn(),
  findTag: vi.fn(),
  findLinks: vi.fn(),
  createLinks: vi.fn(),
  createLink: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn().mockResolvedValue('user-1') }));
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { findMany: findLeads, updateMany: updateLeads },
    $transaction: runTransaction,
  },
}));

import { DELETE, PATCH } from './route';

const transactionClient = {
  lead: { findMany: findLeads, updateMany: updateLeads, deleteMany: deleteLeads },
  tag: { findFirst: findTag },
  leadTag: { findMany: findLinks, createMany: createLinks, create: createLink },
};

function patch(body: unknown) {
  return PATCH(
    new Request('http://localhost/api/leads/bulk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

function remove(body: unknown) {
  return DELETE(
    new Request('http://localhost/api/leads/bulk', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findLeads.mockResolvedValue([{ id: 'lead-1' }, { id: 'lead-2' }, { id: 'lead-3' }]);
  updateLeads.mockResolvedValue({ count: 3 });
  deleteLeads.mockResolvedValue({ count: 3 });
  findTag.mockResolvedValue({ name: 'Priority' });
  findLinks.mockResolvedValue([]);
  createLinks.mockResolvedValue({ count: 3 });
  runTransaction.mockImplementation(
    (operation: (client: typeof transactionClient) => Promise<unknown>) =>
      operation(transactionClient)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PATCH /api/leads/bulk status', () => {
  test('updates every owned lead and records the contact timestamp', async () => {
    const response = await patch({
      action: 'status',
      leadIds: ['lead-1', 'lead-2', 'lead-3'],
      status: 'contacted',
    });

    expect(response.status).toBe(200);
    expect(updateLeads).toHaveBeenCalledWith({
      where: {
        id: { in: ['lead-1', 'lead-2', 'lead-3'] },
        userId: 'user-1',
      },
      data: {
        status: 'contacted',
        lastContactedAt: expect.any(Date),
      },
    });
    await expect(response.json()).resolves.toEqual({ count: 3 });
  });
});

describe('PATCH /api/leads/bulk add_tag', () => {
  test('rejects duplicate lead IDs before querying the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await patch({
      action: 'add_tag',
      leadIds: ['lead-1', 'lead-1'],
      tagId: 'tag-1',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Lead IDs must be unique' });
    expect(findLeads).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  test('rejects empty lead IDs before querying the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await patch({
      action: 'add_tag',
      leadIds: ['lead-1', '   '],
      tagId: 'tag-1',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Lead IDs cannot be empty' });
    expect(findLeads).not.toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
  });

  test('creates mixed existing and new links in one transaction and reports actual counts', async () => {
    findLinks.mockResolvedValue([{ leadId: 'lead-1' }]);
    createLinks.mockResolvedValue({ count: 2 });

    const response = await patch({
      action: 'add_tag',
      leadIds: ['lead-1', 'lead-2', 'lead-3'],
      tagId: 'tag-1',
    });

    expect(response.status).toBe(200);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(findLinks).toHaveBeenCalledWith({
      where: { leadId: { in: ['lead-1', 'lead-2', 'lead-3'] }, tagId: 'tag-1' },
      select: { leadId: true },
    });
    expect(createLinks).toHaveBeenCalledTimes(1);
    expect(createLinks).toHaveBeenCalledWith({
      data: [
        { leadId: 'lead-2', tagId: 'tag-1' },
        { leadId: 'lead-3', tagId: 'tag-1' },
      ],
    });
    expect(createLink).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      message: 'Added tag "Priority" to 2 leads',
      requestedCount: 3,
      alreadyPresentCount: 1,
      addedCount: 2,
    });
  });

  test('is idempotent when every lead already has the tag', async () => {
    findLinks.mockResolvedValue([{ leadId: 'lead-1' }, { leadId: 'lead-2' }, { leadId: 'lead-3' }]);

    const response = await patch({
      action: 'add_tag',
      leadIds: ['lead-1', 'lead-2', 'lead-3'],
      tagId: 'tag-1',
    });

    expect(response.status).toBe(200);
    expect(createLinks).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      message: 'Added tag "Priority" to 0 leads',
      requestedCount: 3,
      alreadyPresentCount: 3,
      addedCount: 0,
    });
  });

  test('rejects a foreign lead before starting the tag transaction', async () => {
    findLeads.mockResolvedValue([{ id: 'lead-1' }]);

    const response = await patch({
      action: 'add_tag',
      leadIds: ['lead-1', 'foreign-lead'],
      tagId: 'tag-1',
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Some leads not found' });
    expect(runTransaction).not.toHaveBeenCalled();
    expect(createLinks).not.toHaveBeenCalled();
  });

  test('rejects a foreign tag without writing links', async () => {
    findTag.mockResolvedValue(null);

    const response = await patch({
      action: 'add_tag',
      leadIds: ['lead-1', 'lead-2', 'lead-3'],
      tagId: 'foreign-tag',
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Tag not found' });
    expect(findTag).toHaveBeenCalledWith({
      where: { id: 'foreign-tag', userId: 'user-1' },
      select: { name: true },
    });
    expect(findLinks).not.toHaveBeenCalled();
    expect(createLinks).not.toHaveBeenCalled();
  });

  test('uses one transactional batch so a failed write cannot partially add links', async () => {
    const databaseError = new Error('Batch failed');
    createLinks.mockRejectedValue(databaseError);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await patch({
      action: 'add_tag',
      leadIds: ['lead-1', 'lead-2', 'lead-3'],
      tagId: 'tag-1',
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update leads' });
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(createLinks).toHaveBeenCalledTimes(1);
    expect(createLinks).toHaveBeenCalledWith({
      data: [
        { leadId: 'lead-1', tagId: 'tag-1' },
        { leadId: 'lead-2', tagId: 'tag-1' },
        { leadId: 'lead-3', tagId: 'tag-1' },
      ],
    });
    expect(createLink).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/leads/bulk', () => {
  test.each([
    { leadIds: ['lead-1', '   '], error: 'Lead IDs cannot be empty' },
    { leadIds: ['lead-1', 'lead-1'], error: 'Lead IDs must be unique' },
  ])('rejects invalid lead IDs before starting a transaction', async ({ leadIds, error }) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await remove({ leadIds });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(runTransaction).not.toHaveBeenCalled();
    expect(deleteLeads).not.toHaveBeenCalled();
  });

  test('rejects missing or foreign leads without deleting owned matches', async () => {
    findLeads.mockResolvedValue([{ id: 'lead-1' }]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await remove({ leadIds: ['lead-1', 'foreign-lead'] });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Some leads not found' });
    expect(findLeads).toHaveBeenCalledWith({
      where: { id: { in: ['lead-1', 'foreign-lead'] }, userId: 'user-1' },
      select: { id: true },
    });
    expect(deleteLeads).not.toHaveBeenCalled();
  });

  test('deletes every owned lead transactionally and returns the committed count', async () => {
    const response = await remove({ leadIds: ['lead-1', 'lead-2', 'lead-3'] });

    expect(response.status).toBe(200);
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(deleteLeads).toHaveBeenCalledWith({
      where: {
        id: { in: ['lead-1', 'lead-2', 'lead-3'] },
        userId: 'user-1',
      },
    });
    await expect(response.json()).resolves.toEqual({ count: 3 });
  });

  test('reports a transaction failure without claiming any deletions', async () => {
    deleteLeads.mockRejectedValue(new Error('Delete failed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await remove({ leadIds: ['lead-1', 'lead-2', 'lead-3'] });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to delete leads' });
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(deleteLeads).toHaveBeenCalledTimes(1);
  });
});
