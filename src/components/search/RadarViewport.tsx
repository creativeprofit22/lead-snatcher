'use client';

import { AnimatePresence, motion } from 'motion/react';
import { TextEffect } from '@/components/motion-primitives/text-effect';
import {
  RADAR_CENTER,
  RADAR_RADIUS,
  RADAR_SIZE,
  type RadarPin,
  type RadarZoneDot,
} from './radar-geometry';
import {
  RADAR_SWEEP_DURATION_MS,
  RADAR_ZOOM_DURATION_MS,
  type RadarScanPhase,
} from './useRadarScanSequence';

interface RadarViewportProps {
  city: string;
  phase: RadarScanPhase;
  bloomedCount: number;
  litPinIds: ReadonlySet<string>;
  pins: readonly RadarPin[];
  zoneDots: readonly RadarZoneDot[];
  focusedZoneId: string | null;
  singleZone?: boolean;
}

const SWEEP_WEDGE_DEG = 30;
const ZOOM_SCALE = 2.2;
const wedgeEndRadians = (-SWEEP_WEDGE_DEG * Math.PI) / 180;
const wedgeEndX = RADAR_CENTER + RADAR_RADIUS * Math.cos(wedgeEndRadians);
const wedgeEndY = RADAR_CENTER + RADAR_RADIUS * Math.sin(wedgeEndRadians);
const ambientPings = Array.from({ length: 14 }, (_, index) => {
  const seed = (index * 9301 + 49297) % 233280;
  const firstRandom = seed / 233280;
  const secondRandom = ((seed * 7) % 1000) / 1000;
  const angle = firstRandom * Math.PI * 2;
  const distance = 0.2 + secondRandom * 0.72;
  return {
    id: `ping-${index}`,
    x: RADAR_CENTER + Math.cos(angle) * RADAR_RADIUS * distance,
    y: RADAR_CENTER + Math.sin(angle) * RADAR_RADIUS * distance,
    delay: (index * 0.17) % 2.4,
  };
});

export function RadarViewport({
  city,
  phase,
  bloomedCount,
  litPinIds,
  pins,
  zoneDots,
  focusedZoneId,
  singleZone,
}: RadarViewportProps) {
  const allPinsLit = pins.length > 0 && litPinIds.size >= pins.length;
  const lockTarget = focusedZoneId
    ? (zoneDots.find((zone) => zone.id === focusedZoneId) ?? null)
    : null;

  const headerLabel = (() => {
    if (phase === 'complete' || allPinsLit) return 'Scan Complete';
    if (phase === 'pins') return 'Acquiring Targets';
    if (phase === 'zooming') return lockTarget ? `Locking On ${lockTarget.label}` : 'Locking On';
    if (phase === 'bloom') {
      const premiumZoneCount = zoneDots.filter((zone) => zone.score >= 50).length;
      return premiumZoneCount > 0
        ? `${premiumZoneCount} Prime Zone${premiumZoneCount === 1 ? '' : 's'} Identified`
        : 'Mapping Zones';
    }
    return singleZone ? 'Scanning Area' : 'Scanning Metropolitan Zone';
  })();

  const lockedView =
    !!lockTarget && (phase === 'zooming' || phase === 'pins' || phase === 'complete');
  const zoomXPercent = lockTarget
    ? ((RADAR_CENTER - lockTarget.x * ZOOM_SCALE) / RADAR_SIZE) * 100
    : 0;
  const zoomYPercent = lockTarget
    ? ((RADAR_CENTER - lockTarget.y * ZOOM_SCALE) / RADAR_SIZE) * 100
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
        <div className="absolute inset-0 overflow-hidden">
          <motion.div
            className="absolute inset-0"
            style={{ transformOrigin: '0 0' }}
            animate={{
              x: lockedView ? `${zoomXPercent}%` : '0%',
              y: lockedView ? `${zoomYPercent}%` : '0%',
              scale: lockedView ? ZOOM_SCALE : 1,
            }}
            transition={{
              duration: RADAR_ZOOM_DURATION_MS / 1000,
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

              {[0.33, 0.66, 1].map((fraction) => (
                <circle
                  key={fraction}
                  cx={RADAR_CENTER}
                  cy={RADAR_CENTER}
                  r={RADAR_RADIUS * fraction}
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

              <g>
                <animateTransform
                  attributeName="transform"
                  attributeType="XML"
                  type="rotate"
                  from={`0 ${RADAR_CENTER} ${RADAR_CENTER}`}
                  to={`360 ${RADAR_CENTER} ${RADAR_CENTER}`}
                  dur={`${RADAR_SWEEP_DURATION_MS / 1000}s`}
                  repeatCount="indefinite"
                />
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
              </g>

              <circle cx={RADAR_CENTER} cy={RADAR_CENTER} r="4" fill="#38bdf8" />
              <circle
                cx={RADAR_CENTER}
                cy={RADAR_CENTER}
                r="10"
                fill="none"
                stroke="#38bdf8"
                strokeOpacity="0.4"
              />
              <circle
                cx={RADAR_CENTER}
                cy={RADAR_CENTER}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1"
              >
                <animate attributeName="r" values="12;22;12" dur="2.2s" repeatCount="indefinite" />
                <animate
                  attributeName="stroke-opacity"
                  values="0.4;0;0.4"
                  dur="2.2s"
                  repeatCount="indefinite"
                />
              </circle>

              {(phase === 'sweep' || phase === 'bloom') &&
                ambientPings.map((ping) => (
                  <circle key={ping.id} cx={ping.x} cy={ping.y} fill="#7dd3fc" r="0" opacity="0">
                    <animate
                      attributeName="r"
                      values="0;2.5;0"
                      dur="2.4s"
                      begin={`${ping.delay}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.6;0"
                      dur="2.4s"
                      begin={`${ping.delay}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                ))}

              {(phase === 'bloom' ||
                phase === 'zooming' ||
                phase === 'pins' ||
                phase === 'complete') &&
                zoneDots.map((zone, index) => {
                  const visible = phase !== 'bloom' || index < bloomedCount;
                  if (!visible) return null;
                  const haloRadius = 10 + (zone.score / 100) * 26;
                  const dotOpacity = 0.35 + (zone.score / 100) * 0.65;
                  const isFocused = zone.id === focusedZoneId;
                  const locked = phase === 'zooming' || phase === 'pins' || phase === 'complete';
                  const groupOpacity = locked
                    ? isFocused
                      ? phase === 'pins' || phase === 'complete'
                        ? 0.55
                        : 1
                      : 0
                    : 1;
                  const bracketRadius = haloRadius + 8;
                  const bracketLength = 5;

                  return (
                    <motion.g
                      key={zone.id}
                      initial={{ opacity: 0, scale: 0.2 }}
                      animate={{ opacity: groupOpacity, scale: 1 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      style={{ transformOrigin: `${zone.x}px ${zone.y}px` }}
                    >
                      <circle cx={zone.x} cy={zone.y} r={haloRadius} fill="url(#zone-halo)" />
                      <circle
                        cx={zone.x}
                        cy={zone.y}
                        r={5}
                        fill="#7dd3fc"
                        fillOpacity={dotOpacity}
                      />
                      <circle cx={zone.x} cy={zone.y} r={3} fill="#e0f2fe" />
                      {isFocused && locked && (
                        <motion.g
                          aria-label={`Radar lock: ${zone.label}`}
                          initial={{ opacity: 0, scale: 0.6 }}
                          animate={{ opacity: 0.9, scale: 1 }}
                          transition={{ duration: 0.3, ease: 'easeOut' }}
                          style={{ transformOrigin: `${zone.x}px ${zone.y}px` }}
                        >
                          <line
                            x1={zone.x - bracketRadius}
                            y1={zone.y - bracketRadius}
                            x2={zone.x - bracketRadius + bracketLength}
                            y2={zone.y - bracketRadius}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                          <line
                            x1={zone.x - bracketRadius}
                            y1={zone.y - bracketRadius}
                            x2={zone.x - bracketRadius}
                            y2={zone.y - bracketRadius + bracketLength}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                          <line
                            x1={zone.x + bracketRadius}
                            y1={zone.y - bracketRadius}
                            x2={zone.x + bracketRadius - bracketLength}
                            y2={zone.y - bracketRadius}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                          <line
                            x1={zone.x + bracketRadius}
                            y1={zone.y - bracketRadius}
                            x2={zone.x + bracketRadius}
                            y2={zone.y - bracketRadius + bracketLength}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                          <line
                            x1={zone.x - bracketRadius}
                            y1={zone.y + bracketRadius}
                            x2={zone.x - bracketRadius + bracketLength}
                            y2={zone.y + bracketRadius}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                          <line
                            x1={zone.x - bracketRadius}
                            y1={zone.y + bracketRadius}
                            x2={zone.x - bracketRadius}
                            y2={zone.y + bracketRadius - bracketLength}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                          <line
                            x1={zone.x + bracketRadius}
                            y1={zone.y + bracketRadius}
                            x2={zone.x + bracketRadius - bracketLength}
                            y2={zone.y + bracketRadius}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                          <line
                            x1={zone.x + bracketRadius}
                            y1={zone.y + bracketRadius}
                            x2={zone.x + bracketRadius}
                            y2={zone.y + bracketRadius - bracketLength}
                            stroke="#7dd3fc"
                            strokeWidth="1.5"
                          />
                        </motion.g>
                      )}
                    </motion.g>
                  );
                })}

              {(phase === 'pins' || phase === 'complete') &&
                pins.map((pin) =>
                  litPinIds.has(pin.key) ? (
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

        {(phase === 'bloom' || phase === 'zooming' || phase === 'pins' || phase === 'complete') &&
          zoneDots.map((zone, index) => {
            if (!zone.labeled) return null;
            const visible = phase !== 'bloom' || index < bloomedCount;
            if (!visible) return null;
            const isFocused = zone.id === focusedZoneId;
            const locked = phase === 'zooming' || phase === 'pins' || phase === 'complete';
            const labelLeft = locked && isFocused ? 50 : (zone.x / RADAR_SIZE) * 100;
            const labelTop = locked && isFocused ? 50 : (zone.y / RADAR_SIZE) * 100;
            const labelOpacity = locked && !isFocused ? 0 : locked ? 0.9 : 1;

            return (
              <motion.div
                key={`${zone.id}-label`}
                initial={{ opacity: 0, y: 6 }}
                animate={{
                  left: `${labelLeft}%`,
                  top: `${labelTop}%`,
                  opacity: labelOpacity,
                  y: 0,
                }}
                transition={{
                  duration: locked ? RADAR_ZOOM_DURATION_MS / 1000 : 0.35,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-center"
                style={{
                  marginTop: '-18px',
                  textShadow: '0 0 6px rgba(8, 18, 38, 0.95), 0 1px 2px rgba(0,0,0,0.9)',
                }}
              >
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
                  <TextEffect as="span" per="word" preset="fade" speedReveal={3}>
                    {zone.label}
                  </TextEffect>
                </div>
                <div className="font-mono text-[10px] text-sky-300/80">
                  <TextEffect as="span" per="word" preset="fade" speedReveal={4} delay={0.15}>
                    {String(zone.score)}
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
              key="pins"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.15 }}
              className="font-mono text-sm uppercase tracking-[0.25em] text-sky-300"
            >
              {litPinIds.size} / {pins.length} targets acquired
            </motion.div>
          )}
          {phase === 'sweep' && (
            <motion.div
              key="sweep"
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
