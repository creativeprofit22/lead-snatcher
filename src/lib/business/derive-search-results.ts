import type { BusinessSearchResult } from '@/types';

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
}

export function mergeEnrichmentResults(
  results: readonly BusinessSearchResult[],
  enrichmentByPlaceId: Readonly<Record<string, SearchResultEnrichment | undefined>>
): BusinessSearchResult[] {
  return results.map((lead) => {
    const found = enrichmentByPlaceId[lead.placeId];
    if (!found) return lead;

    return {
      ...lead,
      website: lead.website ?? found.website,
      socialLinks: {
        ...(lead.socialLinks ?? {}),
        ...(found.socials ?? {}),
      },
    } satisfies BusinessSearchResult;
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
