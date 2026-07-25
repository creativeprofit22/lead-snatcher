import type { EnrichmentStatus } from '@/components/leads/EnrichButton';
import type { PersistedSearchPayload, SearchSnapshot } from '@/lib/business/search-snapshot';
import type { EnrichmentResult } from '@/lib/hooks/useEnrichmentStream';

const LAST_SEARCH_KEY = 'lead-snatcher-last-search';
/** Within-session restore window — keeps results alive across tab navigation. */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** Browser-only state stored alongside the durable search snapshot in localStorage. */
export interface SearchCacheBrowserState {
  enrichStatusMap?: Record<string, EnrichmentStatus>;
  enrichResultMap?: Record<string, EnrichmentResult>;
  selectedForEnrich?: string[];
}

/** Local cache envelope; server persistence stores only PersistedSearchPayload. */
export type CachedSearch = PersistedSearchPayload & SearchCacheBrowserState;

type SearchCacheWritePayload = SearchSnapshot & SearchCacheBrowserState;

export function saveLastSearch(data: SearchCacheWritePayload): void {
  const cached: CachedSearch = {
    ...data,
    timestamp: Date.now(),
  };
  localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(cached));
}

export function getLastSearch(): CachedSearch | null {
  const stored = localStorage.getItem(LAST_SEARCH_KEY);
  if (!stored) return null;

  try {
    const cached = JSON.parse(stored) as CachedSearch;
    // Discard stale results
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(LAST_SEARCH_KEY);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

export function hasLastSearch(): boolean {
  // Use getLastSearch so the TTL check is applied
  return getLastSearch() !== null;
}

export function clearLastSearch(): void {
  localStorage.removeItem(LAST_SEARCH_KEY);
}

/**
 * Patch only the enrichment fields on the existing cache entry without
 * touching the rest. Used when per-card enrichment state changes so we
 * don't need to re-serialize the entire blob (including the zones,
 * market density, etc.) from every caller.
 *
 * No-op if there is no cached search — nothing to patch.
 */
export function updateLastSearchEnrichment(patch: SearchCacheBrowserState): void {
  const current = getLastSearch();
  if (!current) return;
  const merged: CachedSearch = {
    ...current,
    ...patch,
    // Refresh timestamp so enrichment activity keeps the cache warm.
    timestamp: Date.now(),
  };
  localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(merged));
}
