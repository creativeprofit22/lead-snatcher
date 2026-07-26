import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { checkRateLimit, findUser, getClientIp, hashPassword, updateUser } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  findUser: vi.fn(),
  getClientIp: vi.fn(),
  hashPassword: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('bcrypt', () => ({
  default: { hash: hashPassword },
}));
vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: findUser, update: updateUser },
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit,
  getClientIp,
  RATE_LIMITS: { auth: { maxRequests: 5, windowMs: 60_000 } },
}));

import { POST } from './route';

const validPassword = ['Strong', 'Pass1'].join('');
const hashedPassword = ['hashed', 'password'].join('-');

const pendingUser = {
  id: 'user-1',
  email: 'owner@example.com',
  password: null,
};

function setPasswordRequest(
  body: BodyInit = JSON.stringify({ token: 'invite-token', password: validPassword })
) {
  return new NextRequest('http://localhost/api/auth/set-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getClientIp.mockReturnValue('203.0.113.10');
  checkRateLimit.mockReturnValue({ success: true, remaining: 4, resetTime: Date.now() + 60_000 });
  findUser.mockResolvedValue(pendingUser);
  hashPassword.mockResolvedValue(hashedPassword);
  updateUser.mockResolvedValue({ ...pendingUser, password: hashedPassword });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/set-password', () => {
  test('checks the rate limit before reading the body or starting database and bcrypt work', async () => {
    checkRateLimit.mockReturnValue({
      success: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });
    const request = setPasswordRequest('{');
    const readBody = vi.spyOn(request, 'json');

    const response = await POST(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Too many attempts. Please try again later.',
    });
    expect(getClientIp).toHaveBeenCalledWith(request);
    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxRequests: 5 })
    );
    expect(getClientIp.mock.invocationCallOrder[0]).toBeLessThan(
      checkRateLimit.mock.invocationCallOrder[0]!
    );
    expect(readBody).not.toHaveBeenCalled();
    expect(findUser).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed JSON', '{', 'Invalid JSON body'],
    [
      'an invalid password',
      JSON.stringify({ token: 'invite-token', password: 'weak' }),
      'Password must be at least 8 characters',
    ],
  ])(
    'returns 400 for %s after rate limiting and before database or bcrypt work',
    async (_case, body, error) => {
      const request = setPasswordRequest(body);
      const readBody = vi.spyOn(request, 'json');

      const response = await POST(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error });
      expect(checkRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
        readBody.mock.invocationCallOrder[0]!
      );
      expect(findUser).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
      expect(updateUser).not.toHaveBeenCalled();
    }
  );

  test('rejects an invalid invite token without bcrypt or update work', async () => {
    findUser.mockResolvedValue(null);

    const response = await POST(setPasswordRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid or expired invite link' });
    expect(findUser).toHaveBeenCalledWith({ where: { inviteToken: 'invite-token' } });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  test('hashes and stores a valid password with the existing success response', async () => {
    const response = await POST(setPasswordRequest());

    expect(response.status).toBe(200);
    expect(hashPassword).toHaveBeenCalledWith(validPassword, 12);
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        password: hashedPassword,
        inviteToken: null,
        createdAt: expect.any(Date),
      },
    });
    await expect(response.json()).resolves.toEqual({
      success: true,
      email: 'owner@example.com',
      message: 'Password set successfully. You can now login.',
    });
  });

  test('preserves the endpoint-specific 500 response for unexpected failures', async () => {
    findUser.mockRejectedValue(new Error('SQLite connection details'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(setPasswordRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to set password' });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
