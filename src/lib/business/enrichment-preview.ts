import type { BusinessSearchResult } from '@/types';

/**
 * Drives every piece of user-facing enrichment copy (tooltip, batch
 * bar, aria-label). Given a lead's current state, returns what
 * enrichment will try to find, how many API calls it will cost, and
 * whether there's nothing left to do.
 *
 * Call count logic:
 *  - 1 call (discoverWebsite) if website is missing
 *  - 1 call (discoverSocials) if socials map is empty
 *  - 0 calls if both are present — button is hidden in that case
 *
 * Cache isn't consulted here: that's a server-side concern and the
 * preview is a worst-case estimate. The batch bar subtracts cache
 * hits separately so the user sees a truthful number.
 */

export type EnrichmentTarget = 'website' | 'socials';

export interface EnrichmentPreview {
  willFind: EnrichmentTarget[];
  estimatedCalls: number;
  alreadyEnriched: boolean;
}

interface PreviewInput {
  website?: string;
  socialLinks?: Partial<Record<string, string | undefined>>;
}

export function previewEnrichment(lead: PreviewInput): EnrichmentPreview {
  const hasWebsite = !!lead.website?.trim();
  const socialCount = lead.socialLinks ? Object.values(lead.socialLinks).filter(Boolean).length : 0;
  const hasSocials = socialCount > 0;

  const willFind: EnrichmentTarget[] = [];
  if (!hasWebsite) willFind.push('website');
  if (!hasSocials) willFind.push('socials');

  return {
    willFind,
    estimatedCalls: willFind.length,
    alreadyEnriched: willFind.length === 0,
  };
}

/** Human label for a single target — used inside tooltips. */
export function targetLabel(target: EnrichmentTarget): string {
  switch (target) {
    case 'website':
      return 'website';
    case 'socials':
      return 'social profiles';
  }
}

/** Full tooltip copy for a card's Enrich button. */
export function tooltipCopy(preview: EnrichmentPreview): string {
  if (preview.alreadyEnriched) {
    return 'This lead already has full contact data';
  }
  const labels = preview.willFind.map(targetLabel).join(' + ');
  const calls = preview.estimatedCalls;
  return `Find ${labels} for this lead (~${calls} API call${calls === 1 ? '' : 's'})`;
}

/** Summary used by the batch action bar. */
export interface BatchPreview {
  totalLeads: number;
  totalCalls: number;
  alreadyEnrichedCount: number;
  actionableLeads: number;
}

export function previewBatch(leads: BusinessSearchResult[]): BatchPreview {
  let totalCalls = 0;
  let alreadyEnrichedCount = 0;
  for (const lead of leads) {
    const p = previewEnrichment(lead);
    totalCalls += p.estimatedCalls;
    if (p.alreadyEnriched) alreadyEnrichedCount++;
  }
  return {
    totalLeads: leads.length,
    totalCalls,
    alreadyEnrichedCount,
    actionableLeads: leads.length - alreadyEnrichedCount,
  };
}
