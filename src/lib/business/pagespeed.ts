import type { WebsiteAnalysis } from '@/types';
import { isSocialProfileUrl } from './social-profile-url';
import { getCachedMany, putCached } from './url-cache';

const PAGESPEED_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

interface PageSpeedResponse {
  lighthouseResult?: {
    categories?: {
      performance?: { score?: number };
      accessibility?: { score?: number };
      seo?: { score?: number };
      'best-practices'?: { score?: number };
    };
    audits?: {
      'server-response-time'?: { numericValue?: number };
      'is-on-https'?: { score?: number };
      viewport?: { score?: number };
      'largest-contentful-paint'?: { numericValue?: number };
      'cumulative-layout-shift'?: { numericValue?: number };
    };
  };
  loadingExperience?: {
    overall_category?: string;
  };
  error?: {
    message?: string;
  };
}

/**
 * Analyze a website using Google PageSpeed Insights API
 * Note: Works without API key but has rate limits (~25 req/100s)
 * With API key: 25,000 requests/day
 */
export async function analyzeWebsite(
  websiteUrl: string,
  apiKey?: string
): Promise<WebsiteAnalysis | null> {
  try {
    // Ensure URL has protocol
    let url = websiteUrl;
    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }

    // Build API URL — one request, all four Lighthouse categories.
    // Google returns everything in the same payload, so we pay one RTT
    // for four scores instead of four.
    const params = new URLSearchParams({
      url,
      strategy: 'mobile', // Mobile-first analysis
    });
    for (const category of ['performance', 'accessibility', 'seo', 'best-practices']) {
      params.append('category', category);
    }

    // FieldMask — ask Google to return only the fields we actually
    // read. A full Lighthouse payload is 1-5 MB (screenshots, every
    // audit tree, every metric). We consume 10 numbers. Restricting
    // fields cuts the response to ~10-20 KB, which:
    //   - eliminates the Node heap spike that was OOM-killing the dev
    //     server on memory-constrained WSL machines
    //   - makes JSON.parse near-instant
    //   - shrinks production bandwidth ~100× (real money on serverless)
    // Score fields paths use `/` to drill into the categories object.
    params.set(
      'fields',
      [
        'lighthouseResult.categories/performance/score',
        'lighthouseResult.categories/accessibility/score',
        'lighthouseResult.categories/seo/score',
        'lighthouseResult.categories/best-practices/score',
        'lighthouseResult.audits/largest-contentful-paint/numericValue',
        'lighthouseResult.audits/cumulative-layout-shift/numericValue',
        'lighthouseResult.audits/server-response-time/numericValue',
        'lighthouseResult.audits/is-on-https/score',
        'lighthouseResult.audits/viewport/score',
        'error',
      ].join(',')
    );

    if (apiKey) {
      params.append('key', apiKey);
    }

    const response = await fetch(`${PAGESPEED_API_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`PageSpeed API error: ${response.status}`);
      // Surface 429 distinctly so the batch caller can short-circuit
      // instead of grinding through every URL when Google has cut us off.
      if (response.status === 429) {
        const err = new Error('PageSpeed rate limited (429)');
        err.name = 'PageSpeedRateLimited';
        throw err;
      }
      return createErrorAnalysis(url);
    }

    // Lighthouse responses can be 1–5 MB (full-page screenshots, every
    // audit tree, every metric Lighthouse computes). We only use 4
    // numbers. Parse inside a tight block so the heavy `raw` and
    // `lighthouse` references die before we return, keeping peak heap
    // during a 50-site batch in the tens of MB instead of hundreds.
    const extract = (raw: PageSpeedResponse): WebsiteAnalysis | null => {
      if (raw.error) {
        console.error(`PageSpeed API error: ${raw.error.message}`);
        return null;
      }
      const lighthouse = raw.lighthouseResult;
      if (!lighthouse) return null;
      const toScore = (raw01: number | undefined) =>
        raw01 === undefined ? undefined : Math.round(raw01 * 100);
      const performanceScore = Math.round((lighthouse.categories?.performance?.score || 0) * 100);
      const accessibilityScore = toScore(lighthouse.categories?.accessibility?.score);
      const seoScore = toScore(lighthouse.categories?.seo?.score);
      const bestPracticesScore = toScore(lighthouse.categories?.['best-practices']?.score);
      const largestContentfulPaint = lighthouse.audits?.['largest-contentful-paint']?.numericValue;
      const cumulativeLayoutShift = lighthouse.audits?.['cumulative-layout-shift']?.numericValue;
      const responseTime = Math.round(
        lighthouse.audits?.['server-response-time']?.numericValue || 0
      );
      const isHttps = (lighthouse.audits?.['is-on-https']?.score || 0) === 1;
      const hasViewport = (lighthouse.audits?.viewport?.score || 0) === 1;
      return {
        url,
        isHttps,
        performanceScore,
        accessibilityScore,
        seoScore,
        bestPracticesScore,
        largestContentfulPaint:
          largestContentfulPaint === undefined ? undefined : Math.round(largestContentfulPaint),
        cumulativeLayoutShift:
          cumulativeLayoutShift === undefined
            ? undefined
            : Math.round(cumulativeLayoutShift * 1000) / 1000,
        isMobileFriendly: hasViewport && performanceScore >= 50,
        responseTime,
        hasErrors: false,
        analyzedAt: new Date().toISOString(),
      };
    };
    const result = extract(await response.json());
    return result ?? createErrorAnalysis(url);
  } catch (error) {
    if (error instanceof Error && error.name === 'PageSpeedRateLimited') {
      throw error; // bubbles up to the batch loop for short-circuit
    }
    console.error('Website analysis failed:', error);
    return createErrorAnalysis(websiteUrl);
  }
}

/**
 * Create an error analysis result
 */
function createErrorAnalysis(url: string): WebsiteAnalysis {
  return {
    url,
    isHttps: url.startsWith('https'),
    performanceScore: 0,
    isMobileFriendly: false,
    responseTime: 0,
    hasErrors: true,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Batch analyze multiple websites with rate limiting
 * Processes max 5 concurrent requests to avoid rate limits
 */
export async function analyzeWebsitesBatch(
  websites: string[],
  apiKey?: string,
  // Concurrency 2 (was 3) — caps peak in-flight memory. With the
  // FieldMask in place responses are small, but on slow/flaky networks
  // where multiple responses buffer simultaneously, 2 vs 3 meaningfully
  // reduces the chance of a heap spike.
  concurrency: number = 2
): Promise<Map<string, WebsiteAnalysis>> {
  const results = new Map<string, WebsiteAnalysis>();
  const validWebsites = websites.filter((url) => url && !isSocialProfileUrl(url));
  if (validWebsites.length === 0) return results;

  // Cache hit pass — anything we've analyzed in the last 7 days skips
  // the network entirely. The second scan of "dentists in London" pulls
  // 90% of these from SQLite.
  const cached = await getCachedMany<WebsiteAnalysis>('pagespeed', validWebsites);
  for (const [url, analysis] of cached) results.set(url, analysis);
  const toFetch = validWebsites.filter((u) => !cached.has(u));

  // Process in batches. Track 429s — if Google has cut us off, every
  // remaining URL will fail the same way, so abort the batch instead of
  // wasting search time on certain failures (with no key, free quota
  // exhausts in seconds).
  let rateLimited = false;
  for (let i = 0; i < toFetch.length; i += concurrency) {
    if (rateLimited) break;
    const batch = toFetch.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (url) => {
        const analysis = await analyzeWebsite(url, apiKey);
        return { url, analysis };
      })
    );

    for (const outcome of batchResults) {
      if (outcome.status === 'fulfilled' && outcome.value.analysis) {
        results.set(outcome.value.url, outcome.value.analysis);
        // Persist for future searches. Fire-and-forget — caching is best
        // effort and must never block the search hot path.
        void putCached('pagespeed', outcome.value.url, outcome.value.analysis);
      } else if (
        outcome.status === 'rejected' &&
        outcome.reason instanceof Error &&
        outcome.reason.name === 'PageSpeedRateLimited'
      ) {
        rateLimited = true;
      }
    }

    // Small delay between batches to avoid rate limiting
    if (!rateLimited && i + concurrency < toFetch.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}
