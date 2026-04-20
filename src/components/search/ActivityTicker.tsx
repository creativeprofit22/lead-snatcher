'use client';

import { useEffect, useState } from 'react';
import { Activity, Crosshair, Globe2 } from 'lucide-react';
import { SlidingNumber } from '@/components/motion-primitives/sliding-number';

/**
 * Idle-loop activity ticker — three counters that tick up continuously.
 * Seeded from the day-of-year so numbers are stable on reload (no jarring reset)
 * and grow organically while the page is open.
 *
 * Mounted as an always-on HUD strip at the top of the home screen. No start
 * animation — values are already set before the first paint.
 */

const START_DATE = new Date(2026, 0, 1).getTime();
const DAY_MS = 86_400_000;

function daysSinceStart(): number {
  return Math.floor((Date.now() - START_DATE) / DAY_MS);
}

function seededValue(baseDaily: number, perDay: number): number {
  // Deterministic-but-growing: each calendar day bumps the baseline by `perDay`
  // so the counter never resets and feels cumulative across sessions.
  return baseDaily + daysSinceStart() * perDay;
}

interface TickerEntry {
  label: string;
  icon: typeof Activity;
  initial: number;
  tickRangeMs: [number, number];
  deltaRange: [number, number];
}

const ENTRIES: TickerEntry[] = [
  {
    label: 'Sweeps Today',
    icon: Activity,
    initial: seededValue(18, 3),
    tickRangeMs: [6000, 14000],
    deltaRange: [1, 1],
  },
  {
    label: 'Leads Scored',
    icon: Crosshair,
    initial: seededValue(4218, 47),
    tickRangeMs: [1400, 3200],
    deltaRange: [3, 11],
  },
  {
    label: 'Cities Covered',
    icon: Globe2,
    initial: seededValue(147, 1),
    tickRangeMs: [38000, 62000],
    deltaRange: [1, 1],
  },
];

function useTickingValue(entry: TickerEntry): number {
  const [value, setValue] = useState(entry.initial);
  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      const [lo, hi] = entry.tickRangeMs;
      const delay = lo + Math.random() * (hi - lo);
      const t = setTimeout(() => {
        if (cancelled) return;
        const [dlo, dhi] = entry.deltaRange;
        const delta = dlo + Math.floor(Math.random() * (dhi - dlo + 1));
        setValue((v) => v + delta);
        schedule();
      }, delay);
      return t;
    };
    const t = schedule();
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [entry]);
  return value;
}

function TickerCell({ entry }: { entry: TickerEntry }) {
  const value = useTickingValue(entry);
  const Icon = entry.icon;
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <Icon className="h-4 w-4 text-sky-400/80" />
      <div className="flex flex-col leading-none">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">
          {entry.label}
        </span>
        <span className="font-orbitron text-xl font-semibold text-white/95 tabular-nums">
          <SlidingNumber value={value} />
        </span>
      </div>
    </div>
  );
}

export function ActivityTicker() {
  return (
    <div className="hud-panel flex flex-wrap items-center justify-center gap-1 rounded-xl border border-border-bright/50 bg-surface/60 px-3 py-2 backdrop-blur-sm shadow-[0_0_24px_rgba(56,189,248,0.08)]">
      {ENTRIES.map((entry, i) => (
        <div key={entry.label} className="flex items-center">
          {i > 0 && <span className="h-8 w-px bg-border-bright/40" />}
          <TickerCell entry={entry} />
        </div>
      ))}
    </div>
  );
}
