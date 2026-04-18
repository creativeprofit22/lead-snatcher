'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TextEffect } from '@/components/motion-primitives/text-effect';
import type { BusinessSearchResult } from '@/types';
import type { Zone } from '@/lib/business/zone-grid';

interface RadarScanProps {
  city: string;
  results: BusinessSearchResult[] | null;
  zones?: Zone[] | null;
  /** [south, north, west, east] — used to place both zones and pins consistently. */
  zoneBbox?: [number, number, number, number] | null;
  singleZone?: boolean;
  onComplete?: () => void;
}

// ---------- constants ----------

const RADAR_SIZE = 500;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = RADAR_CENTER - 24;
const MAX_PINS = 60;
const SWEEP_DURATION_MS = 2400;
const SWEEP_WEDGE_DEG = 30;
const BULK_DROP_AFTER_MS = 3200;
const COMPLETE_HOLD_MS = 700;
const ZONE_STAGGER_MS = 90;
const ZONE_BLOOM_HOLD_MS = 1100; // time to hold zone view before the lock-in
const ZOOM_DURATION_MS = 900; // camera lock-on animation length
const ZOOM_SCALE = 2.2; // tight-view zoom factor

// Labels for top N highest-scoring zones (with named places, not directional)
const LABELED_ZONE_COUNT = 3;

const DIRECTIONAL_FALLBACK_LABELS = new Set([
  'SW Quadrant',
  'South',
  'SE Quadrant',
  'West',
  'Central',
  'East',
  'NW Quadrant',
  'North',
  'NE Quadrant',
  'Zone',
]);

type Phase = 'sweep' | 'bloom' | 'zooming' | 'pins' | 'complete';

interface Pin {
  key: string;
  x: number;
  y: number;
  angle: number;
}

interface ZoneDot {
  id: string;
  label: string;
  score: number;
  x: number;
  y: number;
  /** true when the zone label should be shown */
  labeled: boolean;
  /** bloom stagger order, 0 = earliest */
  order: number;
}

// ---------- helpers ----------

function polarAngle(x: number, y: number, cx: number, cy: number): number {
  const a = Math.atan2(y - cy, x - cx);
  let deg = (a * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function crossedAngle(prev: number, curr: number, target: number): boolean {
  if (curr >= prev) return target > prev && target <= curr;
  return target > prev || target <= curr;
}

/** Project lat/lng to radar SVG space using a bounding box. */
function projectToRadar(
  lat: number,
  lng: number,
  bbox: [number, number, number, number]
): { x: number; y: number } {
  const [south, north, west, east] = bbox;
  const nx = (lng - west) / Math.max(east - west, 1e-6);
  const ny = 1 - (lat - south) / Math.max(north - south, 1e-6);
  const offX = (nx - 0.5) * 2;
  const offY = (ny - 0.5) * 2;
  const mag = Math.min(1, Math.hypot(offX, offY));
  const rad = Math.atan2(offY, offX);
  const r = mag * RADAR_RADIUS * 0.85;
  return {
    x: RADAR_CENTER + Math.cos(rad) * r,
    y: RADAR_CENTER + Math.sin(rad) * r,
  };
}

/** Auto-compute bbox from a set of points (fallback when zoneBbox missing). */
function autoBbox(
  points: { latitude?: number; longitude?: number }[]
): [number, number, number, number] | null {
  const withCoords = points.filter(
    (p) => typeof p.latitude === 'number' && typeof p.longitude === 'number'
  );
  if (withCoords.length === 0) return null;
  const lats = withCoords.map((p) => p.latitude!);
  const lngs = withCoords.map((p) => p.longitude!);
  return [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
}

// ---------- component ----------

export function RadarScan({
  city,
  results,
  zones,
  zoneBbox,
  singleZone,
  onComplete,
}: RadarScanProps) {
  const [phase, setPhase] = useState<Phase>('sweep');
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [bloomedCount, setBloomedCount] = useState(0);

  const litRef = useRef<Set<string>>(new Set());
  const startTimeRef = useRef<number>(0);
  const pinRevealStartRef = useRef<number | null>(null);
  const lastAngleRef = useRef<number>(0);
  const completedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  if (startTimeRef.current === 0) {
    startTimeRef.current = performance.now();
  }

  // Pick bbox: prefer explicit zoneBbox, else derive from zones, else from results.
  const effectiveBbox: [number, number, number, number] | null = useMemo(() => {
    if (zoneBbox) return zoneBbox;
    if (zones && zones.length > 0) {
      const bb = autoBbox(zones);
      if (bb) return bb;
    }
    if (results && results.length > 0) return autoBbox(results);
    return null;
  }, [zoneBbox, zones, results]);

  // Prepare zone dots — score-desc, label top 3 (named places only)
  const zoneDots: ZoneDot[] = useMemo(() => {
    if (!zones || zones.length === 0 || !effectiveBbox) return [];
    const sorted = [...zones].sort((a, b) => b.score - a.score);

    // Only label zones that have real place names (not directional fallbacks)
    const nameable = sorted.filter(
      (z) => !DIRECTIONAL_FALLBACK_LABELS.has(z.label)
    );
    const labeledIds = new Set(
      nameable.slice(0, LABELED_ZONE_COUNT).map((z) => z.id)
    );

    return sorted.map((z, i) => {
      const { x, y } = projectToRadar(z.latitude, z.longitude, effectiveBbox);
      return {
        id: z.id,
        label: z.label,
        score: z.score,
        x,
        y,
        labeled: labeledIds.has(z.id),
        order: i,
      };
    });
  }, [zones, effectiveBbox]);

  // Prepare business pins
  const pins: Pin[] = useMemo(() => {
    if (!results || results.length === 0) return [];

    const withCoords = results.filter(
      (r) => typeof r.latitude === 'number' && typeof r.longitude === 'number'
    );

    // If we have a bbox and coord-bearing results, project onto it for
    // spatially-correct placement. This uses the SAME bbox as zones, so pins
    // visibly sit inside their respective zone dots.
    if (effectiveBbox && withCoords.length > 0) {
      return withCoords.slice(0, MAX_PINS).map((r) => {
        const { x, y } = projectToRadar(r.latitude!, r.longitude!, effectiveBbox);
        return {
          key: r.placeId,
          x,
          y,
          angle: polarAngle(x, y, RADAR_CENTER, RADAR_CENTER),
        };
      });
    }

    // Fallback: no coords — spread on a spiral so the radar still feels alive
    return results.slice(0, MAX_PINS).map((r, i) => {
      const angle = (i / results.length) * Math.PI * 2;
      const dist = 0.35 + ((i * 37) % 55) / 100;
      const x = RADAR_CENTER + Math.cos(angle) * RADAR_RADIUS * dist;
      const y = RADAR_CENTER + Math.sin(angle) * RADAR_RADIUS * dist;
      return {
        key: r.placeId,
        x,
        y,
        angle: polarAngle(x, y, RADAR_CENTER, RADAR_CENTER),
      };
    });
  }, [results, effectiveBbox]);

  // ---------- phase machine ----------

  // sweep → bloom when zones arrive
  useEffect(() => {
    if (phase !== 'sweep') return;
    if (zoneDots.length > 0) {
      setPhase('bloom');
    } else if (results && pins.length > 0) {
      // No zones at all (small city / fallback) — skip straight to pins
      setPhase('pins');
      pinRevealStartRef.current = performance.now();
    }
  }, [phase, zoneDots.length, results, pins.length]);

  // bloom → stagger zones in, then advance to zooming
  useEffect(() => {
    if (phase !== 'bloom' || zoneDots.length === 0) return;

    setBloomedCount(0);
    const timers: number[] = [];
    zoneDots.forEach((z, i) => {
      timers.push(
        window.setTimeout(() => {
          setBloomedCount((prev) => Math.max(prev, i + 1));
        }, i * ZONE_STAGGER_MS)
      );
    });

    const totalStagger = zoneDots.length * ZONE_STAGGER_MS;
    const advanceTimer = window.setTimeout(() => {
      setPhase('zooming');
    }, totalStagger + ZONE_BLOOM_HOLD_MS);

    timers.push(advanceTimer);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [phase, zoneDots]);

  // zooming → pins once the camera finishes locking on
  useEffect(() => {
    if (phase !== 'zooming') return;
    const t = window.setTimeout(() => {
      pinRevealStartRef.current = performance.now();
      setPhase('pins');
    }, ZOOM_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  // pins → sweep-synced reveal
  useEffect(() => {
    if (phase !== 'pins' || pins.length === 0 || completedRef.current) return;

    const step = () => {
      const now = performance.now();
      const elapsed = now - startTimeRef.current;
      const currentDeg = ((elapsed / SWEEP_DURATION_MS) * 360) % 360;
      const prevDeg = lastAngleRef.current;

      let added = 0;
      pins.forEach((pin) => {
        if (litRef.current.has(pin.key)) return;
        if (crossedAngle(prevDeg, currentDeg, pin.angle)) {
          litRef.current.add(pin.key);
          added++;
        }
      });

      const revealStart = pinRevealStartRef.current ?? now;
      if (now - revealStart > BULK_DROP_AFTER_MS) {
        pins.forEach((p) => {
          if (!litRef.current.has(p.key)) {
            litRef.current.add(p.key);
            added++;
          }
        });
      }

      if (added > 0) setLit(new Set(litRef.current));
      lastAngleRef.current = currentDeg;

      if (litRef.current.size >= pins.length && !completedRef.current) {
        completedRef.current = true;
        setPhase('complete');
        window.setTimeout(() => onComplete?.(), COMPLETE_HOLD_MS);
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [phase, pins, onComplete]);

  // ---------- header / footer text ----------

  const allLit = pins.length > 0 && lit.size >= pins.length;
  const topZone = zoneDots[0] ?? null;

  const headerLabel = (() => {
    if (phase === 'complete' || allLit) return 'Scan Complete';
    if (phase === 'pins') return 'Acquiring Targets';
    if (phase === 'zooming')
      return topZone ? `Locking On ${topZone.label}` : 'Locking On';
    if (phase === 'bloom') {
      const premium = zoneDots.filter((z) => z.score >= 50).length;
      return premium > 0
        ? `${premium} Prime Zone${premium === 1 ? '' : 's'} Identified`
        : 'Mapping Zones';
    }
    return singleZone ? 'Scanning Area' : 'Scanning Metropolitan Zone';
  })();

  const wedgeEndRad = (-SWEEP_WEDGE_DEG * Math.PI) / 180;
  const wedgeEndX = RADAR_CENTER + RADAR_RADIUS * Math.cos(wedgeEndRad);
  const wedgeEndY = RADAR_CENTER + RADAR_RADIUS * Math.sin(wedgeEndRad);

  // Camera transform — scales + offsets SVG so topZone lands at container center.
  const tightView =
    !!topZone && (phase === 'zooming' || phase === 'pins' || phase === 'complete');
  const zoomXPct = topZone
    ? ((RADAR_CENTER - topZone.x * ZOOM_SCALE) / RADAR_SIZE) * 100
    : 0;
  const zoomYPct = topZone
    ? ((RADAR_CENTER - topZone.y * ZOOM_SCALE) / RADAR_SIZE) * 100
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#05080f]/95 backdrop-blur-xl"
    >
      <div className="mb-6 flex flex-col items-center text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={headerLabel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25 }}
            className="font-mono text-[10px] uppercase tracking-[0.3em] text-sky-300/80"
          >
            {headerLabel}
          </motion.div>
        </AnimatePresence>
        <div className="mt-1 font-mono text-xl uppercase tracking-[0.2em] text-white">
          {city || 'Area'}
        </div>
      </div>

      <div
        className="relative"
        style={{
          width: 'min(500px, 85vw)',
          height: 'min(500px, 85vw)',
          aspectRatio: '1 / 1',
        }}
      >
        {/* Clipping layer — zoomed SVG scales beyond bounds, labels below
            are siblings of this, so they can overflow freely. */}
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute inset-0"
            style={{ transformOrigin: '0 0' }}
            animate={{
              x: tightView ? `${zoomXPct}%` : '0%',
              y: tightView ? `${zoomYPct}%` : '0%',
              scale: tightView ? ZOOM_SCALE : 1,
            }}
            transition={{
              duration: ZOOM_DURATION_MS / 1000,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <svg
              viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
              className="absolute inset-0 h-full w-full"
            >
          <defs>
            <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0a2540" stopOpacity="0.6" />
              <stop offset="70%" stopColor="#041226" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#050810" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="sweep-grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0" />
              <stop offset="70%" stopColor="#0ea5e9" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.95" />
            </linearGradient>
            <radialGradient id="zone-halo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx={RADAR_CENTER} cy={RADAR_CENTER} r={RADAR_RADIUS} fill="url(#radar-bg)" />

          {[0.33, 0.66, 1].map((f) => (
            <circle
              key={f}
              cx={RADAR_CENTER}
              cy={RADAR_CENTER}
              r={RADAR_RADIUS * f}
              fill="none"
              stroke="#38bdf8"
              strokeOpacity="0.18"
              strokeWidth="1"
            />
          ))}

          <line
            x1={RADAR_CENTER}
            y1={RADAR_CENTER - RADAR_RADIUS}
            x2={RADAR_CENTER}
            y2={RADAR_CENTER + RADAR_RADIUS}
            stroke="#38bdf8"
            strokeOpacity="0.14"
            strokeDasharray="2 4"
          />
          <line
            x1={RADAR_CENTER - RADAR_RADIUS}
            y1={RADAR_CENTER}
            x2={RADAR_CENTER + RADAR_RADIUS}
            y2={RADAR_CENTER}
            stroke="#38bdf8"
            strokeOpacity="0.14"
            strokeDasharray="2 4"
          />

          <motion.g
            style={{ transformOrigin: `${RADAR_CENTER}px ${RADAR_CENTER}px` }}
            animate={{ rotate: 360 }}
            transition={{
              duration: SWEEP_DURATION_MS / 1000,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            <path
              d={`M ${RADAR_CENTER} ${RADAR_CENTER} L ${RADAR_CENTER + RADAR_RADIUS} ${RADAR_CENTER} A ${RADAR_RADIUS} ${RADAR_RADIUS} 0 0 0 ${wedgeEndX} ${wedgeEndY} Z`}
              fill="url(#sweep-grad)"
              opacity="0.85"
            />
            <line
              x1={RADAR_CENTER}
              y1={RADAR_CENTER}
              x2={RADAR_CENTER + RADAR_RADIUS}
              y2={RADAR_CENTER}
              stroke="#7dd3fc"
              strokeWidth="1.5"
              strokeOpacity="0.9"
            />
          </motion.g>

          <circle cx={RADAR_CENTER} cy={RADAR_CENTER} r="4" fill="#38bdf8" />
          <circle
            cx={RADAR_CENTER}
            cy={RADAR_CENTER}
            r="10"
            fill="none"
            stroke="#38bdf8"
            strokeOpacity="0.4"
          />
          <circle cx={RADAR_CENTER} cy={RADAR_CENTER} fill="none" stroke="#38bdf8" strokeWidth="1">
            <animate attributeName="r" values="12;22;12" dur="2.2s" repeatCount="indefinite" />
            <animate
              attributeName="stroke-opacity"
              values="0.4;0;0.4"
              dur="2.2s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Zone dots — visible during bloom, fade non-top zones on lock-in */}
          {(phase === 'bloom' ||
            phase === 'zooming' ||
            phase === 'pins' ||
            phase === 'complete') &&
            zoneDots.map((z, i) => {
              const visible = phase !== 'bloom' || i < bloomedCount;
              if (!visible) return null;
              // Halo radius scales from 10px (score 0) to 36px (score 100).
              const haloR = 10 + (z.score / 100) * 26;
              const dotOpacity = 0.35 + (z.score / 100) * 0.65;
              const isTop = i === 0;
              const locked =
                phase === 'zooming' || phase === 'pins' || phase === 'complete';
              // During lock-on, non-top zones fade; top zone stays bright.
              // Once pins start, even the top zone softens so pins dominate.
              const groupOpacity = locked
                ? isTop
                  ? phase === 'pins' || phase === 'complete'
                    ? 0.55
                    : 1
                  : 0
                : 1;
              return (
                <motion.g
                  key={z.id}
                  initial={{ opacity: 0, scale: 0.2 }}
                  animate={{ opacity: groupOpacity, scale: 1 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{ transformOrigin: `${z.x}px ${z.y}px` }}
                >
                  <circle cx={z.x} cy={z.y} r={haloR} fill="url(#zone-halo)" />
                  <circle
                    cx={z.x}
                    cy={z.y}
                    r={5}
                    fill="#7dd3fc"
                    fillOpacity={dotOpacity}
                  />
                  <circle cx={z.x} cy={z.y} r={3} fill="#e0f2fe" />
                  {/* Corner-bracket lock indicator, only on top zone during lock-on */}
                  {isTop && locked && (
                    <motion.g
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 0.9, scale: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      style={{ transformOrigin: `${z.x}px ${z.y}px` }}
                    >
                      {(() => {
                        const r = haloR + 8;
                        const t = 5;
                        return (
                          <>
                            {/* TL */}
                            <line x1={z.x - r} y1={z.y - r} x2={z.x - r + t} y2={z.y - r} stroke="#7dd3fc" strokeWidth="1.5" />
                            <line x1={z.x - r} y1={z.y - r} x2={z.x - r} y2={z.y - r + t} stroke="#7dd3fc" strokeWidth="1.5" />
                            {/* TR */}
                            <line x1={z.x + r} y1={z.y - r} x2={z.x + r - t} y2={z.y - r} stroke="#7dd3fc" strokeWidth="1.5" />
                            <line x1={z.x + r} y1={z.y - r} x2={z.x + r} y2={z.y - r + t} stroke="#7dd3fc" strokeWidth="1.5" />
                            {/* BL */}
                            <line x1={z.x - r} y1={z.y + r} x2={z.x - r + t} y2={z.y + r} stroke="#7dd3fc" strokeWidth="1.5" />
                            <line x1={z.x - r} y1={z.y + r} x2={z.x - r} y2={z.y + r - t} stroke="#7dd3fc" strokeWidth="1.5" />
                            {/* BR */}
                            <line x1={z.x + r} y1={z.y + r} x2={z.x + r - t} y2={z.y + r} stroke="#7dd3fc" strokeWidth="1.5" />
                            <line x1={z.x + r} y1={z.y + r} x2={z.x + r} y2={z.y + r - t} stroke="#7dd3fc" strokeWidth="1.5" />
                          </>
                        );
                      })()}
                    </motion.g>
                  )}
                </motion.g>
              );
            })}

          {/* Business pins */}
          {(phase === 'pins' || phase === 'complete') &&
            pins.map((pin) =>
              lit.has(pin.key) ? (
                <g key={pin.key}>
                  <circle
                    cx={pin.x}
                    cy={pin.y}
                    fill="none"
                    stroke="#7dd3fc"
                    strokeWidth="1.5"
                    className="radar-pin-ripple"
                  />
                  <circle cx={pin.x} cy={pin.y} fill="#38bdf8" className="radar-pin-dot" />
                </g>
              ) : null
            )}
          </svg>
          </motion.div>
        </div>

        {/* Zone labels — live OUTSIDE the clipping layer so names near the
            radar edge don't get cut off. */}
        {(phase === 'bloom' ||
          phase === 'zooming' ||
          phase === 'pins' ||
          phase === 'complete') &&
          zoneDots.map((z, i) => {
            if (!z.labeled) return null;
            const visible = phase !== 'bloom' || i < bloomedCount;
            if (!visible) return null;
            const isTop = i === 0;
            const locked =
              phase === 'zooming' || phase === 'pins' || phase === 'complete';
            // Non-top zones fade out on lock-in. Top zone slides to container
            // center so it tracks its dot through the zoom.
            const labelLeft = locked && isTop ? 50 : (z.x / RADAR_SIZE) * 100;
            const labelTop = locked && isTop ? 50 : (z.y / RADAR_SIZE) * 100;
            const labelOpacity = locked && !isTop ? 0 : locked && isTop ? 0.9 : 1;
            return (
              <motion.div
                key={`label-${z.id}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{
                  left: `${labelLeft}%`,
                  top: `${labelTop}%`,
                  opacity: labelOpacity,
                  y: 0,
                }}
                transition={{
                  duration: locked ? ZOOM_DURATION_MS / 1000 : 0.35,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-center"
                style={{
                  marginTop: '-18px',
                  textShadow:
                    '0 0 6px rgba(8, 18, 38, 0.95), 0 1px 2px rgba(0,0,0,0.9)',
                }}
              >
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-sky-100 font-semibold">
                  <TextEffect as="span" per="char" preset="fade-in-blur" speedReveal={3}>
                    {z.label}
                  </TextEffect>
                </div>
                <div className="font-mono text-[10px] text-sky-300/80">
                  <TextEffect as="span" per="char" preset="fade-in-blur" speedReveal={4} delay={0.15}>
                    {String(z.score)}
                  </TextEffect>
                </div>
              </motion.div>
            );
          })}
      </div>

      <div className="mt-6 flex h-6 items-center justify-center">
        <AnimatePresence mode="wait">
          {phase === 'bloom' && (
            <motion.div
              key="bloom"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.1 }}
              className="font-mono text-sm uppercase tracking-[0.25em] text-sky-300"
            >
              Signal locked — {bloomedCount}/{zoneDots.length} zones active
            </motion.div>
          )}
          {phase === 'zooming' && (
            <motion.div
              key="zooming"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.1 }}
              className="font-mono text-sm uppercase tracking-[0.25em] text-sky-200"
            >
              Camera lock engaged
            </motion.div>
          )}
          {(phase === 'pins' || phase === 'complete') && pins.length > 0 && (
            <motion.div
              key="count"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.15 }}
              className="font-mono text-sm uppercase tracking-[0.25em] text-sky-300"
            >
              {lit.size} / {pins.length} targets acquired
            </motion.div>
          )}
          {phase === 'sweep' && (
            <motion.div
              key="scanning"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.3, 0.9, 0.3] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="font-mono text-sm uppercase tracking-[0.25em] text-sky-300/60"
            >
              Sweeping market…
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
