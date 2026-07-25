import { describe, expect, test, vi } from 'vitest';
import { assertPublicHttpUrl, fetchPublicHttpUrl, type HostResolver } from './public-url';
import { scrapeWebsite } from './scraper';

const resolvePublicHost: HostResolver = async () => [{ address: '93.184.216.34', family: 4 }];

describe('public website URL enforcement', () => {
  test.each([
    'http://127.0.0.1/admin',
    'http://2130706433/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://255.255.255.255/admin',
    'http://[::1]/admin',
    'http://localhost/admin',
  ])('blocks local target %s before fetch', async (url) => {
    const fetcher = vi.fn();

    const result = await scrapeWebsite(url, { fetch: fetcher, resolve: resolvePublicHost });

    expect(result).toMatchObject({
      isReachable: false,
      error: 'Website URL targets a private network',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('blocks hostnames when any resolved address is private', async () => {
    const resolve: HostResolver = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ];

    await expect(assertPublicHttpUrl('https://mixed.example', resolve)).rejects.toThrow(
      'private network'
    );
  });

  test('allows a public HTTP target', async () => {
    await expect(
      assertPublicHttpUrl('https://example.com/path', resolvePublicHost)
    ).resolves.toEqual(new URL('https://example.com/path'));
  });

  test('passes only the validated addresses to the request transport', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<html></html>'));

    await fetchPublicHttpUrl(
      'https://example.com',
      {},
      { fetch: fetcher, resolve: resolvePublicHost }
    );

    expect(fetcher.mock.calls[0]?.[2]).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  test('aborts while DNS resolution is still pending', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn();
    const resolve = vi.fn((_hostname: string, _signal?: AbortSignal) => new Promise<never>(() => {}));
    const pendingFetch = fetchPublicHttpUrl(
      'https://slow.example',
      { signal: controller.signal },
      { fetch: fetcher, resolve }
    );

    controller.abort();

    await expect(pendingFetch).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolve).toHaveBeenCalledWith('slow.example', controller.signal);
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('revalidates redirects and refuses a redirect to a private target', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      })
    );

    await expect(
      fetchPublicHttpUrl('https://example.com', {}, { fetch: fetcher, resolve: resolvePublicHost })
    ).rejects.toThrow('private network');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('rejects non-HTTP protocols and embedded credentials', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd', resolvePublicHost)).rejects.toThrow(
      'HTTP or HTTPS'
    );
    await expect(
      assertPublicHttpUrl('https://user:password@example.com', resolvePublicHost)
    ).rejects.toThrow('credentials');
  });
});
