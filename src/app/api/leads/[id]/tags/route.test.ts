import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getCurrentUserId,
  findLead,
  findTag,
  findLink,
  createLink,
  upsertLink,
  findLinks,
  deleteLinks,
} = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  findLead: vi.fn(),
  findTag: vi.fn(),
  findLink: vi.fn(),
  createLink: vi.fn(),
  upsertLink: vi.fn(),
  findLinks: vi.fn(),
  deleteLinks: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { findFirst: findLead },
    tag: { findFirst: findTag },
    leadTag: {
      findUnique: findLink,
      create: createLink,
      upsert: upsertLink,
      findMany: findLinks,
      deleteMany: deleteLinks,
    },
  },
}));

import { DELETE, POST } from './route';

const params = Promise.resolve({ id: 'lead-1' });
const createdAt = new Date('2026-07-25T09:00:00.000Z');
const tag = {
  id: 'tag-1',
  userId: 'user-1',
  name: 'Priority',
  color: '#3b82f6',
  createdAt,
};

function post(body: BodyInit) {
  return POST(
    new Request('http://localhost/api/leads/lead-1/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    { params }
  );
}

function remove(search = '?tagId=tag-1') {
  return DELETE(
    new Request(`http://localhost/api/leads/lead-1/tags${search}`, { method: 'DELETE' }),
    { params }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserId.mockResolvedValue('user-1');
  findLead.mockResolvedValue({ id: 'lead-1', userId: 'user-1' });
  findTag.mockResolvedValue(tag);
  findLink.mockResolvedValue(null);
  createLink.mockResolvedValue({ leadId: 'lead-1', tagId: 'tag-1' });
  upsertLink.mockResolvedValue({ id: 'link-1', leadId: 'lead-1', tagId: 'tag-1' });
  findLinks.mockResolvedValue([{ tag }]);
  deleteLinks.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/leads/[id]/tags', () => {
  test('returns 401 when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await post(JSON.stringify({ tagId: 'tag-1' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findLead).not.toHaveBeenCalled();
  });

  test('returns 400 for malformed JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post('{"tagId":');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(findLead).not.toHaveBeenCalled();
  });

  test.each([{}, { tagId: '   ' }])('returns 400 for a missing or invalid tagId', async (body) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(JSON.stringify(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Tag ID is required' });
    expect(findLead).not.toHaveBeenCalled();
  });

  test('adds an owned tag to an owned lead and preserves the response shape', async () => {
    const response = await post(JSON.stringify({ tagId: ' tag-1 ' }));

    expect(response.status).toBe(200);
    expect(findLead).toHaveBeenCalledWith({ where: { id: 'lead-1', userId: 'user-1' } });
    expect(findTag).toHaveBeenCalledWith({ where: { id: 'tag-1', userId: 'user-1' } });
    expect(upsertLink).toHaveBeenCalledOnce();
    expect(upsertLink).toHaveBeenCalledWith({
      where: { leadId_tagId: { leadId: 'lead-1', tagId: 'tag-1' } },
      create: { leadId: 'lead-1', tagId: 'tag-1' },
      update: {},
    });
    expect(findLink).not.toHaveBeenCalled();
    expect(createLink).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      tags: [
        {
          id: 'tag-1',
          name: 'Priority',
          color: '#3b82f6',
          createdAt: createdAt.toISOString(),
        },
      ],
    });
  });

  test('returns the current tags when the equivalent link is already attached', async () => {
    upsertLink.mockResolvedValue({
      id: 'existing-link',
      leadId: 'lead-1',
      tagId: 'tag-1',
    });

    const response = await post(JSON.stringify({ tagId: 'tag-1' }));

    expect(response.status).toBe(200);
    expect(upsertLink).toHaveBeenCalledOnce();
    expect(upsertLink).toHaveBeenCalledWith({
      where: { leadId_tagId: { leadId: 'lead-1', tagId: 'tag-1' } },
      create: { leadId: 'lead-1', tagId: 'tag-1' },
      update: {},
    });
    expect(findLink).not.toHaveBeenCalled();
    expect(createLink).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      tags: [
        {
          id: 'tag-1',
          name: 'Priority',
          color: '#3b82f6',
          createdAt: createdAt.toISOString(),
        },
      ],
    });
  });

  test.each(['foreign', 'nonexistent'])('returns the same 404 for a %s tag ID', async () => {
    findTag.mockResolvedValue(null);

    const response = await post(JSON.stringify({ tagId: 'tag-1' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Tag not found' });
    expect(upsertLink).not.toHaveBeenCalled();
  });

  test('returns 404 for a foreign or missing lead before looking up the tag', async () => {
    findLead.mockResolvedValue(null);

    const response = await post(JSON.stringify({ tagId: 'tag-1' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
    expect(findTag).not.toHaveBeenCalled();
  });

  test('returns only the fallback message for unexpected database errors', async () => {
    findLead.mockRejectedValue(new Error('SQLite connection details'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(JSON.stringify({ tagId: 'tag-1' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to add tag' });
  });
});

describe('DELETE /api/leads/[id]/tags', () => {
  test.each(['', '?tagId=%20%20%20'])(
    'returns 400 for a missing or invalid tagId',
    async (search) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await remove(search);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'Tag ID is required' });
      expect(findLead).not.toHaveBeenCalled();
    }
  );

  test('removes an owned tag from an owned lead and preserves the response shape', async () => {
    findLinks.mockResolvedValue([]);

    const response = await remove('?tagId=%20tag-1%20');

    expect(response.status).toBe(200);
    expect(findLead).toHaveBeenCalledWith({ where: { id: 'lead-1', userId: 'user-1' } });
    expect(findTag).toHaveBeenCalledWith({ where: { id: 'tag-1', userId: 'user-1' } });
    expect(deleteLinks).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', tagId: 'tag-1' },
    });
    await expect(response.json()).resolves.toEqual({ tags: [] });
  });

  test.each(['foreign', 'nonexistent'])('returns the same 404 for a %s tag ID', async () => {
    findTag.mockResolvedValue(null);

    const response = await remove();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Tag not found' });
    expect(deleteLinks).not.toHaveBeenCalled();
  });

  test('returns only the fallback message for unexpected database errors', async () => {
    deleteLinks.mockRejectedValue(new Error('SQLite connection details'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await remove();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to remove tag' });
  });
});
