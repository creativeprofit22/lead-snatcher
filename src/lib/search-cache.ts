import { z } from 'zod';
import type { EnrichmentStatus } from '@/components/leads/EnrichButton';
import {
  comparePersistedSearchPayloads,
  decodePersistedSearchPayload,
  isDateSafeTimestamp,
  type PersistedSearchPayload,
  type SearchSnapshot,
} from '@/lib/business/search-snapshot';
import type { EnrichmentResult } from '@/lib/hooks/useEnrichmentStream';

const LAST_SEARCH_KEY = 'lead-snatcher-last-search';
const PENDING_LAST_SEARCH_KEY = 'lead-snatcher-last-search-pending';
export const SEARCH_CACHE_VERSION = 1 as const;
export const PENDING_SEARCH_SYNC_VERSION = 1 as const;
/** Within-session restore window — keeps results alive across tab navigation. */
export const SEARCH_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** Browser-only state stored alongside the durable search snapshot in localStorage. */
export interface SearchCacheBrowserState {
  enrichStatusMap?: Record<string, EnrichmentStatus>;
  enrichResultMap?: Record<string, EnrichmentResult>;
  selectedForEnrich?: string[];
}

/** Validated data returned to session hydration. Storage itself uses an envelope. */
export type CachedSearch = PersistedSearchPayload & SearchCacheBrowserState;

export interface SearchCacheEnvelope {
  version: typeof SEARCH_CACHE_VERSION;
  snapshot: PersistedSearchPayload;
  browserState: SearchCacheBrowserState;
  cachedAt: number;
  expiresAt: number;
}

type SearchCacheWritePayload = SearchSnapshot &
  SearchCacheBrowserState & {
    /** Present when resaving a resume/named-session snapshot. */
    timestamp?: number;
  };

const enrichmentStatusSchema = z.enum(['idle', 'enriching', 'enriched', 'rate_limited', 'error']);
const discoveredSocialsSchema = z.object({
  facebook: z.string().optional(),
  instagram: z.string().optional(),
  twitter: z.string().optional(),
  linkedin: z.string().optional(),
  youtube: z.string().optional(),
  tiktok: z.string().optional(),
});
const enrichmentResultSchema = z.object({
  website: z.string().optional(),
  socials: discoveredSocialsSchema.optional(),
  cached: z.boolean().optional(),
  error: z.string().optional(),
});

function limitedRecord<T extends z.ZodType>(valueSchema: T) {
  return z
    .record(z.string().min(1), valueSchema)
    .refine((value) => Object.keys(value).length <= 50, 'Too many enrichment records');
}

const browserStateFieldSchemas = {
  enrichStatusMap: limitedRecord(enrichmentStatusSchema),
  enrichResultMap: limitedRecord(enrichmentResultSchema),
  selectedForEnrich: z.array(z.string().min(1)).max(50),
} satisfies Record<keyof SearchCacheBrowserState, z.ZodType>;

const envelopeMetadataSchema = z.object({
  version: z.literal(SEARCH_CACHE_VERSION),
  cachedAt: z.number().refine(isDateSafeTimestamp),
  expiresAt: z.number().refine(isDateSafeTimestamp),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Invalid browser-only fields are dropped independently so the durable snapshot remains usable. */
export function decodeSearchCacheBrowserState(value: unknown): SearchCacheBrowserState {
  if (!isRecord(value)) return {};

  const decoded: SearchCacheBrowserState = {};
  for (const key of Object.keys(browserStateFieldSchemas) as Array<keyof SearchCacheBrowserState>) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const parsed = browserStateFieldSchemas[key].safeParse(value[key]);
    if (parsed.success) {
      Object.assign(decoded, { [key]: parsed.data });
    }
  }
  return decoded;
}

function persistEnvelope(envelope: SearchCacheEnvelope): void {
  localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(envelope));
}

function removeInvalidCache(): null {
  localStorage.removeItem(LAST_SEARCH_KEY);
  return null;
}

function decodeCurrentEnvelope(
  value: Record<string, unknown>,
  now: number
): SearchCacheEnvelope | null {
  const metadata = envelopeMetadataSchema.safeParse(value);
  if (
    !metadata.success ||
    metadata.data.cachedAt > now ||
    metadata.data.expiresAt !== metadata.data.cachedAt + SEARCH_CACHE_TTL_MS ||
    metadata.data.expiresAt <= now
  ) {
    return null;
  }

  const snapshot = decodePersistedSearchPayload(value.snapshot);
  if (!snapshot) return null;

  return {
    ...metadata.data,
    snapshot,
    browserState: decodeSearchCacheBrowserState(value.browserState),
  };
}

function migrateLegacyCache(
  value: Record<string, unknown>,
  now: number
): SearchCacheEnvelope | null {
  const snapshot = decodePersistedSearchPayload(value);
  if (!snapshot) return null;

  const cachedAt = snapshot.timestamp;
  const expiresAt = cachedAt + SEARCH_CACHE_TTL_MS;
  if (!isDateSafeTimestamp(expiresAt) || expiresAt <= now) return null;

  return {
    version: SEARCH_CACHE_VERSION,
    snapshot,
    browserState: decodeSearchCacheBrowserState(value),
    cachedAt,
    expiresAt,
  };
}

function readLastSearchEnvelope(): SearchCacheEnvelope | null {
  const stored = localStorage.getItem(LAST_SEARCH_KEY);
  if (!stored) return null;

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return removeInvalidCache();
  }
  if (!isRecord(value)) return removeInvalidCache();

  const now = Date.now();
  const isCurrentEnvelope = Object.prototype.hasOwnProperty.call(value, 'snapshot');
  const envelope = isCurrentEnvelope
    ? decodeCurrentEnvelope(value, now)
    : migrateLegacyCache(value, now);
  if (!envelope) return removeInvalidCache();

  // This also migrates legacy entries and strips corrupt/unknown browser state.
  const canonicalSerialized = JSON.stringify(envelope);
  if (canonicalSerialized !== stored) localStorage.setItem(LAST_SEARCH_KEY, canonicalSerialized);
  return envelope;
}

export function saveLastSearch(data: SearchCacheWritePayload): void {
  const cachedAt = Date.now();
  const snapshot = decodePersistedSearchPayload(data, cachedAt);
  if (!snapshot) throw new TypeError('Invalid search snapshot');

  persistEnvelope({
    version: SEARCH_CACHE_VERSION,
    snapshot,
    browserState: decodeSearchCacheBrowserState(data),
    cachedAt,
    expiresAt: cachedAt + SEARCH_CACHE_TTL_MS,
  });
}

export function getLastSearch(): CachedSearch | null {
  const envelope = readLastSearchEnvelope();
  if (!envelope) return null;
  return { ...envelope.snapshot, ...envelope.browserState };
}

/** Patches validated browser state without changing search age or cache expiry. */
export function updateLastSearchEnrichment(patch: SearchCacheBrowserState): void {
  const envelope = readLastSearchEnvelope();
  if (!envelope) return;

  persistEnvelope({
    ...envelope,
    browserState: {
      ...envelope.browserState,
      ...decodeSearchCacheBrowserState(patch),
    },
  });
}

interface PendingSearchSyncEnvelope {
  version: typeof PENDING_SEARCH_SYNC_VERSION;
  snapshot: PersistedSearchPayload;
}

/** Persists the single-slot durable write queue independently from the resume cache TTL. */
export function markLastSearchPending(snapshot: PersistedSearchPayload): void {
  const canonicalSnapshot = decodePersistedSearchPayload(snapshot);
  if (!canonicalSnapshot) throw new TypeError('Invalid pending search snapshot');

  const pending: PendingSearchSyncEnvelope = {
    version: PENDING_SEARCH_SYNC_VERSION,
    snapshot: canonicalSnapshot,
  };
  localStorage.setItem(PENDING_LAST_SEARCH_KEY, JSON.stringify(pending));
}

export function getPendingLastSearch(): PersistedSearchPayload | null {
  const stored = localStorage.getItem(PENDING_LAST_SEARCH_KEY);
  if (!stored) return null;

  try {
    const value: unknown = JSON.parse(stored);
    if (!isRecord(value) || value.version !== PENDING_SEARCH_SYNC_VERSION) {
      localStorage.removeItem(PENDING_LAST_SEARCH_KEY);
      return null;
    }

    const snapshot = decodePersistedSearchPayload(value.snapshot);
    if (snapshot) return snapshot;
  } catch {
    // Invalid pending writes are not safe to send to the durable endpoint.
  }

  localStorage.removeItem(PENDING_LAST_SEARCH_KEY);
  return null;
}

/** Clears only writes that the server has accepted or superseded with a newer snapshot. */
export function acknowledgeLastSearchSync(accepted: PersistedSearchPayload): void {
  const pending = getPendingLastSearch();
  if (!pending) return;
  if (comparePersistedSearchPayloads(accepted, pending) >= 0) {
    localStorage.removeItem(PENDING_LAST_SEARCH_KEY);
  }
}
