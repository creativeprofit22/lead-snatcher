/**
 * Website Scraper Service
 * Extracts useful data from business websites for lead scoring
 */

import type { FreshScrapedWebsiteData, ScrapedWebsiteData } from '@/types/scraper';
import { fetchPublicHttpUrl, type PublicFetchDependencies } from './public-url';
import { isSocialMediaUrl, runScraperBatch, type ScraperBatchDependencies } from './scraper-batch';
import { extractWebsiteData } from './scraper-extract';
import { getCachedMany, putCached } from './url-cache';

export type {
  FreshScrapedWebsiteData,
  MarketingSignals,
  PersistedScrapedWebsiteData,
  ScrapedWebsiteData,
  SocialLinks,
  WebsiteQualitySignals,
} from '@/types/scraper';

export function createInitialScrapeResult(
  websiteUrl: string,
  scrapedAt: string = new Date().toISOString()
): FreshScrapedWebsiteData {
  return {
    url: websiteUrl,
    isReachable: false,
    loadTimeMs: 0,
    techStack: [],
    hasWordPress: false,
    hasShopify: false,
    hasSquarespace: false,
    hasWix: false,
    hasCustomSite: true,
    estimatedAge: 'unknown',
    hasOnlineBooking: false,
    hasContactForm: false,
    hasLiveChat: false,
    hasNewsletter: false,
    hasEcommerce: false,
    hasBlog: false,
    emails: [],
    socialLinks: {},
    socialCount: 0,
    hasMobileViewport: false,
    isHttps: websiteUrl.startsWith('https'),
    hasSSLIssues: false,
    hasModernDesign: false,
    imageCount: 0,
    hasVideo: false,
    marketingSignals: {
      hasGoogleAds: false,
      hasFacebookAds: false,
      hasGoogleAnalytics: false,
      hasBingAds: false,
      hasHotjar: false,
      hasOtherAds: false,
      detectedPlatforms: [],
    },
    hasMarketingBudget: false,
    qualitySignals: {
      hasTableLayout: false,
      wordCount: 0,
      hasAnyForm: false,
      hasSchemaOrg: false,
      hasOpenGraph: false,
      hasDeprecatedTags: false,
      deprecatedTagsFound: [],
      hasFixedPixelWidth: false,
      hasLangAttribute: false,
      jqueryVersion: null,
      isOldJquery: false,
      templateFingerprint: null,
    },
    scrapedAt,
  };
}

/**
 * Scrape a website and extract relevant data.
 * Only public HTTP(S) targets are fetched; every redirect is revalidated.
 */
export async function scrapeWebsite(
  websiteUrl: string,
  dependencies: PublicFetchDependencies = {}
): Promise<FreshScrapedWebsiteData> {
  const startTime = Date.now();
  const result = createInitialScrapeResult(websiteUrl);

  // Skip social media URLs
  if (isSocialMediaUrl(websiteUrl)) {
    result.error = 'Social media URL - skipped';
    return result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    // Ensure URL has protocol
    let url = websiteUrl;
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }

    const response = await fetchPublicHttpUrl(
      url,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LeadSnatcher/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
        },
      },
      dependencies
    );

    result.loadTimeMs = Date.now() - startTime;
    result.isReachable = response.ok;

    if (!response.ok) {
      result.error = `HTTP ${response.status}`;
      return result;
    }

    const html = await response.text();

    Object.assign(result, extractWebsiteData(html, new Date().getFullYear()));

    return result;
  } catch (error) {
    result.loadTimeMs = Date.now() - startTime;
    result.error = error instanceof Error ? error.message : 'Unknown error';

    if (result.error.includes('SSL') || result.error.includes('certificate')) {
      result.hasSSLIssues = true;
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Batch scrape multiple websites.
 *
 * The legacy chunk-size argument groups results but does not cap in-flight work.
 */
export async function scrapeWebsitesBatch(
  urls: string[],
  chunkSize: number = 10,
  dependencies: ScraperBatchDependencies = {
    getCachedMany,
    scrapeWebsite,
    putCached,
  }
): Promise<Map<string, ScrapedWebsiteData>> {
  return runScraperBatch(urls, chunkSize, dependencies);
}
