import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WebsiteAnalysis } from '@/types';

const cacheMocks = vi.hoisted(() => ({
  getCachedMany: vi.fn(),
  putCached: vi.fn(),
}));

vi.mock('./url-cache', () => cacheMocks);

import { analyzeWebsitesBatch } from './pagespeed';

function cachedAnalysis(url: string): WebsiteAnalysis {
  return {
    url,
    isHttps: url.startsWith('https'),
    performanceScore: 90,
    isMobileFriendly: true,
    responseTime: 100,
    hasErrors: false,
    analyzedAt: '2026-07-25T12:00:00.000Z',
  };
}

describe('PageSpeed batch URL policy', () => {
  beforeEach(() => {
    cacheMocks.getCachedMany.mockReset();
    cacheMocks.putCached.mockReset();
    cacheMocks.getCachedMany.mockImplementation(
      async (_service: string, urls: string[]) =>
        new Map(urls.map((url) => [url, cachedAnalysis(url)]))
    );
  });

  test('all social platforms and preserved substring edge cases skip PageSpeed collaborators', async () => {
    const websites = [
      '',
      'https://facebook.com/acme',
      'https://fb.com/acme',
      'https://instagram.com/acme',
      'https://twitter.com/acme',
      'https://x.com/acme',
      'https://tiktok.com/acme',
      'https://linkedin.com/acme',
      'https://youtube.com/acme',
      'HTTPS://FACEBOOK.COM/Acme',
      'instagram.com/acme',
      '://facebook.com/%zz',
      'https://business.facebook.com/acme',
      'https://notfacebook.com/acme',
      'https://example.com/?next=facebook.com/acme',
    ];

    await expect(analyzeWebsitesBatch(websites)).resolves.toEqual(new Map());

    expect(cacheMocks.getCachedMany).not.toHaveBeenCalled();
    expect(cacheMocks.putCached).not.toHaveBeenCalled();
  });

  test('ordinary and malformed non-social values remain eligible for PageSpeed analysis', async () => {
    const websites = ['https://example.com/acme', 'not a valid URL'];

    await expect(analyzeWebsitesBatch(websites)).resolves.toEqual(
      new Map(websites.map((url) => [url, cachedAnalysis(url)]))
    );

    expect(cacheMocks.getCachedMany).toHaveBeenCalledWith('pagespeed', websites);
    expect(cacheMocks.putCached).not.toHaveBeenCalled();
  });
});
