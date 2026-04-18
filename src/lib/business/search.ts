import { rapidApiFetch } from '@/lib/rapidapi/client';
import { calculateLeadScore } from './scoring';
import { generateOpportunities, detectIndustryType } from './opportunities';
import { analyzeWebsitesBatch } from './pagespeed';
import { scrapeWebsitesBatch, type ScrapedWebsiteData } from './scraper';
import {
  discoverWebsite,
  discoverSocials,
  runBatch,
  type DiscoveredSocials,
} from './enrichment';
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
function parsePriceLevel(
  raw: MapsBusinessResult
): number | undefined {
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
  enableEnrichment?: boolean; // Web search + social lookup fallback for missing data
  pageSpeedApiKey?: string;
  /** City name — used as disambiguator for enrichment queries. */
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
  const response = await rapidApiFetch<MapsApiResponse>(userId, {
    host: MAPS_API_HOST,
    endpoint: '/searchmaps.php',
    params: {
      query: businessType,
      lat: latitude.toString(),
      lng: longitude.toString(),
      limit: Math.min(limit, 50).toString(),
      zoom: '13',
      lang: 'en',
    },
  });

  if (!response.data || !Array.isArray(response.data)) {
    return [];
  }

  // Filter valid businesses
  const validBusinesses = response.data.filter(
    (business) => business.name && business.business_id
  );

  // --- Enrichment pass 1: discover missing websites -----------------
  // When enabled, businesses that Google Maps has no website for get
  // queried against letscrape's real-time web search. A plausible match
  // is attached to `business.website` so the rest of the pipeline
  // (scoring, scraping, display) treats them as if Maps had returned it.
  if (options.enableEnrichment && options.city) {
    const noWebsiteCandidates = validBusinesses.filter((b) => !b.website && b.name);
    if (noWebsiteCandidates.length > 0) {
      const discovered = await runBatch(
        noWebsiteCandidates,
        (b) => discoverWebsite(userId, b.name!, options.city!),
        5
      );
      noWebsiteCandidates.forEach((b, i) => {
        if (discovered[i]) b.website = discovered[i] ?? undefined;
      });
    }
  }

  // Collect websites for analysis (now includes any enrichment-discovered ones)
  const websites = validBusinesses
    .map((b) => b.website)
    .filter((w): w is string => !!w);

  // Run website analysis in parallel
  let websiteAnalysisMap: Map<string, WebsiteAnalysis> = new Map();
  let scrapedDataMap: Map<string, ScrapedWebsiteData> = new Map();

  if (websites.length > 0) {
    const analysisPromises: Promise<void>[] = [];

    // PageSpeed analysis (slower, performance metrics)
    if (options.enableWebsiteAnalysis) {
      analysisPromises.push(
        analyzeWebsitesBatch(websites, options.pageSpeedApiKey, 3).then((results) => {
          websiteAnalysisMap = results;
        })
      );
    }

    // HTML scraping (faster, tech stack & features)
    if (options.enableWebsiteScraping) {
      analysisPromises.push(
        scrapeWebsitesBatch(websites, 15).then((results) => {
          scrapedDataMap = results;
        })
      );
    }

    await Promise.all(analysisPromises);
  }

  // --- Enrichment pass 2: discover missing socials ------------------
  // For any business whose scraping yielded zero socials (or that has
  // no website to scrape at all), fall back to letscrape's social
  // links search. The discovered map is keyed by business_id so the
  // transform step can merge cleanly.
  const enrichedSocialsMap = new Map<string, DiscoveredSocials>();
  if (options.enableEnrichment && options.city) {
    const socialCandidates = validBusinesses.filter((b) => {
      if (!b.business_id || !b.name) return false;
      const url = b.website;
      const normalized = url?.startsWith('http') ? url : url ? `https://${url}` : undefined;
      const scraped = url
        ? scrapedDataMap.get(url) || (normalized ? scrapedDataMap.get(normalized) : undefined)
        : undefined;
      return !scraped || scraped.socialCount === 0;
    });
    if (socialCandidates.length > 0) {
      const socials = await runBatch(
        socialCandidates,
        (b) => discoverSocials(userId, b.name!, options.city!),
        5
      );
      socialCandidates.forEach((b, i) => {
        const result = socials[i];
        if (result && Object.keys(result).length > 0) {
          enrichedSocialsMap.set(b.business_id!, result);
        }
      });
    }
  }

  // Transform and score results with all data
  const results: BusinessSearchResult[] = validBusinesses.map((business) => {
    const websiteUrl = business.website;
    const normalizedUrl = websiteUrl?.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;

    const websiteAnalysis = websiteUrl
      ? websiteAnalysisMap.get(websiteUrl) || websiteAnalysisMap.get(normalizedUrl)
      : undefined;

    const scrapedData = websiteUrl
      ? scrapedDataMap.get(websiteUrl) || scrapedDataMap.get(normalizedUrl)
      : undefined;

    const enrichedSocials = business.business_id
      ? enrichedSocialsMap.get(business.business_id)
      : undefined;

    return transformBusinessResult(business, websiteAnalysis, scrapedData, enrichedSocials);
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
  scrapedData?: ScrapedWebsiteData,
  enrichedSocials?: DiscoveredSocials
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

  // Extract email and social links from scraped data, then fill any
  // gaps from enrichment. Scraper data is authoritative when present.
  const email = scrapedData?.emails?.[0] || undefined;
  const socialLinks: BusinessSearchResult['socialLinks'] = {
    ...(enrichedSocials ?? {}),
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
