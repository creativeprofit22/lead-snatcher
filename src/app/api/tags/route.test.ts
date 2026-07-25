import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { getCurrentUserId, findTags, findTag, createTag } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  findTags: vi.fn(),
  findTag: vi.fn(),
  createTag: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({
  prisma: {
    tag: { findMany: findTags, findUnique: findTag, create: createTag },
  },
}));

import { GET, POST } from './route';

const createdAt = new Date('2026-07-25T09:00:00.000Z');
const storedTag = {
  id: 'tag-1',
  userId: 'user-1',
  name: 'Priority',
  color: '#3b82f6',
  createdAt,
};

function post(body: BodyInit) {
  return POST(
    new Request('http://localhost/api/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserId.mockResolvedValue('user-1');
  findTags.mockResolvedValue([]);
  findTag.mockResolvedValue(null);
  createTag.mockResolvedValue(storedTag);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/tags', () => {
  test('returns 401 when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findTags).not.toHaveBeenCalled();
  });

  test('returns 400 for malformed JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post('{"name":');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(findTag).not.toHaveBeenCalled();
  });

  test('creates an owned tag without changing the successful response shape', async () => {
    const response = await post(JSON.stringify({ name: '  Priority  ', color: '#3b82f6' }));

    expect(response.status).toBe(200);
    expect(createTag).toHaveBeenCalledWith({
      data: { userId: 'user-1', name: 'Priority', color: '#3b82f6' },
    });
    await expect(response.json()).resolves.toEqual({
      tag: {
        id: 'tag-1',
        name: 'Priority',
        color: '#3b82f6',
        leadCount: 0,
        createdAt: createdAt.toISOString(),
      },
      message: 'Tag created successfully',
    });
  });

  test('returns 409 when the normalized name duplicates an existing tag', async () => {
    findTag.mockResolvedValue({ id: 'tag-1' });

    const response = await post(JSON.stringify({ name: '  Priority  ', color: '#3b82f6' }));

    expect(response.status).toBe(409);
    expect(findTag).toHaveBeenCalledWith({
      where: { userId_name: { userId: 'user-1', name: 'Priority' } },
    });
    expect(createTag).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: 'A tag with this name already exists',
    });
  });

  test('returns only the fallback message for unexpected database errors', async () => {
    findTag.mockRejectedValue(new Error('SQLite connection details'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(JSON.stringify({ name: 'Priority', color: '#3b82f6' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to create tag' });
  });
});
