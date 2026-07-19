import { describe, expect, test } from 'vitest';

import { getErrorMessage } from '@/lib/errors';

describe('getErrorMessage', () => {
  test('returns only the first sentence for missing API-key errors', () => {
    expect(getErrorMessage(new Error('API key not configured. Add one in settings.'))).toBe(
      'API key not configured'
    );
  });

  test('preserves a missing API-key error without a sentence separator', () => {
    expect(getErrorMessage(new Error('API key not configured'))).toBe('API key not configured');
  });
});
