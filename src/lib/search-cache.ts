import type { BusinessSearchResult, IndustryType } from '@/types';
import type { Zone } from '@/lib/business/zone-grid';
import type { EnrichmentStatus } from '@/components/leads/EnrichButton';
import type { EnrichmentResult } from '@/lib/hooks/useEnrichmentStream';

const LAST_SEARCH_KEY = 'lead-snatcher-last-search';
/** Within-session restore window — keeps results alive across tab navigation. */
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export interface CachedMarketDensity {
  count: number;
  level: string;
  label: string;
  description: string;
  areaScore?: number;
  competition?: string;
  amenities?: {
    banks: number;
    hotels: number;
    hospitals: number;
    pharmacies: number;
    supermarkets: number;
    fuelStations: number;
    affluenceSpots: number;
    total: number;
  };
}

export interface CachedSearch {
  results: BusinessSearchResult[];
  industry: IndustryType;
  city: string;
  country: string;
  timestamp: number;
  // Extra state so a hop to /crm and back keeps the zone strip + density
  // meter intact. All optional for backward-compat with older cache blobs.
  zones?: Zone[];
  zoneBbox?: [number, number, number, number] | null;
  singleZone?: boolean;
  focusedZoneId?: string | null;
  marketDensity?: CachedMarketDensity | null;
  // Per-card enrichment state. Persisted so a user who has already
  // enriched a few leads doesn't lose the ⚡→✓ progress when they
  // navigate away and return.
  enrichStatusMap?: Record<string, EnrichmentStatus>;
  enrichResultMap?: Record<string, EnrichmentResult>;
  selectedForEnrich?: string[];
}

export function saveLastSearch(data: Omit<CachedSearch, 'timestamp'>): void {
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
export function updateLastSearchEnrichment(patch: {
  enrichStatusMap?: Record<string, EnrichmentStatus>;
  enrichResultMap?: Record<string, EnrichmentResult>;
  selectedForEnrich?: string[];
}): void {
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
