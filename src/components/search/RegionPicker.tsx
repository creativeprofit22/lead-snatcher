'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, MapPin, Gem, Building2, Shuffle, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  neighborhoodLookupResponseSchema,
  type NeighborhoodSuggestion,
  type RegionDirection,
  type RegionSummary,
} from '@/lib/business/neighborhood-contract';
import type { ZoneArchetype } from '@/lib/business/zone-contract';
import { REGION_DISPLAY_LAYOUT, REGION_SHORT_LABELS } from '@/lib/business/zone-regions';
/**
 * Two-stage location picker that replaces the flat NeighborhoodChips. Lets
 * users browse by geographic region (3×3 grid: NW/N/NE, W/Central/E,
 * SW/S/SE) first, then drills into named neighborhoods within the chosen
 * region. Designed to surface neighborhoods that would otherwise lose the
 * flat top-6 race — Canary Wharf, Stratford, Greenwich all live in
 * different regions than Mayfair, so they get their own slot.
 *
 * The picker collapses only after a user selects a neighborhood here. Commas
 * in manually typed locations remain part of the full discovery query.
 */

type RegionRequestStatus = 'idle' | 'pending' | 'resolved';

interface RegionResultState {
  key: string;
  status: RegionRequestStatus;
  regions: readonly RegionSummary[];
  zones: readonly NeighborhoodSuggestion[];
  singleZone: boolean;
}

const EMPTY_RESULT: RegionResultState = {
  key: '',
  status: 'idle',
  regions: [],
  zones: [],
  singleZone: false,
};

/**
 * Archetype presentation — icon, short label, and color tone. Consumer
 * wealth is amber (gem), corporate is sky (building), mixed is violet
 * (shuffle), developing is muted. Keeps the "what kind of money" signal
 * legible at chip-size without a legend.
 */
const ARCHETYPE_DISPLAY: Record<
  ZoneArchetype,
  { icon: LucideIcon; label: string; tone: string; bg: string }
> = {
  luxury: {
    icon: Gem,
    label: 'Luxury',
    tone: 'text-amber-300',
    bg: 'bg-amber-500/10 border-amber-400/30',
  },
  corporate: {
    icon: Building2,
    label: 'Corporate',
    tone: 'text-sky-300',
    bg: 'bg-sky-500/10 border-sky-400/30',
  },
  mixed: {
    icon: Shuffle,
    label: 'Mixed',
    tone: 'text-violet-300',
    bg: 'bg-violet-500/10 border-violet-400/30',
  },
  developing: {
    icon: TrendingUp,
    label: 'Developing',
    tone: 'text-white/45',
    bg: 'bg-white/[0.04] border-white/10',
  },
};

interface RegionPickerProps {
  cityQuery: string;
  country: string;
  neighborhoodSelected?: boolean;
  onNeighborhoodSelect: (neighborhoodLabel: string) => void;
  disabled?: boolean;
}

const DEBOUNCE_MS = 700;
const MIN_CHARS = 3;

function SkeletonTile({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.04 }}
      className="relative aspect-[3/2] overflow-hidden rounded-lg border border-sky-400/15 bg-white/[0.03]"
    >
      <motion.div
        animate={{ x: ['-100%', '200%'] }}
        transition={{
          repeat: Infinity,
          duration: 1.6,
          ease: 'linear',
          delay: index * 0.12,
        }}
        className="absolute inset-y-0 w-full bg-gradient-to-r from-transparent via-sky-400/20 to-transparent"
      />
    </motion.div>
  );
}

function scoreTone(score: number): { text: string; border: string; bg: string } {
  if (score >= 75) {
    return {
      text: 'text-amber-300',
      border: 'border-amber-400/40',
      bg: 'bg-amber-500/[0.06] hover:bg-amber-500/[0.12]',
    };
  }
  if (score >= 50) {
    return {
      text: 'text-sky-300',
      border: 'border-sky-400/40',
      bg: 'bg-sky-500/[0.06] hover:bg-sky-500/[0.12]',
    };
  }
  if (score >= 25) {
    return {
      text: 'text-slate-200',
      border: 'border-white/15',
      bg: 'bg-white/[0.03] hover:bg-white/[0.06]',
    };
  }
  return {
    text: 'text-white/45',
    border: 'border-white/8',
    bg: 'bg-white/[0.02] hover:bg-white/[0.04]',
  };
}

export function RegionPicker({
  cityQuery,
  country,
  neighborhoodSelected = false,
  onNeighborhoodSelect,
  disabled,
}: RegionPickerProps) {
  const [result, setResult] = useState<RegionResultState>(EMPTY_RESULT);
  const [selectedRegion, setSelectedRegion] = useState<RegionDirection | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const base = cityQuery.trim();
  const tooShort = base.length < MIN_CHARS;
  const requestKey = `${country}|${base.toLowerCase()}`;

  useEffect(() => {
    if (tooShort) {
      setResult(EMPTY_RESULT);
      return;
    }

    // An explicit picker selection, rather than punctuation, keeps the picker collapsed.
    if (neighborhoodSelected) return;

    setResult({
      key: requestKey,
      status: 'pending',
      regions: [],
      zones: [],
      singleZone: false,
    });

    let controller: AbortController | null = null;
    const timer = setTimeout(() => {
      void (async () => {
        abortRef.current?.abort();
        controller = new AbortController();
        abortRef.current = controller;

        try {
          const response = await fetch(
            `/api/business/neighborhoods?city=${encodeURIComponent(base)}&country=${encodeURIComponent(country)}`,
            { signal: controller.signal }
          );
          if (controller.signal.aborted) return;

          if (!response.ok) {
            setResult((current) =>
              current.key === requestKey
                ? { ...current, status: 'resolved', regions: [], zones: [], singleZone: false }
                : current
            );
            return;
          }

          const data: unknown = await response.json();
          if (controller.signal.aborted) return;

          const parsed = neighborhoodLookupResponseSchema.safeParse(data);
          const nextResult = parsed.success
            ? {
                regions: parsed.data.regions,
                zones: parsed.data.zones,
                singleZone: parsed.data.singleZone,
              }
            : { regions: [], zones: [], singleZone: false };

          setResult((current) =>
            current.key === requestKey
              ? {
                  key: requestKey,
                  status: 'resolved',
                  ...nextResult,
                }
              : current
          );
        } catch (err) {
          if (!controller.signal.aborted && err instanceof Error && err.name !== 'AbortError') {
            setResult((current) =>
              current.key === requestKey
                ? { ...current, status: 'resolved', regions: [], zones: [], singleZone: false }
                : current
            );
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller?.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [requestKey, country, neighborhoodSelected, tooShort, base]);

  useEffect(() => {
    // Reset drill-in whenever the city or country request changes.
    setSelectedRegion(null);
  }, [requestKey]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (tooShort) return null;
  if (neighborhoodSelected) return null;

  const hasCurrentResult = result.key === requestKey;
  const pending = !hasCurrentResult || result.status === 'pending';
  const regions = hasCurrentResult ? result.regions : [];
  const zones = hasCurrentResult ? result.zones : [];
  const singleZone = hasCurrentResult && result.singleZone;

  const zonesInRegion = selectedRegion
    ? zones
        .filter((z) => z.region === selectedRegion)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    : [];

  const handleRegionPick = (direction: RegionDirection) => {
    if (disabled) return;
    setSelectedRegion(direction);
  };

  const handleNeighborhoodPick = (neighborhood: NeighborhoodSuggestion) => {
    if (disabled) return;
    onNeighborhoodSelect(neighborhood.label);
  };

  // Loading state — skeleton grid
  if (pending && regions.length === 0) {
    return (
      <div className="mt-3 w-full max-w-md">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-sky-300/80">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
            </span>
            Scanning {base || 'city'}…
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <SkeletonTile key={i} index={i} />
          ))}
        </div>
      </div>
    );
  }

  if (regions.length === 0) return null;

  // Small-city fallback: only one meaningful region. Skip the grid and show
  // neighborhoods directly — forcing a user to click "Central" when there's
  // nothing else is pointless friction.
  if (singleZone || regions.filter((r) => r.zoneCount > 0).length <= 1) {
    const fallbackNeighborhoods = [...zones].sort((a, b) => b.score - a.score).slice(0, 8);
    if (fallbackNeighborhoods.length === 0) return null;
    return (
      <div className="mt-3 w-full max-w-md">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
            Top zones in {base}
          </span>
          <span className="font-mono text-[10px] text-white/30">
            {fallbackNeighborhoods.length} found
          </span>
        </div>
        <NeighborhoodChipRow
          items={fallbackNeighborhoods}
          onPick={handleNeighborhoodPick}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <div className="mt-3 w-full max-w-md">
      <AnimatePresence mode="wait">
        {selectedRegion === null ? (
          <motion.div
            key="regions"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
                Browse {base} by region
              </span>
              <span className="font-mono text-[10px] text-white/30">
                {regions.filter((r) => r.zoneCount > 0).length} active
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {REGION_DISPLAY_LAYOUT.flat().map((direction, i) => {
                const region = regions.find((r) => r.direction === direction);
                const score = region?.score ?? 0;
                const count = region?.zoneCount ?? 0;
                const empty = count === 0;
                // Archetype of the top-scoring zone inside this region —
                // tells the user at a glance whether it's a luxury,
                // corporate, or mixed money district.
                const topZone = region?.topLabel
                  ? zones.filter((z) => z.region === direction).sort((a, b) => b.score - a.score)[0]
                  : null;
                const topArchetype = topZone?.archetype ?? 'developing';
                const ArcheIcon = ARCHETYPE_DISPLAY[topArchetype].icon;
                const archeTone = ARCHETYPE_DISPLAY[topArchetype].tone;
                const tone = empty
                  ? {
                      text: 'text-white/30',
                      border: 'border-white/5',
                      bg: 'bg-white/[0.01]',
                    }
                  : scoreTone(score);
                return (
                  <motion.button
                    key={direction}
                    type="button"
                    onClick={() => !empty && handleRegionPick(direction)}
                    disabled={disabled || empty}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.02, duration: 0.2 }}
                    className={`group relative flex aspect-[3/2] flex-col items-center justify-center gap-0.5 rounded-lg border p-1.5 transition-all disabled:cursor-not-allowed ${tone.border} ${tone.bg}`}
                  >
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.2em] ${tone.text}`}
                    >
                      {REGION_SHORT_LABELS[direction]}
                    </span>
                    {!empty && (
                      <>
                        <span
                          className={`font-orbitron text-base font-semibold tabular-nums ${tone.text}`}
                        >
                          {score}
                        </span>
                        {region?.topLabel && (
                          <span className="max-w-full truncate text-[9px] text-white/45">
                            {region.topLabel}
                          </span>
                        )}
                        {topZone && (
                          <span
                            className={`inline-flex items-center gap-0.5 font-mono text-[8px] uppercase tracking-wider ${archeTone}`}
                          >
                            <ArcheIcon className="h-2 w-2" />
                            {ARCHETYPE_DISPLAY[topArchetype].label}
                          </span>
                        )}
                      </>
                    )}
                    {empty && <span className="text-[9px] text-white/30">—</span>}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="neighborhoods"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <div className="mb-1.5 flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => setSelectedRegion(null)}
                className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.25em] text-sky-300/80 transition-colors hover:text-sky-200"
              >
                <ArrowLeft className="h-3 w-3" />
                Back
              </button>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/50">
                {regions.find((r) => r.direction === selectedRegion)?.label}
                <span className="ml-1.5 text-white/30">· {zonesInRegion.length}</span>
              </span>
            </div>
            <NeighborhoodChipRow
              items={zonesInRegion}
              onPick={handleNeighborhoodPick}
              disabled={disabled}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NeighborhoodChipRow({
  items,
  onPick,
  disabled,
}: {
  items: readonly NeighborhoodSuggestion[];
  onPick: (n: NeighborhoodSuggestion) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="px-1 text-[11px] text-white/40">No strongly-tagged neighborhoods found here.</p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      <AnimatePresence>
        {items.map((n, i) => {
          const arche = ARCHETYPE_DISPLAY[n.archetype];
          const ArcheIcon = arche.icon;
          return (
            <motion.button
              key={n.label + n.latitude + n.longitude}
              type="button"
              onClick={() => onPick(n)}
              disabled={disabled}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ delay: i * 0.04, duration: 0.2, ease: 'easeOut' }}
              title={`💎 Wealth ${n.wealthScore}  ·  🏢 Business ${n.businessScore}`}
              className={`group relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all disabled:cursor-not-allowed disabled:opacity-40 ${arche.bg} hover:brightness-125`}
            >
              <MapPin className="h-3 w-3 opacity-60 group-hover:opacity-100" />
              <span className="font-medium text-white/90">{n.label}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${arche.tone} border-current/30`}
              >
                <ArcheIcon className="h-2.5 w-2.5" />
                {arche.label}
              </span>
              <span className="font-mono text-[10px] text-white/45">{n.score}</span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
