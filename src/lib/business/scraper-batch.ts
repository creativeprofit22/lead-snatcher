import type { ScrapedWebsiteData } from '@/types/scraper';
import { isSocialProfileUrl } from './social-profile-url';

const SCRAPE_CACHE_SERVICE = 'scrape' as const;

export interface ScraperBatchDependencies {
  getCachedMany: (
    service: typeof SCRAPE_CACHE_SERVICE,
    urls: string[]
  ) => Promise<Map<string, ScrapedWebsiteData>>;
  scrapeWebsite: (url: string) => Promise<ScrapedWebsiteData>;
  putCached: (
    service: typeof SCRAPE_CACHE_SERVICE,
    url: string,
    data: ScrapedWebsiteData
  ) => Promise<void>;
}

/**
 * Applies the legacy batch policy. chunkSize controls result grouping only;
 * every cache miss is started before any worker is awaited.
 */
export async function runScraperBatch(
  urls: string[],
  chunkSize: number,
  dependencies: ScraperBatchDependencies
): Promise<Map<string, ScrapedWebsiteData>> {
  const results = new Map<string, ScrapedWebsiteData>();
  const validUrls = urls.filter((url) => url && !isSocialProfileUrl(url));
  if (validUrls.length === 0) return results;

  const cached = await dependencies.getCachedMany(SCRAPE_CACHE_SERVICE, validUrls);
  for (const [url, data] of cached) results.set(url, data);
  const misses = validUrls.filter((url) => !cached.has(url));

  const groups: string[][] = [];
  for (let index = 0; index < misses.length; index += chunkSize) {
    groups.push(misses.slice(index, index + chunkSize));
  }

  const groupedResults = await Promise.all(
    groups.map(async (group) =>
      Promise.all(
        group.map(async (url) => ({
          url,
          data: await dependencies.scrapeWebsite(url),
        }))
      )
    )
  );

  for (const groupResults of groupedResults) {
    for (const { url, data } of groupResults) {
      results.set(url, data);
      void dependencies.putCached(SCRAPE_CACHE_SERVICE, url, data);
    }
  }

  return results;
}
