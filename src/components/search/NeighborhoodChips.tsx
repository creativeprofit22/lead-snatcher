'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin } from 'lucide-react';

interface Neighborhood {
  label: string;
  score: number;
  level: 'premium' | 'commercial' | 'moderate' | 'developing';
  latitude: number;
  longitude: number;
}

interface NeighborhoodChipsProps {
  city: string;
  country: string;
  onNeighborhoodSelect: (combinedCity: string) => void;
  disabled?: boolean;
}

const DEBOUNCE_MS = 700;
const MIN_CHARS = 3;

/**
 * Returns the base city name — i.e. the text after the first comma if the
 * user has refined to "Neighborhood, City", else the whole input.
 * This makes chip-switching stable: picking a new chip replaces the old
 * prefix instead of stacking ("West Loop, The Loop, Chicago").
 */
function cityBase(city: string): string {
  const commaIdx = city.indexOf(',');
  if (commaIdx === -1) return city.trim();
  return city.slice(commaIdx + 1).trim();
}

function SkeletonChip({ index }: { index: number }) {
  const widths = [64, 86, 72, 96, 78];
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="relative h-7 overflow-hidden rounded-full border border-sky-400/15 bg-white/[0.03]"
      style={{ width: widths[index % widths.length] }}
    >
      <motion.div
        animate={{ x: ['-100%', '200%'] }}
        transition={{
          repeat: Infinity,
          duration: 1.6,
          ease: 'linear',
          delay: index * 0.18,
        }}
        className="absolute inset-y-0 w-full bg-gradient-to-r from-transparent via-sky-400/25 to-transparent"
      />
    </motion.div>
  );
}

export function NeighborhoodChips({
  city,
  country,
  onNeighborhoodSelect,
  disabled,
}: NeighborhoodChipsProps) {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [pending, setPending] = useState(false);
  const lastFetchedRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const trimmedCity = city.trim();
  const hasRefinement = trimmedCity.includes(',');
  const base = cityBase(trimmedCity);
  const tooShort = base.length < MIN_CHARS;
  const activeLabel = hasRefinement ? trimmedCity.split(',')[0].trim() : null;

  useEffect(() => {
    // Cleared input or too short — wipe state so next typing starts fresh
    if (tooShort) {
      setNeighborhoods([]);
      setPending(false);
      lastFetchedRef.current = '';
      return;
    }

    // User already picked a chip — keep existing chips visible for deselect,
    // don't re-fetch (the cached list is still valid for the base city).
    if (hasRefinement) {
      setPending(false);
      return;
    }

    const cacheKey = `${country}|${base.toLowerCase()}`;
    if (lastFetchedRef.current === cacheKey) {
      setPending(false);
      return;
    }

    // New city and no cached result → show pending state IMMEDIATELY so the
    // user sees "we're working on it" instead of 700ms of silence.
    setPending(true);

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastFetchedRef.current = cacheKey;

      try {
        const response = await fetch(
          `/api/business/neighborhoods?city=${encodeURIComponent(base)}&country=${encodeURIComponent(country)}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          setNeighborhoods([]);
          return;
        }
        const data = await response.json();
        setNeighborhoods(
          Array.isArray(data.neighborhoods) ? data.neighborhoods : []
        );
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setNeighborhoods([]);
        }
      } finally {
        if (abortRef.current === controller) {
          setPending(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [trimmedCity, country, hasRefinement, tooShort, base]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (tooShort) return null;

  const showChips = neighborhoods.length > 0;
  if (!pending && !showChips) return null;

  const handlePick = (n: Neighborhood) => {
    if (disabled) return;
    const nextBase = base || trimmedCity;
    // Clicking the currently-active chip deselects, reverting to base city.
    if (activeLabel === n.label) {
      onNeighborhoodSelect(nextBase);
      return;
    }
    onNeighborhoodSelect(`${n.label}, ${nextBase}`);
  };

  return (
    <div className="mt-3 w-full max-w-md">
      <div className="mb-1.5 flex items-center justify-between px-1">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-sky-300/80">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
            </span>
            Scanning {base || 'zones'}…
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
            {activeLabel ? 'Tap to switch · tap active to clear' : 'Top zones in area'}
          </span>
        )}
        {showChips && !pending && (
          <span className="font-mono text-[10px] text-white/30">
            {neighborhoods.length} found
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {pending ? (
          <>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonChip key={i} index={i} />
            ))}
          </>
        ) : (
          <AnimatePresence>
            {neighborhoods.map((n, i) => {
              const isActive = activeLabel === n.label;
              const isPremium = n.level === 'premium' || n.level === 'commercial';
              return (
                <motion.button
                  key={n.label + n.latitude + n.longitude}
                  type="button"
                  onClick={() => handlePick(n)}
                  disabled={disabled}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ delay: i * 0.04, duration: 0.2, ease: 'easeOut' }}
                  className={`group relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                    isActive
                      ? 'border-sky-400/70 bg-sky-500/20 text-sky-100 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                      : isPremium
                        ? 'border-sky-400/35 bg-sky-500/10 text-sky-200/90 hover:border-sky-400/60 hover:bg-sky-500/15'
                        : 'border-white/10 bg-white/[0.04] text-white/70 hover:border-white/25 hover:bg-white/[0.08] hover:text-white'
                  }`}
                  title={isActive ? 'Click to deselect' : undefined}
                >
                  <MapPin className="h-3 w-3 opacity-70 group-hover:opacity-100" />
                  <span className="font-medium">{n.label}</span>
                  <span
                    className={`font-mono text-[10px] ${
                      isActive ? 'text-sky-200/70' : 'text-white/35'
                    }`}
                  >
                    {n.score}
                  </span>
                  {isActive && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
                    </span>
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
