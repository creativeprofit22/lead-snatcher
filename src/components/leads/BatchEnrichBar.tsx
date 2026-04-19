'use client';

import { Zap, X } from 'lucide-react';
import { previewBatch } from '@/lib/business/enrichment-preview';
import type { BusinessSearchResult } from '@/types';

interface Props {
  /** Leads that match the selected IDs, in card order. */
  selectedLeads: BusinessSearchResult[];
  /** Number of selected leads whose data is already in our cache. */
  cachedCount: number;
  onEnrich: () => void;
  onClear: () => void;
  /** True while a stream is running. */
  isBusy: boolean;
}

/**
 * Floating action bar shown when at least one lead is selected.
 * Lives at the bottom-center of the viewport. Live summary updates
 * as selection changes — call count is real (sum of missing data
 * minus cache hits), not a guess, so users see truthful cost.
 */
export function BatchEnrichBar({
  selectedLeads,
  cachedCount,
  onEnrich,
  onClear,
  isBusy,
}: Props) {
  if (selectedLeads.length === 0) return null;

  const preview = previewBatch(selectedLeads);
  const liveCalls = Math.max(0, preview.totalCalls - cachedCount * 2);

  return (
    <div
      role="region"
      aria-label="Batch enrichment controls"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
    >
      <div className="flex items-center gap-4 px-4 py-3 rounded-2xl bg-surface-elevated/95 border border-border-bright backdrop-blur-md shadow-2xl">
        <div className="flex flex-col text-left">
          <span className="text-sm font-medium text-white">
            Enrich {selectedLeads.length} lead{selectedLeads.length === 1 ? '' : 's'}
          </span>
          <span className="text-[11px] text-gray-400">
            ~{liveCalls} API call{liveCalls === 1 ? '' : 's'}
            {cachedCount > 0 && (
              <>
                {' '}· {cachedCount} cached (free)
              </>
            )}
            {preview.alreadyEnrichedCount > 0 && (
              <>
                {' '}· {preview.alreadyEnrichedCount} already full
              </>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={onEnrich}
          disabled={isBusy || preview.actionableLeads === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          aria-label={`Enrich ${preview.actionableLeads} leads. Estimated ${liveCalls} API calls.`}
        >
          <Zap className="w-4 h-4" />
          {isBusy ? 'Enriching…' : 'Enrich'}
        </button>

        <button
          type="button"
          onClick={onClear}
          disabled={isBusy}
          className="inline-flex items-center gap-1 px-2 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
          aria-label="Clear selection"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
