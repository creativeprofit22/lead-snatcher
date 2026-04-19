'use client';

import { useCallback, useRef, useState } from 'react';
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

export interface UseEnrichmentStream {
  statusMap: Record<string, EnrichmentStatus>;
  resultMap: Record<string, EnrichmentResult>;
  /**
   * Fire enrichment for the given leads. Filters client-side: leads
   * that already have both website + socials are skipped (0 API cost).
   * Returns a promise that resolves when the stream closes.
   */
  enrichLeads: (
    leads: BusinessSearchResult[],
    city: string,
    country: string
  ) => Promise<void>;
  /** Clear a lead's ephemeral enriched/error state back to idle. */
  clearStatus: (businessId: string) => void;
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
  const [statusMap, setStatusMap] = useState<Record<string, EnrichmentStatus>>(
    {}
  );
  const [resultMap, setResultMap] = useState<Record<string, EnrichmentResult>>(
    {}
  );
  const abortRef = useRef<AbortController | null>(null);

  const clearStatus = useCallback((businessId: string) => {
    setStatusMap((prev) => {
      if (prev[businessId] === 'idle' || !prev[businessId]) return prev;
      const next = { ...prev };
      delete next[businessId];
      return next;
    });
  }, []);

  const enrichLeads = useCallback(
    async (
      leads: BusinessSearchResult[],
      city: string,
      country: string
    ): Promise<void> => {
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

      if (payload.length === 0) return;

      // Mark all requested leads as enriching upfront — the user's
      // cards should show spinners the moment the button is pressed,
      // not when the first response streams in.
      setStatusMap((prev) => {
        const next = { ...prev };
        for (const l of payload) next[l.businessId] = 'enriching';
        return next;
      });

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
        // Network abort or offline — mark all as errored.
        setStatusMap((prev) => {
          const next = { ...prev };
          for (const l of payload) next[l.businessId] = 'error';
          return next;
        });
        if (err instanceof Error && err.name === 'AbortError') return;
        throw err;
      }

      if (!response.ok || !response.body) {
        setStatusMap((prev) => {
          const next = { ...prev };
          for (const l of payload) next[l.businessId] = 'error';
          return next;
        });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const applyRow = (row: StreamRow) => {
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
      }
    },
    []
  );

  return { statusMap, resultMap, enrichLeads, clearStatus };
}
