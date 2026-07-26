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

export const SEARCH_SNAPSHOT_VERSION = 3 as const;
export const SEARCH_SNAPSHOT_RESULT_LIMIT = 50;
const MAX_FUTURE_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

export const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

export function isDateSafeTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_DATE_TIMESTAMP
  );
}

export function timestampToISOString(value: unknown): string | null {
  if (!isDateSafeTimestamp(value)) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

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
  /** Exact business query sent to discovery; industry remains the scoring category. */
  businessType: string;
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

const persistedSearchBaseSchema = z.object({
  version: z.number().int().nonnegative().optional(),
  results: z.array(persistedBusinessSearchResultSchema).max(SEARCH_SNAPSHOT_RESULT_LIMIT),
  businessType: z.string().trim().min(1).optional(),
  industry: industryTypeSchema,
  city: z.string(),
  country: z.string(),
  timestamp: z.number().refine(isDateSafeTimestamp),
});

const zoneAnalysisSchema = z.object({
  zones: z.array(zoneSchema).optional(),
  zoneBbox: zoneBboxSchema.nullable().optional(),
  singleZone: z.boolean().optional(),
  focusedZoneId: z.string().nullable().optional(),
  zoneScanStatus: zoneScanStatusSchema.optional(),
  marketDensity: searchMarketDensitySchema.optional(),
});

const ZONE_ANALYSIS_KEYS = [
  'zones',
  'zoneBbox',
  'singleZone',
  'focusedZoneId',
  'zoneScanStatus',
  'marketDensity',
] as const;

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Migrates and validates an object into the only shape safe to persist.
 * Unknown and browser-only top-level fields are intentionally discarded.
 */
export function decodePersistedSearchPayload(
  value: unknown,
  defaultTimestamp?: number
): PersistedSearchPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate =
    defaultTimestamp !== undefined && !hasOwn(value, 'timestamp')
      ? { ...value, timestamp: defaultTimestamp }
      : value;
  const base = persistedSearchBaseSchema.safeParse(candidate);
  if (
    !base.success ||
    (base.data.version ?? 0) > SEARCH_SNAPSHOT_VERSION ||
    base.data.timestamp > Date.now() + MAX_FUTURE_TIMESTAMP_SKEW_MS
  ) {
    return null;
  }

  const version = base.data.version ?? 0;
  if (version >= SEARCH_SNAPSHOT_VERSION && !base.data.businessType) return null;

  // Versions before v3 only stored the scoring enum. Its id is also the exact
  // legacy discovery query, so it is the safest identity for resumed searches.
  const canonicalBase = {
    ...base.data,
    businessType: base.data.businessType ?? base.data.industry,
  };
  const hasZoneAnalysis = ZONE_ANALYSIS_KEYS.some((key) => hasOwn(value, key));
  if (!hasZoneAnalysis) {
    return { ...canonicalBase, version: SEARCH_SNAPSHOT_VERSION };
  }

  const zoneAnalysis = zoneAnalysisSchema.safeParse(value);
  if (zoneAnalysis.success) {
    return { ...canonicalBase, ...zoneAnalysis.data, version: SEARCH_SNAPSHOT_VERSION };
  }

  // Zone fields written before v2 used an incompatible schema. Keep the durable
  // search itself usable, but require current payloads to satisfy the full contract.
  if (version < SEARCH_SNAPSHOT_VERSION) {
    return { ...canonicalBase, version: SEARCH_SNAPSHOT_VERSION };
  }

  return null;
}

/** Parses JSON, then delegates all migration and validation to the object codec. */
export function parsePersistedSearchPayload(raw: string): PersistedSearchPayload | null {
  try {
    return decodePersistedSearchPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Orders immutable snapshots by creation time, then canonical content for same-millisecond ties.
 * The canonical tie-break makes concurrent writes deterministic across clients and the server.
 */
export function comparePersistedSearchPayloads(
  left: PersistedSearchPayload,
  right: PersistedSearchPayload
): number {
  if (left.timestamp !== right.timestamp) return left.timestamp < right.timestamp ? -1 : 1;

  const leftCanonical = JSON.stringify(left);
  const rightCanonical = JSON.stringify(right);
  if (leftCanonical === rightCanonical) return 0;
  return leftCanonical < rightCanonical ? -1 : 1;
}

/** Browser-only state is safe to retain only when the complete durable snapshot matches. */
export function hasSameSearchSnapshotIdentity(
  left: PersistedSearchPayload,
  right: PersistedSearchPayload
): boolean {
  return comparePersistedSearchPayloads(left, right) === 0;
}
