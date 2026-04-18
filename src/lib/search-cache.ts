import type { BusinessSearchResult, IndustryType } from '@/types';
import type { Zone } from '@/lib/business/zone-grid';

const LAST_SEARCH_KEY = 'lead-snatcher-last-search';
/** Cache TTL: 30 minutes */
const CACHE_TTL_MS = 30 * 60 * 1000;

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
