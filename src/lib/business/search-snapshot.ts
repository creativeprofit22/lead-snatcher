import type { BusinessSearchResult, IndustryType } from '@/types';
import type { Zone } from './zone-grid';

export interface SearchMarketDensity {
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

/** Durable search data shared by local cache, auto-resume, and named sessions. */
export interface SearchSnapshot {
  results: BusinessSearchResult[];
  industry: IndustryType;
  city: string;
  country: string;
  // Optional for compatibility with search payloads stored before zone analysis.
  zones?: Zone[];
  zoneBbox?: [number, number, number, number] | null;
  singleZone?: boolean;
  focusedZoneId?: string | null;
  marketDensity?: SearchMarketDensity | null;
}

/** Serialized durable payload. The timestamp belongs to the snapshot, not browser UI state. */
export interface PersistedSearchPayload extends SearchSnapshot {
  timestamp: number;
}

/**
 * Parses stored payload JSON without validating nested search results.
 * Persistence historically accepted those objects as-is, so this only rejects malformed JSON.
 */
export function parsePersistedSearchPayload(raw: string): PersistedSearchPayload | null {
  try {
    return JSON.parse(raw) as PersistedSearchPayload;
  } catch {
    return null;
  }
}
