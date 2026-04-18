'use client';

/**
 * Per-card Foot Traffic enrichment for search results.
 *
 * Compact slot that lives in the right column of a lead card. Three
 * states: empty (Fetch button), loaded (mini-histogram + peak%), error
 * (inline amber message). Data + state are owned by the parent so the
 * Fit Score sort can recompute live as data lands.
 */

import { Activity, AlertTriangle, Loader2, RotateCw } from 'lucide-react';

interface FootTrafficData {
  weekly: number[][];
  currentPopularity?: number;
  timeSpent?: string;
  dayLabels: string[];
  scrapedAt: string;
}

interface FootTrafficSlotProps {
  data?: FootTrafficData;
  loading: boolean;
  error?: string;
  onFetch: () => void;
}

export function FootTrafficSlot({
  data,
  loading,
  error,
  onFetch,
}: FootTrafficSlotProps) {
  // Empty state — small button only, no chrome
  if (!data && !error) {
    return (
      <button
        onClick={onFetch}
        disabled={loading}
        className="group flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:border-sky-500/55 hover:bg-sky-500/15 disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Activity className="h-3.5 w-3.5" />
        )}
        {loading ? 'Scanning…' : 'Fetch Foot Traffic'}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.18em]">
        <span className="text-sky-300/80 inline-flex items-center gap-1">
          <Activity className="h-3 w-3" />
          Foot Traffic
        </span>
        <button
          onClick={onFetch}
          disabled={loading}
          title="Re-scrape from Google"
          className="text-white/40 hover:text-white/80 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span className="leading-tight">{error}</span>
        </div>
      )}

      {data && <CompactHistogram data={data} />}
    </div>
  );
}

function CompactHistogram({ data }: { data: FootTrafficData }) {
  const peak = Math.max(0, ...data.weekly.flat());
  const peakTone =
    peak >= 75
      ? 'text-orange-300'
      : peak >= 50
        ? 'text-sky-200'
        : 'text-white/55';
  const liveTone =
    typeof data.currentPopularity === 'number' && data.currentPopularity >= 75
      ? 'text-orange-300'
      : 'text-sky-200';

  return (
    <>
      <div className="mb-1.5 flex items-center justify-between text-[10px]">
        <span className="text-white/45">
          Peak <span className={`font-mono font-semibold tabular-nums ${peakTone}`}>{peak}%</span>
        </span>
        {typeof data.currentPopularity === 'number' && (
          <span className="text-white/45">
            Live{' '}
            <span className={`font-mono font-semibold tabular-nums ${liveTone}`}>
              {data.currentPopularity}%
            </span>
          </span>
        )}
      </div>
      {/* Tiny 7-row histogram, 1px-tall day rows */}
      <div className="space-y-0.5">
        {data.weekly.map((row, di) => (
          <div key={di} className="flex h-1 items-stretch gap-px">
            {row.map((busy, hi) => {
              const tone =
                busy >= 75
                  ? 'bg-orange-400'
                  : busy >= 40
                    ? 'bg-sky-400'
                    : busy >= 10
                      ? 'bg-slate-400'
                      : 'bg-white/10';
              return (
                <div
                  key={hi}
                  className={`flex-1 rounded-[1px] ${tone}`}
                  style={{ opacity: busy === 0 ? 0.25 : Math.max(0.4, busy / 100) }}
                  title={`${data.dayLabels[di]} ${hi}:00 — ${busy}%`}
                />
              );
            })}
          </div>
        ))}
      </div>
      {data.timeSpent && (
        <p className="mt-1.5 text-[10px] text-white/40">
          Typical visit: <span className="text-white/70">{data.timeSpent}</span>
        </p>
      )}
    </>
  );
}
