'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { EnrichmentStatus } from '@/components/leads/EnrichButton';
import type { DiscoveredSocials } from '@/lib/business/enrichment';
import {
  buildEnrichmentRequest,
  streamEnrichment,
  type EnrichmentStreamRow,
  type EnrichmentTransportFailure,
} from '@/lib/business/enrichment-stream-client';
import type { BusinessSearchResult } from '@/types';

export interface EnrichmentResult {
  website?: string;
  socials?: DiscoveredSocials;
  /** True when the row came from cache — UI can skip the "new" banner. */
  cached?: boolean;
  /** Populated when an error/rate-limit row is received. */
  error?: string;
}

/** Persistent error surfaced via an inline banner, not a toast. Used
 *  for failures that require the user to do something (log in again,
 *  add an API key) rather than transient per-lead hiccups. */
export interface EnrichmentBannerError {
  kind: 'session_expired' | 'rate_limited' | 'server_error' | 'network';
  message: string;
  /** HTTP status when known — helps the UI decide the severity. */
  status?: number;
}

export interface UseEnrichmentStream {
  statusMap: Record<string, EnrichmentStatus>;
  resultMap: Record<string, EnrichmentResult>;
  /** Current persistent error, or null. Banner renders when set. */
  bannerError: EnrichmentBannerError | null;
  /** Clear the banner (called on dismiss or on next success). */
  clearBannerError: () => void;
  /**
   * Fire enrichment for the given leads. Filters client-side: leads
   * that already have both website + socials are skipped (0 API cost).
   * Returns a promise that resolves when the stream closes.
   */
  enrichLeads: (leads: BusinessSearchResult[], city: string, country: string) => Promise<void>;
  /** Clear a lead's ephemeral enriched/error state back to idle. */
  clearStatus: (businessId: string) => void;
  /**
   * Rehydrate the hook's maps from persisted state (localStorage / DB).
   * Used on mount so tab-navigation doesn't wipe the progress UI.
   * Skips rehydration when the hook already has state to avoid
   * clobbering an in-flight stream.
   */
  hydrate: (
    status: Record<string, EnrichmentStatus> | undefined,
    result: Record<string, EnrichmentResult> | undefined
  ) => void;
}

/**
 * Owns enrichment UI state and consumes typed outcomes from the NDJSON transport.
 * Cards read `statusMap[id]` and `resultMap[id]`; selection and presentation stay
 * at the page composition boundary.
 */
export function useEnrichmentStream(): UseEnrichmentStream {
  const [statusMap, setStatusMap] = useState<Record<string, EnrichmentStatus>>({});
  const [resultMap, setResultMap] = useState<Record<string, EnrichmentResult>>({});
  const [bannerError, setBannerError] = useState<EnrichmentBannerError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasStateRef = useRef(false);

  const clearBannerError = useCallback(() => setBannerError(null), []);

  const clearStatus = useCallback((businessId: string) => {
    setStatusMap((previous) => {
      if (previous[businessId] === 'idle' || !previous[businessId]) return previous;
      const next = { ...previous };
      delete next[businessId];
      return next;
    });
  }, []);

  // Preserve the page's existing lifecycle: every status-map change restarts the
  // three-second expiry timers for success rows currently on screen.
  useEffect(() => {
    const timers: number[] = [];
    for (const [businessId, status] of Object.entries(statusMap)) {
      if (status === 'enriched') {
        timers.push(window.setTimeout(() => clearStatus(businessId), 3000));
      }
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [clearStatus, statusMap]);

  const applyRow = useCallback((row: EnrichmentStreamRow) => {
    if (row.status === 'ok' || row.status === 'cached') setBannerError(null);

    setStatusMap((previous) => ({
      ...previous,
      [row.businessId]: rowToStatus(row),
    }));
    setResultMap((previous) => ({
      ...previous,
      [row.businessId]: {
        website: row.website,
        socials: row.socials,
        cached: row.status === 'cached',
        error: row.error,
      },
    }));
  }, []);

  const enrichLeads = useCallback(
    async (leads: BusinessSearchResult[], city: string, country: string): Promise<void> => {
      const requestedIds = leads.map((lead) => lead.placeId);
      hasStateRef.current = true;
      setStatusMap((previous) => {
        const next = { ...previous };
        for (const businessId of requestedIds) next[businessId] = 'enriching';
        return next;
      });

      const request = buildEnrichmentRequest(leads, city, country);
      if (request.leads.length === 0) {
        setStatusMap((previous) => {
          const next = { ...previous };
          for (const businessId of requestedIds) delete next[businessId];
          return next;
        });
        toast.info(
          leads.length === 1
            ? 'This lead already has full contact data'
            : `All ${leads.length} selected leads already have full contact data`
        );
        return;
      }

      // Global cancellation is intentional: starting any enrichment aborts the
      // prior stream, matching the existing single-controller semantics.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const outcome = await streamEnrichment(request, {
        signal: controller.signal,
        onRow: applyRow,
      });
      if (outcome.type !== 'failure') return;

      applyFailureStatuses(outcome.failure, request.leads, setStatusMap);
      showFailure(outcome.failure, setBannerError);
    },
    [applyRow]
  );

  const hydrate = useCallback(
    (
      status: Record<string, EnrichmentStatus> | undefined,
      result: Record<string, EnrichmentResult> | undefined
    ) => {
      // Treat both maps as one snapshot. Once a request or prior hydration owns
      // either map, a late persistence read cannot seed the other half.
      if (hasStateRef.current) return;
      if (!status && !result) return;
      hasStateRef.current = true;
      if (status) setStatusMap(status);
      if (result) setResultMap(result);
    },
    []
  );

  return {
    statusMap,
    resultMap,
    enrichLeads,
    clearStatus,
    hydrate,
    bannerError,
    clearBannerError,
  };
}

function rowToStatus(row: EnrichmentStreamRow): EnrichmentStatus {
  if (row.status === 'rate_limited') return 'rate_limited';
  if (row.status === 'error') return 'error';
  return 'enriched';
}

function applyFailureStatuses(
  failure: EnrichmentTransportFailure,
  leads: Array<{ businessId: string }>,
  setStatusMap: React.Dispatch<React.SetStateAction<Record<string, EnrichmentStatus>>>
): void {
  setStatusMap((previous) => {
    const next = { ...previous };
    for (const lead of leads) {
      if (failure.kind !== 'stream_error' || next[lead.businessId] === 'enriching') {
        next[lead.businessId] = 'error';
      }
    }
    return next;
  });
}

function showFailure(
  failure: EnrichmentTransportFailure,
  setBannerError: React.Dispatch<React.SetStateAction<EnrichmentBannerError | null>>
): void {
  if (!isBannerFailure(failure)) {
    toast.error(failure.message);
    return;
  }

  if (failure.kind === 'session_expired') toast.error(failure.message, { duration: 8000 });
  else toast.error(failure.message);
  setBannerError(failure);
}

function isBannerFailure(failure: EnrichmentTransportFailure): failure is EnrichmentBannerError {
  return failure.kind !== 'stream_error';
}
