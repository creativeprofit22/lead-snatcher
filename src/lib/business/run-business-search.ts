import { z } from 'zod';
import { businessSearchResultSchema } from '@/lib/business/business-search-result-contract';
import {
  SEARCH_SNAPSHOT_VERSION,
  searchMarketDensitySchema,
  type SearchMarketDensity,
  type SearchSnapshot,
} from '@/lib/business/search-snapshot';
import { zoneBboxSchema, zoneScanStatusSchema, zoneSchema } from '@/lib/business/zone-contract';
import type { Zone, ZoneBbox, ZoneScanStatus } from '@/lib/business/zone-contract';
import type { BusinessSearchResult, IndustryType } from '@/types';

const marketDensitySchema = searchMarketDensitySchema
  .unwrap()
  .extend({
    status: zoneScanStatusSchema,
  })
  .nullable();

const responseSchema = z.object({
  results: z.array(businessSearchResultSchema),
  marketDensity: marketDensitySchema,
  zoneScanStatus: zoneScanStatusSchema,
  zones: z.array(zoneSchema),
  zoneBbox: zoneBboxSchema,
  singleZone: z.boolean(),
  focusedZoneId: z.string().nullable(),
});

const errorSchema = z.object({ error: z.string().optional() });

export type SearchMode =
  | { kind: 'initial' }
  | {
      kind: 'zone';
      zone: Zone;
      currentZones: Zone[];
      currentZoneBbox: ZoneBbox | null;
      currentSingleZone: boolean;
    };

export interface RunBusinessSearchInput {
  businessType: string;
  cacheIndustry: IndustryType;
  city: string;
  country: string;
  deepAnalysis: boolean;
  mode: SearchMode;
}

export interface AppliedBusinessSearch {
  results: BusinessSearchResult[];
  marketDensity: SearchMarketDensity | null;
  zoneScanStatus: ZoneScanStatus;
  zones: Zone[];
  zoneBbox: ZoneBbox | null;
  singleZone: boolean;
  focusedZoneId: string | null;
  cachePayload: SearchSnapshot;
  notification: { type: 'success' | 'info' | 'error'; message: string; duration?: number };
  shouldReveal: boolean;
  shouldPersist: boolean;
}

export class BusinessSearchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: 'http' | 'invalid-response' | 'network' | 'timeout'
  ) {
    super(message);
  }
}

export function applyBusinessSearchResponse(
  rawResponse: unknown,
  input: RunBusinessSearchInput
): AppliedBusinessSearch {
  const parsed = responseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new BusinessSearchError(
      'Search returned an invalid response. Try again; if it keeps happening, check the server logs.',
      null,
      'invalid-response'
    );
  }

  const data = parsed.data;
  const results = data.results;
  const responseZones = data.zones;
  const mode = input.mode;
  const isInitial = mode.kind === 'initial';
  const zones =
    mode.kind === 'initial'
      ? responseZones
      : responseZones.length > 0
        ? responseZones
        : mode.currentZones;
  const zoneBbox =
    mode.kind === 'initial' ? data.zoneBbox : (data.zoneBbox ?? mode.currentZoneBbox);
  const singleZone = mode.kind === 'initial' ? data.singleZone : mode.currentSingleZone;
  const focusedZoneId =
    mode.kind === 'zone' && responseZones.length === 0
      ? (data.focusedZoneId ?? mode.zone.id)
      : data.focusedZoneId;

  const cachePayload: SearchSnapshot = {
    version: SEARCH_SNAPSHOT_VERSION,
    results,
    businessType: input.businessType,
    industry: input.cacheIndustry,
    city: input.city,
    country: input.country,
    zones,
    zoneBbox,
    singleZone,
    focusedZoneId,
    marketDensity: data.marketDensity,
    zoneScanStatus: data.zoneScanStatus,
  };

  let notification: AppliedBusinessSearch['notification'];
  if (mode.kind === 'initial') {
    notification =
      results.length === 0
        ? {
            type: 'error',
            message:
              'No businesses returned. The Maps provider sometimes blanks out for micro-zones or repeat queries — hit Search again, or widen to a bigger city name.',
            duration: 8000,
          }
        : { type: 'success', message: `Found ${results.length} businesses` };
  } else {
    notification =
      results.length === 0
        ? { type: 'info', message: `No businesses in ${mode.zone.label}` }
        : {
            type: 'success',
            message: `Scanning ${mode.zone.label} — ${results.length} found`,
          };
  }

  return {
    results,
    marketDensity: data.marketDensity,
    zoneScanStatus: data.zoneScanStatus,
    zones,
    zoneBbox,
    singleZone,
    focusedZoneId,
    cachePayload,
    notification,
    shouldReveal: isInitial && results.length > 0,
    shouldPersist: !isInitial || results.length > 0,
  };
}

export async function runBusinessSearch(
  input: RunBusinessSearchInput,
  options: { fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<AppliedBusinessSearch> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isInitial = input.mode.kind === 'initial';
  const startedAt = now();
  const abortController = isInitial ? new AbortController() : null;
  const timeoutMs = input.deepAnalysis ? 5 * 60_000 : 2 * 60_000;
  const abortTimer = abortController
    ? setTimeout(() => abortController.abort(), timeoutMs)
    : undefined;

  try {
    const zoneFields =
      input.mode.kind === 'zone'
        ? {
            searchLat: input.mode.zone.latitude,
            searchLng: input.mode.zone.longitude,
            zoneLabel: input.mode.zone.label,
          }
        : {};
    const response = await fetcher('/api/business/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessType: input.businessType,
        city: input.city,
        country: input.country,
        limit: 50,
        deepAnalysis: input.deepAnalysis,
        ...zoneFields,
      }),
      signal: abortController?.signal,
    });
    const body: unknown = await response.json();

    if (!response.ok) {
      const error = errorSchema.safeParse(body);
      const fallback =
        input.mode.kind === 'zone' ? 'Zone rescan failed' : `Search failed (${response.status})`;
      throw new BusinessSearchError(
        error.success ? (error.data.error ?? fallback) : fallback,
        response.status,
        'http'
      );
    }

    if (isInitial) {
      const remaining = 900 - (now() - startedAt);
      if (remaining > 0) await sleep(remaining);
    }

    return applyBusinessSearchResponse(body, input);
  } catch (error) {
    if (error instanceof BusinessSearchError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      const message = input.deepAnalysis
        ? 'Deep Analysis sweep took longer than 5 minutes — the server likely died mid-request. Try again, or disable Deep Analysis.'
        : 'Sweep took longer than 2 minutes — the server likely died mid-request (usually a memory spike). Try again with a less dense city.';
      throw new BusinessSearchError(message, null, 'timeout');
    }
    const message =
      input.mode.kind === 'zone'
        ? 'Zone rescan failed'
        : error instanceof TypeError
          ? 'Lost connection to the server mid-sweep. Check the server is still running and try again.'
          : 'Search failed unexpectedly. Try again; if it keeps happening, check the server logs.';
    throw new BusinessSearchError(message, null, 'network');
  } finally {
    if (abortTimer !== undefined) clearTimeout(abortTimer);
  }
}
