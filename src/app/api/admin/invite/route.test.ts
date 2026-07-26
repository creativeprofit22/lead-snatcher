import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { adminSecret, createUser, findUser } = vi.hoisted(() => {
  const adminSecret = ['invite', 'admin', 'secret'].join('-');
  process.env.ADMIN_SECRET = adminSecret;

  return {
    adminSecret,
    createUser: vi.fn(),
    findUser: vi.fn(),
  };
});

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { create: createUser, findUnique: findUser },
  },
}));

import { POST } from './route';

const invitedUser = {
  id: 'user-1',
  email: 'owner@example.com',
};

function post(body: BodyInit, authorization: string | null = `Bearer ${adminSecret}`) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (authorization) {
    headers.set('authorization', authorization);
  }

  return POST(
    new Request('http://localhost/api/admin/invite', {
      method: 'POST',
      headers,
      body,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXTAUTH_URL', ' https://Invites.Example.com/app///?source=test#invite ');
  findUser.mockResolvedValue(null);
  createUser.mockResolvedValue(invitedUser);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('POST /api/admin/invite', () => {
  test.each([null, 'Bearer wrong-secret'])(
    'returns 401 without valid bearer authentication (%s)',
    async (authorization) => {
      const response = await post(
        JSON.stringify({ email: 'owner@example.com', name: 'Owner' }),
        authorization
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
      expect(findUser).not.toHaveBeenCalled();
      expect(createUser).not.toHaveBeenCalled();
    }
  );

  test('checks the bearer secret before reading the request body', async () => {
    const request = new Request('http://localhost/api/admin/invite', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret',
        'content-type': 'application/json',
      },
      body: '{',
    });
    const readBody = vi.spyOn(request, 'json');

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(readBody).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  test('returns the existing 500 response without Prisma access when NEXTAUTH_URL is missing', async () => {
    vi.stubEnv('NEXTAUTH_URL', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(JSON.stringify({ email: 'owner@example.com', name: 'Owner' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to invite user' });
    expect(findUser).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  test('rejects an invalid NEXTAUTH_URL without creating a user', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'file:///tmp/invites');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(JSON.stringify({ email: 'owner@example.com' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to invite user' });
    expect(findUser).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed JSON', '{"email":', 'Invalid JSON body'],
    ['an invalid email', JSON.stringify({ email: 'not-an-email' }), 'Invalid email address'],
    [
      'an overlong name',
      JSON.stringify({ email: 'owner@example.com', name: 'x'.repeat(201) }),
      undefined,
    ],
  ])('returns 400 for %s without creating a user', async (_label, body, expectedError) => {
    const response = await post(body);
    const responseBody = await response.json();

    expect(response.status).toBe(400);
    if (expectedError) {
      expect(responseBody).toEqual({ error: expectedError });
    } else {
      expect(responseBody).toEqual({ error: expect.any(String) });
    }
    expect(findUser).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  test('returns the existing duplicate-user response without creating another user', async () => {
    findUser.mockResolvedValue({ id: 'existing-user' });

    const response = await post(JSON.stringify({ email: 'owner@example.com' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'User already exists' });
    expect(findUser).toHaveBeenCalledWith({ where: { email: 'owner@example.com' } });
    expect(createUser).not.toHaveBeenCalled();
  });

  test('normalizes the configured URL and preserves the successful redacted response', async () => {
    const response = await post(JSON.stringify({ email: 'owner@example.com', name: 'Owner' }));

    expect(response.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith({
      data: {
        email: 'owner@example.com',
        name: 'Owner',
        inviteToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    await expect(response.json()).resolves.toEqual({
      id: 'user-1',
      email: 'owner@example.com',
      inviteUrl: 'https://invites.example.com/app/set-password?token=[REDACTED]',
      message: 'User invited. Share the invite URL with them.',
    });
  });

  test.each([
    ['lookup', findUser],
    ['create', createUser],
  ])(
    'returns the existing safe 500 when the user %s fails unexpectedly',
    async (_step, operation) => {
      operation.mockRejectedValueOnce(new Error('SQLite connection details'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await post(JSON.stringify({ email: 'owner@example.com' }));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: 'Failed to invite user' });
    }
  );
});
