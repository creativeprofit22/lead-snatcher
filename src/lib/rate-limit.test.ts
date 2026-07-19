import { describe, expect, test } from 'vitest';

import { getClientIp } from '@/lib/rate-limit';

function requestWithHeaders(headers: Record<string, string>) {
  return {
    headers: {
      get(name: string) {
        return headers[name] ?? null;
      },
    },
  };
}

describe('getClientIp', () => {
  test('uses the trimmed leftmost forwarded address', () => {
    const request = requestWithHeaders({
      'x-forwarded-for': ' 203.0.113.10, 198.51.100.7 ',
      'x-real-ip': '192.0.2.5',
    });

    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  test('falls back when the first forwarded entry is empty', () => {
    const request = requestWithHeaders({
      'x-forwarded-for': ' , 198.51.100.7',
      'x-real-ip': ' 192.0.2.5 ',
    });

    expect(getClientIp(request)).toBe('192.0.2.5');
  });

  test('uses the shared direct-connection bucket without proxy headers', () => {
    expect(getClientIp(requestWithHeaders({}))).toBe('direct-connection');
  });
});
