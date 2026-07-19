/**
 * Deep Enrichment — fallback lookups for businesses whose Google Maps
 * profile lacks a website or socials. Uses letscrape (OpenWeb Ninja)
 * RapidAPI hosts that share the user's existing RapidAPI key.
 *
 *  - real-time-web-search: `"{name}" {city}` → best candidate domain
 *  - social-links-search:  `"{name} {city}"` → socials by network
 *
 * Both APIs have a 100 req/mo free BASIC tier with a 1000 req/hr cap.
 */

import { rapidApiFetch } from '@/lib/rapidapi/client';

const WEB_SEARCH_HOST = 'real-time-web-search.p.rapidapi.com';
const SOCIAL_SEARCH_HOST = 'social-links-search.p.rapidapi.com';

type SocialNetwork = 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'youtube' | 'tiktok';

export interface DiscoveredSocials {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
  tiktok?: string;
}

// Directories + platforms we don't want claimed as "the business website".
const DOMAIN_BLOCKLIST = new Set([
  'facebook.com',
  'm.facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'yelp.com',
  'yellowpages.com',
  'google.com',
  'google.co.uk',
  'maps.google.com',
  'bing.com',
  'tripadvisor.com',
  'foursquare.com',
  'bbb.org',
  'mapquest.com',
  'wikipedia.org',
  'reddit.com',
  'quora.com',
  'indeed.com',
  'glassdoor.com',
  'zocdoc.com',
  'vagaro.com',
  'booksy.com',
  'styleseat.com',
  'fresha.com',
]);

function extractHostname(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isBlockedHost(hostname: string): boolean {
  if (DOMAIN_BLOCKLIST.has(hostname)) return true;
  // Also block subdomains of blocked hosts (e.g. business.site.yelp.com)
  for (const blocked of DOMAIN_BLOCKLIST) {
    if (hostname.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

// Loose token overlap between a business name and a candidate domain/title.
// We don't require an exact match — "Joe's Pizza" vs "joespizza.com" should
// count, as should "Joe's Pizza" vs a title "Joe's Pizza | Best in Brooklyn".
function looseNameMatch(businessName: string, candidate: string): boolean {
  const tokens = businessName
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !['the', 'and', 'for', 'llc', 'inc'].includes(t));
  if (tokens.length === 0) return true; // name too short to match on
  const hay = candidate.toLowerCase().replace(/[^\w\s]/g, '');
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length >= 0.5;
}

interface WebSearchResult {
  url?: string;
  link?: string;
  title?: string;
  snippet?: string;
  description?: string;
}

interface WebSearchResponse {
  data?: WebSearchResult[];
  organic_results?: WebSearchResult[];
  results?: WebSearchResult[];
}

/**
 * Find a business's real website via web search. Returns null if no
 * plausible match is found (after blocklist + name-match filtering).
 */
export async function discoverWebsite(
  userId: string,
  businessName: string,
  city: string
): Promise<string | null> {
  const query = `"${businessName}" ${city}`;
  try {
    const response = await rapidApiFetch<WebSearchResponse>(userId, {
      host: WEB_SEARCH_HOST,
      endpoint: '/search',
      params: {
        q: query,
        limit: '5',
      },
    });

    const results = response.data || response.organic_results || response.results || [];

    for (const result of results) {
      const rawUrl = result.url || result.link;
      if (!rawUrl) continue;
      const host = extractHostname(rawUrl);
      if (!host) continue;
      if (isBlockedHost(host)) continue;

      const haystack = [host, result.title || '', result.snippet || result.description || ''].join(
        ' '
      );
      if (!looseNameMatch(businessName, haystack)) continue;

      // Return the normalized URL
      return rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`;
    }
    return null;
  } catch {
    // Silently swallow — enrichment is opt-in best-effort, must not fail the search.
    return null;
  }
}

interface SocialSearchResponse {
  data?: Partial<Record<SocialNetwork, string[]>>;
  results?: Partial<Record<SocialNetwork, string[]>>;
}

/**
 * Find social profiles for a business name. Returns an object with
 * whatever networks the API found; missing networks are absent.
 */
export async function discoverSocials(
  userId: string,
  businessName: string,
  city: string
): Promise<DiscoveredSocials> {
  const query = `${businessName} ${city}`.trim();
  try {
    const response = await rapidApiFetch<SocialSearchResponse>(userId, {
      host: SOCIAL_SEARCH_HOST,
      endpoint: '/search-social-links',
      params: {
        query,
        social_networks: 'facebook,instagram,twitter,linkedin,youtube,tiktok',
      },
    });

    const payload = response.data || response.results || {};
    const result: DiscoveredSocials = {};

    (
      ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok'] as SocialNetwork[]
    ).forEach((network) => {
      const candidates = payload[network];
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) return;
      // Pick the first profile URL that loosely matches the business name.
      // Falls back to the first entry if none match — the social API already
      // ranks by relevance, so first is usually correct.
      const match = candidates.find((url) => looseNameMatch(businessName, url)) ?? candidates[0];
      if (match) result[network] = match;
    });

    return result;
  } catch {
    return {};
  }
}

/**
 * Run an async worker over a list with bounded concurrency.
 * Returns results in the same order as the input.
 */
export async function runBatch<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      // The loop bound guarantees this index exists; keep `undefined` valid when T includes it.
      const item = items[i] as T;
      results[i] = await worker(item, i);
    }
  });
  await Promise.all(workers);
  return results;
}
