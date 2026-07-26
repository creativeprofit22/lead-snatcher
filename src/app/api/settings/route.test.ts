import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getCurrentUserId,
  findUser,
  findApiKeys,
  findApiKey,
  upsertApiKey,
  deleteApiKey,
  invalidateCachedApiKey,
  encrypt,
  decrypt,
  maskApiKey,
} = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  findUser: vi.fn(),
  findApiKeys: vi.fn(),
  findApiKey: vi.fn(),
  upsertApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  invalidateCachedApiKey: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  maskApiKey: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: findUser },
    apiKey: {
      findMany: findApiKeys,
      findUnique: findApiKey,
      upsert: upsertApiKey,
      delete: deleteApiKey,
    },
  },
}));
vi.mock('@/lib/cache', () => ({ invalidateCachedApiKey }));
vi.mock('@/lib/crypto', () => ({ encrypt, decrypt, maskApiKey }));

import { DELETE, GET, POST } from './route';

function post(body: BodyInit) {
  return POST(
    new Request('http://localhost/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  );
}

function remove(query = '?service=rapidapi') {
  return DELETE(new Request(`http://localhost/api/settings${query}`, { method: 'DELETE' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUserId.mockResolvedValue('user-1');
  findUser.mockResolvedValue({ id: 'user-1' });
  findApiKeys.mockResolvedValue([]);
  findApiKey.mockResolvedValue({ id: 'key-1', userId: 'user-1', service: 'rapidapi' });
  upsertApiKey.mockResolvedValue({ id: 'key-1' });
  deleteApiKey.mockResolvedValue({ id: 'key-1' });
  encrypt.mockImplementation((key: string) => `encrypted:${key}`);
  decrypt.mockImplementation((key: string) => {
    if (!key.startsWith('encrypted:')) throw new Error('Invalid encrypted value');
    return key.slice('encrypted:'.length);
  });
  maskApiKey.mockImplementation((key: string) =>
    key.length <= 8 ? '••••••••' : `${key.slice(0, 4)}••••••••${key.slice(-4)}`
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/settings authentication', () => {
  test.each([
    ['GET', () => GET()],
    ['POST', () => post(JSON.stringify({ service: 'rapidapi', key: 'secret-key' }))],
    ['DELETE', () => remove()],
  ])('returns the standard 401 response for an unauthenticated %s', async (_method, call) => {
    getCurrentUserId.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await call();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findApiKeys).not.toHaveBeenCalled();
    expect(upsertApiKey).not.toHaveBeenCalled();
    expect(findApiKey).not.toHaveBeenCalled();
  });

  test('preserves the stale-session POST response without attempting the upsert', async () => {
    findUser.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(JSON.stringify({ service: 'rapidapi', key: 'secret-key' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Session invalid. Please log out and log in again.',
    });
    expect(findUser).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true },
    });
    expect(upsertApiKey).not.toHaveBeenCalled();
  });
});

describe('POST /api/settings', () => {
  test.each([
    ['malformed JSON', '{', 'Invalid JSON body'],
    ['an unsupported service', JSON.stringify({ service: 'mailchimp', key: 'secret-key' }), null],
    ['an empty key', JSON.stringify({ service: 'rapidapi', key: '' }), 'API key is required'],
  ])('returns 400 for %s without encrypting or writing', async (_label, body, expectedError) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(body);
    const responseBody = await response.json();

    expect(response.status).toBe(400);
    expect(responseBody).toEqual({ error: expectedError ?? expect.any(String) });
    expect(encrypt).not.toHaveBeenCalled();
    expect(upsertApiKey).not.toHaveBeenCalled();
  });

  test('upserts the owned encrypted key, masks the response, and invalidates its cache', async () => {
    const response = await post(JSON.stringify({ service: 'rapidapi', key: 'abcd-secret-wxyz' }));

    expect(response.status).toBe(200);
    expect(encrypt).toHaveBeenCalledWith('abcd-secret-wxyz');
    expect(upsertApiKey).toHaveBeenCalledWith({
      where: { userId_service: { userId: 'user-1', service: 'rapidapi' } },
      update: { key: 'encrypted:abcd-secret-wxyz' },
      create: {
        userId: 'user-1',
        service: 'rapidapi',
        key: 'encrypted:abcd-secret-wxyz',
      },
    });
    expect(invalidateCachedApiKey).toHaveBeenCalledWith('user-1', 'rapidapi');
    await expect(response.json()).resolves.toEqual({
      success: true,
      service: 'rapidapi',
      maskedKey: 'abcd••••••••wxyz',
    });
  });
});

describe('GET /api/settings', () => {
  test('reads only owned keys and returns every schema service with masked values', async () => {
    findApiKeys.mockResolvedValue([
      { id: 'key-1', userId: 'user-1', service: 'rapidapi', key: 'encrypted:abcd-secret-wxyz' },
      { id: 'key-2', userId: 'user-1', service: 'youtube', key: 'cannot-decrypt' },
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(findApiKeys).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    await expect(response.json()).resolves.toEqual([
      { service: 'youtube', maskedKey: null, hasKey: false },
      { service: 'rapidapi', maskedKey: 'abcd••••••••wxyz', hasKey: true },
      { service: 'openrouter', maskedKey: null, hasKey: false },
      { service: 'pagespeed', maskedKey: null, hasKey: false },
    ]);
  });
});

describe('DELETE /api/settings', () => {
  test.each([
    ['a missing service', '', 'Service is required'],
    ['an empty service', '?service=', 'Service is required'],
    ['an unsupported service', '?service=mailchimp', 'Invalid service'],
  ])('returns 400 for %s before querying Prisma', async (_label, query, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await remove(query);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(findApiKey).not.toHaveBeenCalled();
    expect(deleteApiKey).not.toHaveBeenCalled();
  });

  test('deletes only the owned service and invalidates its cache', async () => {
    const response = await remove('?service=pagespeed');

    const ownedKey = { userId_service: { userId: 'user-1', service: 'pagespeed' } };
    expect(response.status).toBe(200);
    expect(findApiKey).toHaveBeenCalledWith({ where: ownedKey });
    expect(deleteApiKey).toHaveBeenCalledWith({ where: ownedKey });
    expect(invalidateCachedApiKey).toHaveBeenCalledWith('user-1', 'pagespeed');
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  test('returns 404 without deleting or invalidating when the owned key does not exist', async () => {
    findApiKey.mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await remove();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'API key not found' });
    expect(deleteApiKey).not.toHaveBeenCalled();
    expect(invalidateCachedApiKey).not.toHaveBeenCalled();
  });
});

describe('/api/settings safe failures', () => {
  test.each([
    ['GET', findApiKeys, () => GET(), 'Failed to fetch API keys'],
    [
      'POST',
      upsertApiKey,
      () => post(JSON.stringify({ service: 'rapidapi', key: 'secret-key' })),
      'Failed to save API key',
    ],
    ['DELETE', findApiKey, () => remove(), 'Failed to delete API key'],
  ])('returns a safe 500 when %s persistence fails', async (_method, operation, call, message) => {
    operation.mockRejectedValueOnce(new Error('SQLite connection details'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await call();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
