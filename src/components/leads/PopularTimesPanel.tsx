'use client';

/**
 * Popular Times — opt-in foot-traffic enrichment for a saved lead.
 *
 * Renders the current popularity, weekly busyness histogram, and typical
 * visit duration. The data is scraped on demand (button click) and cached
 * on the Lead record. Does NOT auto-refresh.
 */

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Loader2, RotateCw } from 'lucide-react';

interface PopularTimesData {
  weekly: number[][];
  currentPopularity?: number;
  timeSpent?: string;
  dayLabels: string[];
}

interface PopularTimesPanelProps {
  leadId: string;
  initialData?: string | null;
  initialScrapedAt?: string | null;
}

export function PopularTimesPanel({
  leadId,
  initialData,
  initialScrapedAt,
}: PopularTimesPanelProps) {
  const [data, setData] = useState<PopularTimesData | null>(() => {
    if (!initialData) return null;
    try {
      return JSON.parse(initialData) as PopularTimesData;
    } catch {
      return null;
    }
  });
  const [scrapedAt, setScrapedAt] = useState<string | null>(initialScrapedAt ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (force = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/leads/${leadId}/popular-times${force ? '?force=true' : ''}`,
        { method: 'POST' }
      );
      const payload = await response.json();
      if (!response.ok) {
        setError(
          payload.error ??
            'Could not fetch — Google may have changed their page, try again later'
        );
        return;
      }
      setData(payload.data);
      setScrapedAt(payload.scrapedAt);
    } catch {
      setError('Network error while fetching Popular Times');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial state — never been scraped
  if (!data && !error) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-sky-400" />
          <h4 className="text-sm font-semibold text-gray-200">Popular Times</h4>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Foot-traffic histogram + real-time busyness from Google Maps. Scraped on demand,
          cached after first fetch.
        </p>
        <button
          onClick={() => fetchData(false)}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm font-medium text-sky-200 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Fetching…
            </>
          ) : (
            <>
              <Activity className="h-4 w-4" />
              Fetch Popular Times
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-sky-400" />
          <h4 className="text-sm font-semibold text-gray-200">Popular Times</h4>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={isLoading}
          title="Re-scrape from Google"
          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCw className="h-3 w-3" />
          )}
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <>
          {typeof data.currentPopularity === 'number' && (
            <CurrentPopularityBar value={data.currentPopularity} />
          )}
          <WeeklyHistogram weekly={data.weekly} dayLabels={data.dayLabels} />
          {data.timeSpent && (
            <p className="mt-3 text-xs text-gray-500">
              Typical visit: <span className="text-gray-300">{data.timeSpent}</span>
            </p>
          )}
          {scrapedAt && (
            <p className="mt-1 text-[10px] text-gray-600">
              Last scraped {new Date(scrapedAt).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CurrentPopularityBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(150, value));
  const widthPct = Math.min(100, (clamped / 150) * 100);
  const tone =
    clamped >= 75
      ? 'from-orange-400 to-amber-400'
      : clamped >= 40
        ? 'from-sky-400 to-cyan-400'
        : 'from-slate-500 to-slate-400';
  const label =
    clamped >= 75 ? 'As busy as it gets' : clamped >= 40 ? 'Steady' : 'Quiet';
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-mono uppercase tracking-[0.18em] text-white/40">Live</span>
        <span className="text-white/85">
          <span className="tabular-nums font-semibold">{clamped}%</span>{' '}
          <span className="text-white/45">— {label}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

function WeeklyHistogram({
  weekly,
  dayLabels,
}: {
  weekly: number[][];
  dayLabels: string[];
}) {
  // Per-day peak helps colour-code rows: a day with peak >= 75 reads "hot"
  const dayPeaks = useMemo(() => weekly.map((row) => Math.max(...row, 0)), [weekly]);

  return (
    <div className="space-y-1.5">
      <div className="mb-1 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">
        <span>Weekly busyness</span>
        <span>0h → 23h</span>
      </div>
      {weekly.map((row, di) => {
        const peak = dayPeaks[di];
        const peakTone =
          peak >= 75 ? 'text-orange-300' : peak >= 40 ? 'text-sky-200' : 'text-white/40';
        return (
          <div key={di} className="flex items-center gap-2">
            <span className={`w-8 font-mono text-[10px] uppercase ${peakTone}`}>
              {dayLabels[di]}
            </span>
            <div className="flex h-5 flex-1 items-end gap-px">
              {row.map((busy, hi) => {
                const heightPct = Math.max(2, Math.min(100, busy));
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
                    className={`flex-1 rounded-sm ${tone}`}
                    style={{ height: `${heightPct}%`, opacity: busy === 0 ? 0.25 : 1 }}
                    title={`${dayLabels[di]} ${hi}:00 — ${busy}%`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
