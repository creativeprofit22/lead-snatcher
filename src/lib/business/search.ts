import { rapidApiFetch } from '@/lib/rapidapi/client';
import { calculateLeadScore } from './scoring';
import { generateOpportunities, detectIndustryType } from './opportunities';
import { analyzeWebsitesBatch } from './pagespeed';
import { scrapeWebsitesBatch, type ScrapedWebsiteData } from './scraper';
import type { BusinessSearchResult, WebsiteAnalysis, ExtendedBusinessData } from '@/types';

const MAPS_API_HOST = 'maps-data.p.rapidapi.com';

// Response from RapidAPI Maps
interface MapsApiResponse {
  data?: MapsBusinessResult[];
}

interface MapsBusinessResult {
  business_id?: string;
  name?: string;
  full_address?: string;
  phone_number?: string;
  website?: string;
  rating?: number;
  review_count?: number;
  types?: string[];
  photos_sample?: { photo_url?: string }[];
  latitude?: number;
  longitude?: number;
  // Google-style price tier. Providers serve this under a few different
  // keys — capture all of them; parsed into a 0-4 number downstream.
  price_level?: number | string;
  price_range?: string;
  priceLevel?: number | string;
}

// Parse any of the shapes a Maps provider might return for price tier
// into a canonical 0-4 integer. Returns undefined when absent/unusable.
function parsePriceLevel(raw: MapsBusinessResult): number | undefined {
  const candidate = raw.price_level ?? raw.priceLevel ?? raw.price_range;
  if (typeof candidate === 'number') {
    return candidate >= 0 && candidate <= 4 ? Math.round(candidate) : undefined;
  }
  if (typeof candidate === 'string') {
    // Google's enum form: PRICE_LEVEL_FREE/_INEXPENSIVE/_MODERATE/_EXPENSIVE/_VERY_EXPENSIVE
    const enumMap: Record<string, number> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };
    if (candidate in enumMap) return enumMap[candidate];
    // Yelp/other "$"/"$$"/"$$$"/"$$$$" style
    const dollarMatch = /^\${1,4}$/.test(candidate.trim());
    if (dollarMatch) return candidate.trim().length;
    // Numeric string
    const n = parseInt(candidate, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 4) return n;
  }
  return undefined;
}

// Search options
export interface SearchOptions {
  enableWebsiteAnalysis?: boolean; // PageSpeed API (slower, more accurate)
  enableWebsiteScraping?: boolean; // HTML scraping (faster, more data)
  pageSpeedApiKey?: string;
  /** City name — kept for future use (currently unused after enrichment moved off-sweep). */
  city?: string;
}

/**
 * Search for businesses using RapidAPI Maps
 * With optional website analysis via PageSpeed API and/or HTML scraping
 */
export async function searchBusinesses(
  userId: string,
  businessType: string,
  latitude: number,
  longitude: number,
  limit: number = 20,
  options: SearchOptions = {}
): Promise<BusinessSearchResult[]> {
  // Maps-data.rapidapi intermittently returns 200 OK with an empty/missing
  // `data` field for queries that had worked moments earlier. Retry once
  // after a short delay before giving up — a single retry recovers the
  // vast majority of these transient misses without meaningfully affecting
  // search latency. If still empty after retry, we log the raw shape so
  // the user has *some* answer to "why did this say no results?"
  const mapsParams = {
    query: businessType,
    lat: latitude.toString(),
    lng: longitude.toString(),
    limit: Math.min(limit, 50).toString(),
    zoom: '13',
    lang: 'en',
  };

  let response = await rapidApiFetch<MapsApiResponse>(userId, {
    host: MAPS_API_HOST,
    endpoint: '/searchmaps.php',
    params: mapsParams,
  });

  const looksEmpty = (r: MapsApiResponse): boolean =>
    !r.data || !Array.isArray(r.data) || r.data.length === 0;

  if (looksEmpty(response)) {
    console.warn('[searchBusinesses] empty/malformed response from Maps API, retrying once', {
      query: businessType,
      lat: latitude,
      lng: longitude,
      responseShape: {
        hasData: 'data' in response,
        dataType: typeof response.data,
        dataIsArray: Array.isArray(response.data),
        dataLength: Array.isArray(response.data) ? response.data.length : null,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    response = await rapidApiFetch<MapsApiResponse>(userId, {
      host: MAPS_API_HOST,
      endpoint: '/searchmaps.php',
      params: mapsParams,
    });
  }

  if (!response.data || !Array.isArray(response.data)) {
    console.error(
      '[searchBusinesses] Maps API returned no `data` array even after retry — provider glitch',
      { query: businessType, lat: latitude, lng: longitude }
    );
    return [];
  }

  // Filter valid businesses
  const validBusinesses = response.data.filter((business) => business.name && business.business_id);

  // Collect websites for analysis. Enrichment used to inject discovered
  // websites here; that's been moved to POST /api/business/enrich (user-
  // triggered, per-card) to keep the sweep fast and quota-cheap.
  const websites = validBusinesses.map((b) => b.website).filter((w): w is string => !!w);

  let websiteAnalysisMap: Map<string, WebsiteAnalysis> = new Map();
  let scrapedDataMap: Map<string, ScrapedWebsiteData> = new Map();

  if (websites.length > 0) {
    // Step A: scrape every site first. Scraping is fast (~30s for 50
    // sites at concurrency 8) and feeds the preliminary score that
    // decides which leads are worth running PageSpeed on.
    //
    // The try/catch here is deliberate: a scrape pipeline blow-up (OOM,
    // DNS flood, malformed HTML exploder) must NEVER prevent returning
    // the Maps results the user already paid a RapidAPI call for. Any
    // failure degrades the sweep to "leads without enriched signals",
    // which is still useful — losing 50 leads because one site choked
    // Cheerio is not.
    if (options.enableWebsiteScraping) {
      try {
        // Concurrency 8 keeps WSL socket pressure manageable (15 was
        // causing intermittent EAI_AGAIN / file-descriptor pile-ups during
        // dense-city scans) while still finishing a 50-site batch in <30s.
        scrapedDataMap = await scrapeWebsitesBatch(websites, 8);
      } catch (err) {
        console.error(
          'Scrape pipeline failed — continuing with Maps-only data:',
          err instanceof Error ? err.message : err
        );
        scrapedDataMap = new Map();
      }
    }

    // Step B: tier the PageSpeed pass. Lighthouse is the slowest part of
    // the search (~3 min for 50 sites even with a key) and we don't care
    // about performance metrics for a lead we'd never call. Score every
    // business with what we have so far, then only run PageSpeed on the
    // top 20 — cuts a 3-min worst case down to ~30s.
    //
    // Same defensive wrap as the scraper: a Lighthouse blow-up shouldn't
    // eat the user's sweep.
    if (options.enableWebsiteAnalysis) {
      const ranked = validBusinesses
        .map((b) => {
          const websiteUrl = b.website;
          const normalized = websiteUrl?.startsWith('http')
            ? websiteUrl
            : websiteUrl
              ? `https://${websiteUrl}`
              : undefined;
          const scraped = websiteUrl
            ? scrapedDataMap.get(websiteUrl) ||
              (normalized ? scrapedDataMap.get(normalized) : undefined)
            : undefined;
          const prelim: ExtendedBusinessData = {
            photoCount: b.photos_sample?.length ?? 0,
            website: b.website,
            phone: b.phone_number,
            rating: b.rating,
            reviewCount: b.review_count,
            industryType: detectIndustryType(b.types ?? []),
            websiteAnalysis: null,
            scrapedData: scraped ?? null,
          };
          return { website: b.website, score: calculateLeadScore(prelim).total };
        })
        .filter((x): x is { website: string; score: number } => !!x.website)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((x) => x.website);

      if (ranked.length > 0) {
        try {
          websiteAnalysisMap = await analyzeWebsitesBatch(ranked, options.pageSpeedApiKey, 2);
        } catch (err) {
          console.error(
            'PageSpeed pipeline failed — continuing without Lighthouse scores:',
            err instanceof Error ? err.message : err
          );
          websiteAnalysisMap = new Map();
        }
      }
    }
  }

  // Transform and score results with all data. Socials come from the
  // scraper only at sweep time; post-sweep user-triggered enrichment
  // merges additional sources in the /api/business/enrich endpoint.
  const results: BusinessSearchResult[] = validBusinesses.map((business) => {
    const websiteUrl = business.website;
    const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

    const websiteAnalysis = websiteUrl
      ? websiteAnalysisMap.get(websiteUrl) || websiteAnalysisMap.get(normalizedUrl)
      : undefined;

    const scrapedData = websiteUrl
      ? scrapedDataMap.get(websiteUrl) || scrapedDataMap.get(normalizedUrl)
      : undefined;

    return transformBusinessResult(business, websiteAnalysis, scrapedData);
  });

  // Sort by lead score (highest first), then by contact points (more = better lead)
  results.sort((a, b) => b.leadScore - a.leadScore || b.contactPoints - a.contactPoints);

  return results;
}

/**
 * Transform API response to our format with scoring
 */
function transformBusinessResult(
  business: MapsBusinessResult,
  websiteAnalysis?: WebsiteAnalysis,
  scrapedData?: ScrapedWebsiteData
): BusinessSearchResult {
  const types = business.types || [];
  const industryType = detectIndustryType(types);

  // Clean website URL
  let website = business.website;
  if (website && !website.startsWith('http')) {
    website = `https://${website}`;
  }

  // Count photos from the API response
  const photoCount = business.photos_sample?.length || 0;

  // Build extended business data for scoring
  const businessData: ExtendedBusinessData = {
    photoCount,
    website,
    phone: business.phone_number,
    rating: business.rating,
    reviewCount: business.review_count,
    industryType,
    websiteAnalysis: websiteAnalysis || null,
    scrapedData: scrapedData || null,
  };

  // Calculate lead score with new multi-layer system
  const scoreBreakdown = calculateLeadScore(businessData);

  // Generate opportunities (enhanced with scraped data)
  const opportunities = generateOpportunities(industryType, {
    website,
    phone: business.phone_number,
    email: null,
    rating: business.rating,
    reviewCount: business.review_count,
    types,
    scrapedData,
  });

  // Get photo URL
  const photoUrl = business.photos_sample?.[0]?.photo_url || null;

  // Generate Google Maps URL - use name + address for reliable direct match
  const mapsQuery = [business.name, business.full_address].filter(Boolean).join(', ');
  const mapsUrl = mapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
    : null;

  // Extract email and social links from scraped data. Any gaps get
  // filled post-sweep when the user hits Enrich on a card.
  const email = scrapedData?.emails?.[0] || undefined;
  const socialLinks: BusinessSearchResult['socialLinks'] = {
    ...(scrapedData?.socialLinks ?? {}),
  };
  const socialCount = Object.values(socialLinks).filter(Boolean).length;

  // Count total contact points (more = easier to reach = better lead)
  let contactPoints = 0;
  if (business.phone_number) contactPoints++;
  if (email) contactPoints++;
  if (website) contactPoints++;
  contactPoints += socialCount;

  const priceLevel = parsePriceLevel(business);

  return {
    placeId: business.business_id || '',
    name: business.name || '',
    address: business.full_address || undefined,
    latitude: business.latitude,
    longitude: business.longitude,
    phone: business.phone_number || undefined,
    website: website || undefined,
    email,
    socialLinks,
    contactPoints,
    priceLevel,
    rating: business.rating || undefined,
    reviewCount: business.review_count || undefined,
    photoCount,
    types,
    photoUrl: photoUrl || undefined,
    mapsUrl: mapsUrl || undefined,
    leadScore: scoreBreakdown.total,
    scoreBreakdown,
    opportunities,
    industryType,
    websiteAnalysis,
    scrapedData,
  };
}
