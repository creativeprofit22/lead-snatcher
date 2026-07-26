import { describe, expect, test } from 'vitest';

import { isSocialProfileUrl } from './social-profile-url';

const socialDomains = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'linkedin.com',
  'youtube.com',
] as const;

describe('isSocialProfileUrl', () => {
  test.each(socialDomains)('matches the %s social domain', (domain) => {
    expect(isSocialProfileUrl(`https://${domain}/acme`)).toBe(true);
  });

  test.each([
    ['mixed case', 'HTTPS://FACEBOOK.COM/Acme', true],
    ['scheme-less value', 'instagram.com/acme', true],
    ['malformed non-social input', 'not a valid URL', false],
    ['malformed input containing a social domain', '://facebook.com/%zz', true],
    ['social domain subdomain', 'https://business.facebook.com/acme', true],
    ['ordinary website', 'https://example.com/acme', false],
  ])('%s', (_label, value, expected) => {
    expect(isSocialProfileUrl(value)).toBe(expected);
  });

  test.each([
    ['deceptive host', 'https://notfacebook.com/acme'],
    ['social domain in query string', 'https://example.com/?next=facebook.com/acme'],
  ])(
    'preserves substring matching for %s pending a later hostname-policy decision',
    (_label, value) => {
      expect(isSocialProfileUrl(value)).toBe(true);
    }
  );
});
