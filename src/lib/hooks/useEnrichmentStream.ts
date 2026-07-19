'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { EnrichmentStatus } from '@/components/leads/EnrichButton';
import type { DiscoveredSocials } from '@/lib/business/enrichment';
import { previewEnrichment } from '@/lib/business/enrichment-preview';
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
   * Used on mount so tab-navigation doesn't wipe the ⚡→✓ progress.
   * Skips rehydration when the hook already has state to avoid
   * clobbering an in-flight stream.
   */
  hydrate: (
    status: Record<string, EnrichmentStatus> | undefined,
    result: Record<string, EnrichmentResult> | undefined
  ) => void;
}

interface StreamRow {
  businessId: string;
  status: 'ok' | 'cached' | 'rate_limited' | 'error';
  website?: string;
  socials?: DiscoveredSocials;
  error?: string;
  resetIn?: number;
}

/**
 * Consumes the NDJSON stream from POST /api/business/enrich and exposes
 * per-businessId status + found data for UI consumption.
 *
 * The hook intentionally owns no card-card presentation — it's a
 * data source. Cards read `statusMap[id]` to render the button and
 * `resultMap[id]` to render the found-data diff / merged fields.
 */
export function useEnrichmentStream(): UseEnrichmentStream {
  const [statusMap, setStatusMap] = useState<Record<string, EnrichmentStatus>>({});
  const [resultMap, setResultMap] = useState<Record<string, EnrichmentResult>>({});
  const [bannerError, setBannerError] = useState<EnrichmentBannerError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearBannerError = useCallback(() => setBannerError(null), []);

  const clearStatus = useCallback((businessId: string) => {
    setStatusMap((prev) => {
      if (prev[businessId] === 'idle' || !prev[businessId]) return prev;
      const next = { ...prev };
      delete next[businessId];
      return next;
    });
  }, []);

  const enrichLeads = useCallback(
    async (leads: BusinessSearchResult[], city: string, country: string): Promise<void> => {
      // STEP 1 — flip every requested lead to 'enriching' FIRST. This
      // is the "every click produces visible feedback" guarantee: even
      // if the payload ends up empty (all already enriched) or the
      // fetch fails instantly, the user sees the button react. A
      // silent no-op on click is the worst UX state; avoid it.
      const requestedIds = leads.map((l) => l.placeId);
      setStatusMap((prev) => {
        const next = { ...prev };
        for (const id of requestedIds) next[id] = 'enriching';
        return next;
      });

      // STEP 2 — filter to the leads that actually need an API call.
      // A lead with both website + socials needs nothing; skip it.
      const payload = leads
        .map((lead) => {
          const preview = previewEnrichment(lead);
          if (preview.alreadyEnriched) return null;
          return {
            businessId: lead.placeId,
            name: lead.name,
            needsWebsite: preview.willFind.includes('website'),
            needsSocials: preview.willFind.includes('socials'),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (payload.length === 0) {
        // Nothing to do — reset status + tell the user why. Without
        // the toast this path looked like a dead click.
        setStatusMap((prev) => {
          const next = { ...prev };
          for (const id of requestedIds) delete next[id];
          return next;
        });
        toast.info(
          leads.length === 1
            ? 'This lead already has full contact data'
            : `All ${leads.length} selected leads already have full contact data`
        );
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let response: Response;
      try {
        response = await fetch('/api/business/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leads: payload, city, country }),
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setStatusMap((prev) => {
          const next = { ...prev };
          for (const l of payload) next[l.businessId] = 'error';
          return next;
        });
        const msg = "Couldn't reach enrichment service — check your connection";
        toast.error(msg);
        setBannerError({ kind: 'network', message: msg });
        return;
      }

      if (!response.ok || !response.body) {
        setStatusMap((prev) => {
          const next = { ...prev };
          for (const l of payload) next[l.businessId] = 'error';
          return next;
        });
        // Surface the actual HTTP status + server message so the user
        // (or whoever's looking over their shoulder) knows what's
        // actually broken. "Refresh the page" was useless; this isn't.
        let serverMessage = '';
        try {
          const body = await response.clone().json();
          serverMessage = typeof body?.error === 'string' ? `: ${body.error}` : '';
        } catch {
          /* response wasn't JSON — that's fine */
        }
        if (response.status === 401) {
          const msg = 'Your session expired. Log in again to keep enriching leads.';
          toast.error(msg, { duration: 8000 });
          setBannerError({
            kind: 'session_expired',
            message: msg,
            status: 401,
          });
        } else if (response.status === 429) {
          const msg = 'Rate-limited — wait a moment before retrying.';
          toast.error(msg);
          setBannerError({
            kind: 'rate_limited',
            message: msg,
            status: 429,
          });
        } else {
          const msg = `Enrichment failed (${response.status})${serverMessage}`;
          toast.error(msg);
          setBannerError({
            kind: 'server_error',
            message: msg,
            status: response.status,
          });
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const applyRow = (row: StreamRow) => {
        // First successful row clears any lingering banner from a
        // previous failed attempt — recovery is self-announcing.
        if (row.status === 'ok' || row.status === 'cached') {
          setBannerError(null);
        }
        setStatusMap((prev) => ({
          ...prev,
          [row.businessId]:
            row.status === 'rate_limited'
              ? 'rate_limited'
              : row.status === 'error'
                ? 'error'
                : 'enriched',
        }));
        setResultMap((prev) => ({
          ...prev,
          [row.businessId]: {
            website: row.website,
            socials: row.socials,
            cached: row.status === 'cached',
            error: row.error,
          },
        }));
      };

      try {
        // Read loop. Every line is a JSON row; partial lines are
        // buffered until the newline arrives.
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
              const row = JSON.parse(line) as StreamRow;
              applyRow(row);
            } catch {
              // Ignore malformed lines — stream continues.
            }
          }
        }
        // Flush any trailing content.
        const tail = buffer.trim();
        if (tail) {
          try {
            applyRow(JSON.parse(tail) as StreamRow);
          } catch {
            /* noop */
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Whatever's still marked 'enriching' after a read failure
        // becomes 'error' so the user can retry.
        setStatusMap((prev) => {
          const next = { ...prev };
          for (const l of payload) {
            if (next[l.businessId] === 'enriching') next[l.businessId] = 'error';
          }
          return next;
        });
        toast.error('Enrichment stream dropped — click any lead to retry');
      }
    },
    []
  );

  const hydrate = useCallback(
    (
      status: Record<string, EnrichmentStatus> | undefined,
      result: Record<string, EnrichmentResult> | undefined
    ) => {
      // Don't clobber an in-flight stream — rehydration is a mount-time
      // convenience, not a runtime override. Only seed when both maps
      // are empty.
      setStatusMap((prev) => (Object.keys(prev).length === 0 && status ? status : prev));
      setResultMap((prev) => (Object.keys(prev).length === 0 && result ? result : prev));
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
