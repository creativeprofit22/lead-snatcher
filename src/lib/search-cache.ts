import type { BusinessSearchResult, IndustryType } from '@/types';

const LAST_SEARCH_KEY = 'lead-snatcher-last-search';
/** Cache TTL: 30 minutes */
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface CachedSearch {
  results: BusinessSearchResult[];
  industry: IndustryType;
  city: string;
  country: string;
  timestamp: number;
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
