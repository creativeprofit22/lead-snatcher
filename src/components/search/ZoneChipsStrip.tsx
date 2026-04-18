'use client';

import { motion } from 'motion/react';
import { MapPin, Loader2, Radar } from 'lucide-react';
import type { Zone } from '@/lib/business/zone-grid';

interface ZoneChipsStripProps {
  zones: Zone[];
  focusedZoneId?: string | null;
  rescanningZoneId?: string | null;
  onZoneSelect: (zone: Zone) => void;
  disabled?: boolean;
}

const MAX_CHIPS = 7;

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

export function ZoneChipsStrip({
  zones,
  focusedZoneId,
  rescanningZoneId,
  onZoneSelect,
  disabled,
}: ZoneChipsStripProps) {
  // Surface meaningful zones only — score > 0 and at least some amenities.
  const ranked = [...zones]
    .filter((z) => z.score > 0 && z.amenities.total > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHIPS);

  if (ranked.length <= 1) return null;

  const activeZone = ranked.find((z) => z.id === focusedZoneId) ?? ranked[0];

  return (
    <div className="mb-4 rounded-xl border border-sky-400/20 bg-gradient-to-br from-sky-500/[0.06] via-surface/60 to-surface/80 p-3 backdrop-blur-sm">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/15 text-sky-300">
            <Radar className="h-3.5 w-3.5" />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-sky-300/90">
              Scanned Zones
            </div>
            <div className="text-[11px] text-white/50">
              {ranked.length} zones · tap to jump scan
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/10 bg-surface-elevated/60 px-2.5 py-1 text-[10px] text-white/60 font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
          <span className="uppercase tracking-wider">Viewing</span>
          <span className="text-white">{activeZone.label}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {ranked.map((z, i) => {
          const isActive = focusedZoneId === z.id;
          const isRescanning = rescanningZoneId === z.id;
          const isPremium = z.level === 'premium' || z.level === 'commercial';
          const isDirectional = DIRECTIONAL_FALLBACK_LABELS.has(z.label);

          return (
            <motion.button
              key={z.id}
              type="button"
              onClick={() => {
                if (disabled || isActive || isRescanning) return;
                onZoneSelect(z);
              }}
              disabled={disabled || isActive}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.22 }}
              className={`group relative inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'border-sky-400/80 bg-sky-500/20 text-sky-50 shadow-[0_0_18px_rgba(56,189,248,0.45)]'
                  : isPremium
                    ? 'border-sky-400/40 bg-sky-500/10 text-sky-100/95 hover:border-sky-400/70 hover:bg-sky-500/18 hover:text-sky-50 hover:shadow-[0_0_14px_rgba(56,189,248,0.3)]'
                    : 'border-white/12 bg-white/[0.05] text-white/75 hover:border-white/28 hover:bg-white/[0.09] hover:text-white'
              } ${
                isRescanning ? 'animate-pulse' : ''
              } disabled:cursor-not-allowed`}
            >
              {isRescanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MapPin className="h-3.5 w-3.5 opacity-80 group-hover:opacity-100" />
              )}
              <span className={`${isDirectional ? 'italic' : ''}`}>
                {z.label}
              </span>
              <span
                className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                  isActive
                    ? 'bg-sky-400/20 text-sky-100'
                    : 'bg-white/5 text-white/50'
                }`}
              >
                {z.score}
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
      </div>
    </div>
  );
}
