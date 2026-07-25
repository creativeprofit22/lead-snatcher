import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { getCurrentUserId, findTag, updateTag, deleteTag } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  findTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({
  prisma: {
    tag: { findFirst: findTag, update: updateTag, delete: deleteTag },
  },
}));

import { DELETE, PATCH } from './route';

const createdAt = new Date('2026-07-25T09:00:00.000Z');
const params = Promise.resolve({ id: 'tag-1' });
const storedTag = {
  id: 'tag-1',
  userId: 'user-1',
  name: 'Priority',
  color: '#3b82f6',
  createdAt,
};
const updatedTag = { ...storedTag, color: '#ef4444', _count: { leads: 2 } };

function patch(body: BodyInit) {
  return PATCH(
    new Request('http://localhost/api/tags/tag-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    { params }
  );
}

function remove() {
  return DELETE(new Request('http://localhost/api/tags/tag-1', { method: 'DELETE' }), { params });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserId.mockResolvedValue('user-1');
  findTag.mockResolvedValue(storedTag);
  updateTag.mockResolvedValue(updatedTag);
  deleteTag.mockResolvedValue(storedTag);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PATCH /api/tags/[id]', () => {
  test('returns 401 when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await patch(JSON.stringify({ color: '#ef4444' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findTag).not.toHaveBeenCalled();
  });

  test('returns 400 for malformed JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await patch('{"color":');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(findTag).not.toHaveBeenCalled();
  });

  test('updates a tag owned by the authenticated user', async () => {
    const response = await patch(JSON.stringify({ color: '#ef4444' }));

    expect(response.status).toBe(200);
    expect(findTag).toHaveBeenCalledWith({ where: { id: 'tag-1', userId: 'user-1' } });
    expect(updateTag).toHaveBeenCalledWith({
      where: { id: 'tag-1' },
      data: { color: '#ef4444' },
      include: { _count: { select: { leads: true } } },
    });
    await expect(response.json()).resolves.toEqual({
      tag: {
        id: 'tag-1',
        name: 'Priority',
        color: '#ef4444',
        leadCount: 2,
        createdAt: createdAt.toISOString(),
      },
    });
  });

  test.each(['foreign', 'nonexistent'])('returns the same 404 for a %s tag ID', async () => {
    findTag.mockResolvedValue(null);

    const response = await patch(JSON.stringify({ color: '#ef4444' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Tag not found' });
    expect(updateTag).not.toHaveBeenCalled();
  });

  test('returns only the fallback message for unexpected database errors', async () => {
    findTag.mockRejectedValue(new Error('SQLite connection details'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await patch(JSON.stringify({ color: '#ef4444' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update tag' });
  });
});

describe('DELETE /api/tags/[id]', () => {
  test('deletes an owned tag through the cascading tag delete', async () => {
    const response = await remove();

    expect(response.status).toBe(200);
    expect(findTag).toHaveBeenCalledWith({ where: { id: 'tag-1', userId: 'user-1' } });
    expect(deleteTag).toHaveBeenCalledWith({ where: { id: 'tag-1' } });
    await expect(response.json()).resolves.toEqual({ message: 'Tag deleted successfully' });
  });

  test.each(['foreign', 'nonexistent'])('returns the same 404 for a %s tag ID', async () => {
    findTag.mockResolvedValue(null);

    const response = await remove();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Tag not found' });
    expect(deleteTag).not.toHaveBeenCalled();
  });

  test('returns only the fallback message for unexpected database errors', async () => {
    deleteTag.mockRejectedValue(new Error('SQLite connection details'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await remove();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to delete tag' });
  });
});
