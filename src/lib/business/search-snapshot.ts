import { z } from 'zod';
import type { BusinessSearchResult, IndustryType } from '@/types';
import { industryTypeSchema } from '@/lib/validations';
import { persistedBusinessSearchResultSchema } from './business-search-result-contract';
import {
  zoneAmenitiesSchema,
  zoneBboxSchema,
  zoneScanStatusSchema,
  zoneSchema,
} from './zone-contract';
import type { Zone, ZoneAmenities, ZoneBbox, ZoneScanStatus } from './zone-contract';

export const SEARCH_SNAPSHOT_VERSION = 2 as const;

export const searchMarketDensitySchema = z
  .object({
    status: zoneScanStatusSchema.optional(),
    count: z.number(),
    level: z.string(),
    label: z.string(),
    description: z.string(),
    areaScore: z.number().optional(),
    competition: z.string().optional(),
    amenities: zoneAmenitiesSchema.optional(),
  })
  .nullable();

export interface SearchMarketDensity {
  status?: ZoneScanStatus;
  count: number;
  level: string;
  label: string;
  description: string;
  areaScore?: number;
  competition?: string;
  amenities?: ZoneAmenities;
}

/** Durable search data shared by local cache, auto-resume, and named sessions. */
export interface SearchSnapshot {
  version: typeof SEARCH_SNAPSHOT_VERSION;
  results: BusinessSearchResult[];
  industry: IndustryType;
  city: string;
  country: string;
  // Optional for compatibility with search payloads stored before zone analysis.
  zones?: Zone[];
  zoneBbox?: ZoneBbox | null;
  singleZone?: boolean;
  focusedZoneId?: string | null;
  zoneScanStatus?: ZoneScanStatus;
  marketDensity?: SearchMarketDensity | null;
}

/** Serialized durable payload. The timestamp belongs to the snapshot, not browser UI state. */
export interface PersistedSearchPayload extends SearchSnapshot {
  timestamp: number;
}

const persistedSearchBaseSchema = z
  .object({
    version: z.number().int().optional(),
    results: z.array(persistedBusinessSearchResultSchema),
    industry: industryTypeSchema,
    city: z.string(),
    country: z.string(),
    timestamp: z.number(),
  })
  .passthrough();

const zoneAnalysisSchema = z
  .object({
    zones: z.array(zoneSchema).optional(),
    zoneBbox: zoneBboxSchema.nullable().optional(),
    singleZone: z.boolean().optional(),
    focusedZoneId: z.string().nullable().optional(),
    zoneScanStatus: zoneScanStatusSchema.optional(),
    marketDensity: searchMarketDensitySchema.optional(),
  })
  .passthrough();

const ZONE_ANALYSIS_KEYS = [
  'zones',
  'zoneBbox',
  'singleZone',
  'focusedZoneId',
  'zoneScanStatus',
  'marketDensity',
] as const;

function migratePersistedSearchPayload(value: unknown): PersistedSearchPayload | null {
  const base = persistedSearchBaseSchema.safeParse(value);
  if (!base.success || (base.data.version ?? 0) > SEARCH_SNAPSHOT_VERSION) return null;

  const hasZoneAnalysis = ZONE_ANALYSIS_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(base.data, key)
  );
  if (!hasZoneAnalysis) {
    return { ...base.data, version: SEARCH_SNAPSHOT_VERSION };
  }

  const zoneAnalysis = zoneAnalysisSchema.safeParse(base.data);
  if (zoneAnalysis.success) {
    return { ...base.data, ...zoneAnalysis.data, version: SEARCH_SNAPSHOT_VERSION };
  }

  const migrated: PersistedSearchPayload & Record<string, unknown> = {
    ...base.data,
    version: SEARCH_SNAPSHOT_VERSION,
  };
  for (const key of ZONE_ANALYSIS_KEYS) delete migrated[key];
  return migrated;
}

/** Parses and migrates durable search data before it reaches result-view hydration. */
export function parsePersistedSearchPayload(raw: string): PersistedSearchPayload | null {
  try {
    return migratePersistedSearchPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}
