'use client';

import { motion } from 'motion/react';
import { MapPin, Loader2, Radar, Gem, Building2, Shuffle, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Zone, ZoneArchetype } from '@/lib/business/zone-contract';
import { isDirectionalFallbackLabel, selectVisibleZoneChips } from './zone-presentation';

const ARCHETYPE_DISPLAY: Record<ZoneArchetype, { icon: LucideIcon; label: string; tone: string }> =
  {
    luxury: { icon: Gem, label: 'Luxury', tone: 'text-amber-300' },
    corporate: { icon: Building2, label: 'Corporate', tone: 'text-sky-300' },
    mixed: { icon: Shuffle, label: 'Mixed', tone: 'text-violet-300' },
    developing: { icon: TrendingUp, label: 'Developing', tone: 'text-white/45' },
  };

interface ZoneChipsStripProps {
  zones: Zone[];
  focusedZoneId?: string | null;
  rescanningZoneId?: string | null;
  onZoneSelect: (zone: Zone) => void;
}

export function ZoneChipsStrip({
  zones,
  focusedZoneId,
  rescanningZoneId,
  onZoneSelect,
}: ZoneChipsStripProps) {
  const { visibleZones, eligibleTotal } = selectVisibleZoneChips(zones, focusedZoneId);
  const focusedZone = focusedZoneId ? zones.find((zone) => zone.id === focusedZoneId) : undefined;
  const isRescanningAnyZone = rescanningZoneId != null;
  if (visibleZones.length <= 1) return null;

  const activeZone = focusedZone
    ? visibleZones.find((zone) => zone.id === focusedZone.id)
    : undefined;

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
              {visibleZones.length < eligibleTotal
                ? `Showing ${visibleZones.length} of ${eligibleTotal} scanned zones`
                : `${eligibleTotal} zones · tap to jump scan`}
            </div>
          </div>
        </div>
        {activeZone && (
          <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/10 bg-surface-elevated/60 px-2.5 py-1 text-[10px] text-white/60 font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            <span className="uppercase tracking-wider">Viewing</span>
            <span className="text-white">{activeZone.label}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleZones.map((z, i) => {
          const isActive = z.id === focusedZoneId;
          const isRescanning = rescanningZoneId === z.id;
          const isPremium = z.level === 'premium' || z.level === 'commercial';
          const isDirectional = isDirectionalFallbackLabel(z.label);
          const arche = ARCHETYPE_DISPLAY[z.archetype];
          const ArcheIcon = arche.icon;

          return (
            <motion.button
              key={z.id}
              type="button"
              onClick={() => {
                if (isRescanningAnyZone || isActive || isRescanning) return;
                onZoneSelect(z);
              }}
              disabled={isRescanningAnyZone || isActive || isRescanning}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.22 }}
              title={`Wealth ${z.wealthScore} · Business ${z.businessScore}`}
              className={`group relative inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'border-sky-400/80 bg-sky-500/20 text-sky-50 shadow-[0_0_18px_rgba(56,189,248,0.45)]'
                  : isPremium
                    ? 'border-sky-400/40 bg-sky-500/10 text-sky-100/95 hover:border-sky-400/70 hover:bg-sky-500/18 hover:text-sky-50 hover:shadow-[0_0_14px_rgba(56,189,248,0.3)]'
                    : 'border-white/12 bg-white/[0.05] text-white/75 hover:border-white/28 hover:bg-white/[0.09] hover:text-white'
              } ${isRescanning ? 'animate-pulse' : ''} disabled:cursor-not-allowed`}
            >
              {isRescanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MapPin className="h-3.5 w-3.5 opacity-80 group-hover:opacity-100" />
              )}
              <span className={`${isDirectional ? 'italic' : ''}`}>{z.label}</span>
              <span
                className={`inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider ${arche.tone}`}
              >
                <ArcheIcon className="h-2.5 w-2.5" />
                {arche.label}
              </span>
              <span
                className={`inline-flex items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                  isActive ? 'bg-sky-400/20 text-sky-100' : 'bg-white/5 text-white/50'
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
