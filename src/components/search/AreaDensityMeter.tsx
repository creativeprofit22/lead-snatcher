'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Landmark,
  Hotel,
  Gem,
  Briefcase,
  Building2,
  Crown,
  Sparkles,
  HandCoins,
  MapPin,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import GaugeChart from '@/components/animata/gauge-chart';
import { SlidingNumber } from '@/components/motion-primitives/sliding-number';
import type { Zone } from '@/lib/business/zone-grid';

interface Amenities {
  // Legacy fields — still accepted for backwards compatibility with
  // pre-v2-wealth cached payloads. The rim icons below ignore them.
  banks: number;
  hotels: number;
  hospitals: number;
  pharmacies: number;
  supermarkets: number;
  fuelStations: number;
  affluenceSpots: number;
  total: number;

  // v2-wealth buckets — what the rim now visualizes.
  luxuryRetail?: number;
  professionalServices?: number;
  premiumHotels?: number;
  corporateOffices?: number;
  casinos?: number;
  pawnshops?: number;
}

interface AreaDensityMeterProps {
  score: number;
  level: string;
  label: string;
  description: string;
  amenities?: Amenities;
  /** Top-scored zone in the city scan — used to show exactly where data came from. */
  focusedZone?: Zone;
  /** Human city name (e.g. "Chicago") — shown alongside the neighborhood label. */
  cityLabel?: string;
  /** True when the scan fell back to a single zone (small city / missing bbox). */
  singleZone?: boolean;
}

function formatCoords(lat: number, lon: number): string {
  const latAbs = Math.abs(lat).toFixed(3);
  const lonAbs = Math.abs(lon).toFixed(3);
  return `${latAbs}°${lat >= 0 ? 'N' : 'S'}, ${lonAbs}°${lon >= 0 ? 'E' : 'W'}`;
}

const GAUGE_SIZE = 260;
const ORBITAL_RADIUS = 172;
const CONTAINER_SIZE = GAUGE_SIZE + (ORBITAL_RADIUS - GAUGE_SIZE / 2) * 2 + 56;

// Two-axis rim: top half = luxury signals (consumer wealth), bottom half =
// corporate signals (business density). Pawnshops sit in the upper-left as
// the one negative signal. Icons are spaced exactly 45° apart so they
// distribute evenly and the rotating sweep band passes through each one's
// center without the stacking that happened under the old 52° spacing.
const AMENITIES: {
  key: keyof Omit<Amenities, 'total'>;
  label: string;
  icon: LucideIcon;
  angle: number;
  /** When true, the icon highlights in red/amber as it fills instead of green. */
  negative?: boolean;
}[] = [
  // Luxury arc (top half, 12→4 o'clock)
  { key: 'luxuryRetail', label: 'Luxury', icon: Gem, angle: -90 },
  { key: 'premiumHotels', label: 'Premium', icon: Crown, angle: -45 },
  { key: 'affluenceSpots', label: 'Leisure', icon: Sparkles, angle: 0 },
  { key: 'hotels', label: 'Hotels', icon: Hotel, angle: 45 },
  // Corporate arc (bottom half, 6→8 o'clock)
  { key: 'professionalServices', label: 'Pro Svc', icon: Briefcase, angle: 90 },
  { key: 'corporateOffices', label: 'Offices', icon: Building2, angle: 135 },
  { key: 'banks', label: 'Banks', icon: Landmark, angle: 180 },
  // Negative signal — upper-left so it stays visible without dominating
  { key: 'pawnshops', label: 'Pawn', icon: HandCoins, angle: 225, negative: true },
];

interface LevelPalette {
  progress: string;
  track: string;
  accent: string;
  accentBg: string;
  sweep: string;
  halo: string;
}

const LEVEL_COLORS: Record<string, LevelPalette> = {
  high: {
    progress: 'text-emerald-400',
    track: 'text-emerald-500/15',
    accent: 'text-emerald-400',
    accentBg: 'bg-emerald-400',
    sweep: 'rgba(52, 211, 153, 0.9)',
    halo: '52, 211, 153',
  },
  medium: {
    progress: 'text-amber-400',
    track: 'text-amber-500/15',
    accent: 'text-amber-400',
    accentBg: 'bg-amber-400',
    sweep: 'rgba(251, 191, 36, 0.85)',
    halo: '251, 191, 36',
  },
  low: {
    progress: 'text-blue-400',
    track: 'text-blue-500/15',
    accent: 'text-blue-400',
    accentBg: 'bg-blue-400',
    sweep: 'rgba(96, 165, 250, 0.8)',
    halo: '96, 165, 250',
  },
};

function getLevelColors(level: string): LevelPalette {
  return LEVEL_COLORS[level] ?? LEVEL_COLORS.medium;
}

export function AreaDensityMeter({
  score,
  level,
  label,
  description,
  amenities,
  focusedZone,
  cityLabel,
  singleZone,
}: AreaDensityMeterProps) {
  const colors = getLevelColors(level);

  const targetLen = String(score).length;
  const startValue = targetLen > 1 ? Math.pow(10, targetLen - 1) : 0;
  const [displayScore, setDisplayScore] = useState(startValue);

  useEffect(() => {
    const t = setTimeout(() => setDisplayScore(score), 280);
    return () => clearTimeout(t);
  }, [score]);

  const cx = CONTAINER_SIZE / 2;
  const cy = CONTAINER_SIZE / 2;
  const spokeInner = GAUGE_SIZE / 2 + 10;
  const spokeOuter = ORBITAL_RADIUS - 24;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border-bright/50 bg-gradient-to-br from-surface/80 to-surface-inset/60 p-5 sm:p-7 backdrop-blur-sm"
      style={{ ['--halo' as string]: colors.halo }}
    >
      {/* Ambient tint blob */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-25 blur-3xl"
        style={{ background: colors.sweep }}
      />
      <div
        className="pointer-events-none absolute -left-32 bottom-0 h-64 w-64 rounded-full opacity-10 blur-3xl"
        style={{ background: colors.sweep }}
      />

      <div className="relative flex flex-col items-center gap-8 lg:flex-row lg:gap-12">
        {/* Gauge + orbitals */}
        <div
          className="relative shrink-0"
          style={{ width: CONTAINER_SIZE, height: CONTAINER_SIZE }}
        >
          {/* Outer ambient sweep ring — mask band is centered on
              ORBITAL_RADIUS, which is also where the icon disks sit (their
              centers are translated to cos/sin * ORBITAL_RADIUS), so the
              rotating light passes straight through the middle of each
              icon. Band width is 20px — wider than the old 8px so the sweep
              is clearly visible crossing the 44px icon disks. */}
          <div
            className="pointer-events-none absolute inset-0 animate-[spin_9s_linear_infinite]"
            style={{
              background: `conic-gradient(from 0deg at 50% 50%, transparent 62%, ${colors.sweep} 94%, transparent 100%)`,
              maskImage: `radial-gradient(circle at 50% 50%, transparent ${ORBITAL_RADIUS - 14}px, black ${ORBITAL_RADIUS - 10}px, black ${ORBITAL_RADIUS + 10}px, transparent ${ORBITAL_RADIUS + 14}px)`,
              WebkitMaskImage: `radial-gradient(circle at 50% 50%, transparent ${ORBITAL_RADIUS - 14}px, black ${ORBITAL_RADIUS - 10}px, black ${ORBITAL_RADIUS + 10}px, transparent ${ORBITAL_RADIUS + 14}px)`,
              opacity: 0.6,
            }}
          />

          {/* Spoke lines from center to each active amenity */}
          <svg
            className={`pointer-events-none absolute inset-0 ${colors.accent}`}
            width={CONTAINER_SIZE}
            height={CONTAINER_SIZE}
          >
            {amenities &&
              AMENITIES.map((a, i) => {
                const count = amenities[a.key];
                if (typeof count !== 'number' || count === 0) return null;
                const rad = (a.angle * Math.PI) / 180;
                return (
                  <motion.line
                    key={a.key}
                    x1={cx + Math.cos(rad) * spokeInner}
                    y1={cy + Math.sin(rad) * spokeInner}
                    x2={cx + Math.cos(rad) * spokeOuter}
                    y2={cy + Math.sin(rad) * spokeOuter}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                    initial={{ opacity: 0, pathLength: 0 }}
                    animate={{ opacity: 0.25, pathLength: 1 }}
                    transition={{
                      delay: 0.6 + i * 0.08,
                      duration: 0.5,
                      ease: 'easeOut',
                    }}
                  />
                );
              })}
          </svg>

          {/* Gauge with breathing halo */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="gauge-halo rounded-full">
              <GaugeChart
                size={GAUGE_SIZE}
                progress={score}
                gap={60}
                circleWidth={10}
                progressWidth={14}
                progressClassName={colors.progress}
                trackClassName={colors.track}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    delay: 0.35,
                    duration: 0.4,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="absolute inset-0 flex flex-col items-center justify-center text-center"
                >
                  <div
                    className={`font-mono text-6xl font-bold leading-none ${colors.accent}`}
                  >
                    <SlidingNumber value={displayScore} />
                  </div>
                  <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-gray-500">
                    area score
                  </div>
                </motion.div>
              </GaugeChart>
            </div>
          </div>

          {/* Orbital amenity icons */}
          {amenities &&
            AMENITIES.map((a, i) => {
              const count = amenities[a.key];
              if (typeof count !== 'number') return null;
              const rad = (a.angle * Math.PI) / 180;
              const x = Math.cos(rad) * ORBITAL_RADIUS;
              const y = Math.sin(rad) * ORBITAL_RADIUS;
              const Icon = a.icon;
              const dim = count === 0;
              return (
                <div
                  key={a.key}
                  className="pointer-events-none absolute left-1/2 top-1/2"
                  style={{
                    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                  }}
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: dim ? 0.32 : 1, scale: 1 }}
                    transition={{
                      delay: 0.65 + i * 0.08,
                      duration: 0.45,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="relative"
                  >
                    {/* Icon disk: this is what the parent's -50%/-50% translate
                        is centering on the calculated orbital point. The label
                        below MUST stay absolutely positioned (out of normal
                        flow) — if it sits in the column it pushes the disk
                        upward off the ring. */}
                    {(() => {
                      const activeAccent = a.negative
                        ? 'text-rose-400'
                        : colors.accent;
                      const borderClass = dim
                        ? 'border-white/10 bg-white/[0.02]'
                        : a.negative
                          ? 'border-rose-400/30 bg-rose-500/[0.06]'
                          : 'border-white/20 bg-white/[0.06]';
                      return (
                        <div
                          className={`relative flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-sm ${borderClass}`}
                        >
                          <Icon
                            className={`h-5 w-5 ${dim ? 'text-gray-600' : activeAccent}`}
                          />
                          {count > 0 && (
                            <div
                              className={`absolute -bottom-1 -right-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border border-white/10 bg-black/90 px-1 font-mono text-[10px] font-bold ${activeAccent}`}
                            >
                              {count}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
                      {a.label}
                    </div>
                  </motion.div>
                </div>
              );
            })}
        </div>

        {/* Typography panel */}
        <div className="min-w-0 flex-1 text-center lg:text-left">
          <div
            className={`mb-2 font-mono text-[11px] uppercase tracking-[0.3em] ${colors.accent}`}
          >
            {level} density zone
          </div>
          <div className="mb-2 text-2xl font-semibold text-white sm:text-3xl">
            {label}
          </div>
          <div className="max-w-xl text-sm text-gray-400">{description}</div>

          {focusedZone && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-[11px] lg:justify-start">
              <span className="text-[10px] uppercase tracking-[0.3em] text-gray-500">
                {singleZone ? 'Scan Origin' : 'Focused Zone'}
              </span>
              <span className={`inline-flex items-center gap-1.5 ${colors.accent}`}>
                <MapPin className="h-3 w-3" />
                <span className="font-medium">
                  {focusedZone.label}
                  {cityLabel ? (
                    <span className="text-gray-500">
                      {' · '}
                      {cityLabel}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="text-gray-700">·</span>
              <span className="text-gray-500">
                {formatCoords(focusedZone.latitude, focusedZone.longitude)}
              </span>
              <span className="text-gray-700">·</span>
              <span className="text-gray-500">
                R = {(focusedZone.radiusMeters / 1000).toFixed(1)} km
              </span>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${focusedZone.latitude},${focusedZone.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-gray-500 transition-colors hover:text-white"
                title="Open scan origin in Google Maps"
              >
                <ExternalLink className="h-3 w-3" />
                <span className="text-[10px] uppercase tracking-wider">pin</span>
              </a>
            </div>
          )}

          {amenities && amenities.total > 0 && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-gray-400">
              <span
                className={`h-1.5 w-1.5 rounded-full ${colors.accentBg}`}
              />
              {amenities.total} points of interest in scan radius
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
