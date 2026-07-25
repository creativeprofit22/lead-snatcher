import { describe, expect, test, vi } from 'vitest';
import type { ScrapedWebsiteData } from '@/types/scraper';
import type { ScraperBatchDependencies } from './scraper-batch';
import { createInitialScrapeResult, scrapeWebsitesBatch } from './scraper';

const FIXED_TIME = '2026-07-25T12:00:00.000Z';

function scrapedResult(url: string): ScrapedWebsiteData {
  return createInitialScrapeResult(url, FIXED_TIME);
}

function createDependencies(
  overrides: Partial<ScraperBatchDependencies> = {}
): ScraperBatchDependencies {
  return {
    getCachedMany: vi.fn(async () => new Map()),
    scrapeWebsite: vi.fn(async (url) => scrapedResult(url)),
    putCached: vi.fn(async () => undefined),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('website scrape batch policy', () => {
  test.each([
    ['empty', []],
    ['social-only', ['', 'https://facebook.com/acme', 'https://x.com/acme']],
  ])('%s input skips cache, scraper, and persistence collaborators', async (_label, urls) => {
    const dependencies = createDependencies();

    await expect(scrapeWebsitesBatch(urls, 2, dependencies)).resolves.toEqual(new Map());

    expect(dependencies.getCachedMany).not.toHaveBeenCalled();
    expect(dependencies.scrapeWebsite).not.toHaveBeenCalled();
    expect(dependencies.putCached).not.toHaveBeenCalled();
  });

  test('cache hits keep their original keys and skip scraping and writes', async () => {
    const originalUrl = 'example.com/';
    const cachedResult = scrapedResult('https://example.com');
    const dependencies = createDependencies({
      getCachedMany: vi.fn(async () => new Map([[originalUrl, cachedResult]])),
    });

    const result = await scrapeWebsitesBatch([originalUrl], 8, dependencies);

    expect(dependencies.getCachedMany).toHaveBeenCalledWith('scrape', [originalUrl]);
    expect(dependencies.scrapeWebsite).not.toHaveBeenCalled();
    expect(dependencies.putCached).not.toHaveBeenCalled();
    expect([...result.entries()]).toEqual([[originalUrl, cachedResult]]);
  });

  test('scrapes and writes only cache misses while preserving original result keys', async () => {
    const hitUrl = 'https://hit.example/path';
    const missUrl = 'miss.example/path/';
    const hitResult = scrapedResult(hitUrl);
    const missResult = scrapedResult(`https://${missUrl}`);
    const dependencies = createDependencies({
      getCachedMany: vi.fn(async () => new Map([[hitUrl, hitResult]])),
      scrapeWebsite: vi.fn(async () => missResult),
    });

    const result = await scrapeWebsitesBatch([hitUrl, missUrl], 3, dependencies);

    expect(dependencies.getCachedMany).toHaveBeenCalledWith('scrape', [hitUrl, missUrl]);
    expect(dependencies.scrapeWebsite).toHaveBeenCalledTimes(1);
    expect(dependencies.scrapeWebsite).toHaveBeenCalledWith(missUrl);
    expect(dependencies.putCached).toHaveBeenCalledWith('scrape', missUrl, missResult);
    expect([...result.entries()]).toEqual([
      [hitUrl, hitResult],
      [missUrl, missResult],
    ]);
  });

  test('scrapes duplicate misses independently and the later result wins the final Map key', async () => {
    const duplicateUrl = 'https://duplicate.example';
    const firstResult = { ...scrapedResult(duplicateUrl), title: 'first' };
    const secondResult = { ...scrapedResult(duplicateUrl), title: 'second' };
    const otherUrl = 'https://other.example';
    const otherResult = scrapedResult(otherUrl);
    const dependencies = createDependencies({
      scrapeWebsite: vi
        .fn()
        .mockResolvedValueOnce(firstResult)
        .mockResolvedValueOnce(secondResult)
        .mockResolvedValueOnce(otherResult),
    });

    const result = await scrapeWebsitesBatch(
      [duplicateUrl, duplicateUrl, otherUrl],
      2,
      dependencies
    );

    expect(dependencies.scrapeWebsite).toHaveBeenCalledTimes(3);
    expect(dependencies.scrapeWebsite).toHaveBeenNthCalledWith(1, duplicateUrl);
    expect(dependencies.scrapeWebsite).toHaveBeenNthCalledWith(2, duplicateUrl);
    expect(dependencies.scrapeWebsite).toHaveBeenNthCalledWith(3, otherUrl);
    expect(dependencies.putCached).toHaveBeenNthCalledWith(1, 'scrape', duplicateUrl, firstResult);
    expect(dependencies.putCached).toHaveBeenNthCalledWith(2, 'scrape', duplicateUrl, secondResult);
    expect(dependencies.putCached).toHaveBeenNthCalledWith(3, 'scrape', otherUrl, otherResult);
    expect([...result.entries()]).toEqual([
      [duplicateUrl, secondResult],
      [otherUrl, otherResult],
    ]);
  });

  test('starts every miss before deferred workers resolve despite chunk grouping', async () => {
    const urls = Array.from({ length: 5 }, (_, index) => `https://example-${index}.com`);
    const workers = new Map(urls.map((url) => [url, deferred<ScrapedWebsiteData>()]));
    const dependencies = createDependencies({
      scrapeWebsite: vi.fn((url) => workers.get(url)!.promise),
    });

    const batchPromise = scrapeWebsitesBatch(urls, 2, dependencies);

    await vi.waitFor(() => expect(dependencies.scrapeWebsite).toHaveBeenCalledTimes(urls.length));
    for (const url of urls) workers.get(url)!.resolve(scrapedResult(url));

    await expect(batchPromise).resolves.toEqual(
      new Map(urls.map((url) => [url, scrapedResult(url)]))
    );
  });

  test('does not await cache writes', async () => {
    const url = 'https://example.com';
    const neverResolvingWrite = new Promise<void>(() => undefined);
    const dependencies = createDependencies({
      putCached: vi.fn(() => neverResolvingWrite),
    });

    await expect(scrapeWebsitesBatch([url], 1, dependencies)).resolves.toEqual(
      new Map([[url, scrapedResult(url)]])
    );
    expect(dependencies.putCached).toHaveBeenCalledOnce();
  });
});
