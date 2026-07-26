import type { BusinessSearchResult, ExtendedBusinessData } from '@/types';
import type { Zone } from './zone-contract';
import { buildBudgetInput, computeFitScore, estimateBudget } from './budget-estimate';
import { generateOpportunities } from './opportunities';
import { calculateLeadScore } from './scoring';

export type SearchResultSort = 'fit' | 'score' | 'contactPoints' | 'reviews' | 'rating';

export interface SearchResultFilters {
  hasEmail: boolean;
  hasPhone: boolean;
  hasSocial: boolean;
  hasAds: boolean;
  minBudget: number;
}

export interface SearchResultEnrichment {
  website?: string;
  socials?: Partial<BusinessSearchResult['socialLinks']>;
  websiteAnalysis?: BusinessSearchResult['websiteAnalysis'];
  scrapedData?: BusinessSearchResult['scrapedData'];
}

export type SearchResultZoneContext = Pick<Zone, 'score' | 'level' | 'archetype'>;

export function rederiveEnrichedSearchResult(
  lead: BusinessSearchResult,
  enrichment: SearchResultEnrichment,
  zoneContext?: SearchResultZoneContext
): BusinessSearchResult {
  const website = lead.website ?? enrichment.website;
  const socialLinks = {
    ...(lead.socialLinks ?? {}),
    ...(enrichment.socials ?? {}),
  };
  const websiteAnalysis = enrichment.websiteAnalysis ?? lead.websiteAnalysis;
  const scrapedData = enrichment.scrapedData ?? lead.scrapedData;
  const contactPoints = [lead.phone, lead.email, website, ...Object.values(socialLinks)].filter(
    Boolean
  ).length;
  const businessData: ExtendedBusinessData = {
    photoCount: lead.photoCount,
    website,
    phone: lead.phone,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    industryType: lead.industryType,
    websiteAnalysis: websiteAnalysis ?? null,
    scrapedData: scrapedData ?? null,
  };
  const scoreBreakdown = calculateLeadScore(businessData);
  const leadScore = scoreBreakdown.total;
  const opportunities = generateOpportunities(lead.industryType, {
    website,
    phone: lead.phone,
    email: lead.email,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    types: lead.types,
    scrapedData,
  });
  const budgetEstimate = estimateBudget(
    buildBudgetInput({
      breakdown: scoreBreakdown,
      reviewCount: lead.reviewCount ?? 0,
      hasWebsite: Boolean(website),
      contactPoints,
      areaScore: zoneContext?.score,
      priceLevel: lead.priceLevel,
      rating: lead.rating,
      zoneArchetype: zoneContext?.archetype,
      businessTypes: lead.types,
      businessName: lead.name,
    })
  );

  return {
    ...lead,
    website,
    socialLinks,
    websiteAnalysis,
    scrapedData,
    contactPoints,
    scoreBreakdown,
    leadScore,
    opportunities,
    budgetEstimate,
    areaLevel: zoneContext?.level ?? lead.areaLevel,
    fitScore: computeFitScore(leadScore, budgetEstimate.points),
  };
}

export function mergeEnrichmentResults(
  results: readonly BusinessSearchResult[],
  enrichmentByPlaceId: Readonly<Record<string, SearchResultEnrichment | undefined>>,
  zoneContext?: SearchResultZoneContext
): BusinessSearchResult[] {
  return results.map((lead) => {
    const found = enrichmentByPlaceId[lead.placeId];
    if (!found) return lead;

    return rederiveEnrichedSearchResult(lead, found, zoneContext);
  });
}

export function filterAndSortResults(
  results: readonly BusinessSearchResult[],
  filters: SearchResultFilters,
  sortBy: SearchResultSort
): BusinessSearchResult[] {
  return results
    .filter((result) => {
      if (filters.hasEmail && !(result.email && isRealEmail(result.email))) return false;
      if (filters.hasPhone && !result.phone) return false;
      if (filters.hasSocial && Object.keys(result.socialLinks || {}).length === 0) return false;
      if (filters.hasAds && !result.scoreBreakdown.hasMarketingBudget) return false;
      if (
        filters.minBudget > 0 &&
        (!result.budgetEstimate || result.budgetEstimate.min < filters.minBudget)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => compareSearchResults(a, b, sortBy));
}

export function isRealEmail(email: string): boolean {
  const junkPatterns = [
    /user@/i,
    /name@/i,
    /someone@/i,
    /test@/i,
    /your/i,
    /example\.com/i,
    /domain\.com/i,
    /email\.com$/i,
    /noreply/i,
    /no-reply/i,
    /placeholder/i,
    /sample/i,
    /changeme/i,
    /wix\.com/i,
    /sentry/i,
    /wordpress/i,
  ];

  return !junkPatterns.some((pattern) => pattern.test(email));
}

export function selectResultsById(
  results: readonly BusinessSearchResult[],
  selectedIds: ReadonlySet<string>
): BusinessSearchResult[] {
  return results.filter((result) => selectedIds.has(result.placeId));
}

function compareSearchResults(
  a: BusinessSearchResult,
  b: BusinessSearchResult,
  sortBy: SearchResultSort
): number {
  switch (sortBy) {
    case 'fit':
      return (b.fitScore ?? 0) - (a.fitScore ?? 0) || b.leadScore - a.leadScore;
    case 'contactPoints':
      return b.contactPoints - a.contactPoints || b.leadScore - a.leadScore;
    case 'reviews':
      return (b.reviewCount || 0) - (a.reviewCount || 0);
    case 'rating':
      return (b.rating || 0) - (a.rating || 0);
    case 'score':
      return b.leadScore - a.leadScore || b.contactPoints - a.contactPoints;
  }
}
