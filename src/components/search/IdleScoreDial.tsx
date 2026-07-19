'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

/**
 * Floating idle dial — decorative hero visual for the home screen.
 * Never mounts/unmounts with a reveal; everything is continuous:
 *   - Outer ring rotates forever.
 *   - Score number ticks through plausible lead-score values.
 *   - Halo breathes on the same 4.8s cadence as .gauge-halo elsewhere.
 *
 * No real data — this is the "movie poster" for the tool, telegraphing
 * "this thing rates businesses" before the viewer has searched anything.
 */

const SCORE_SEQUENCE = [72, 84, 61, 93, 78, 55, 87, 69, 96, 74, 82, 58];
const FALLBACK_SCORE = 72;

export function getIdleScore(
  scoreIndex: number,
  scores: readonly number[] = SCORE_SEQUENCE
): number {
  return scores[scoreIndex] ?? scores[0] ?? FALLBACK_SCORE;
}

export function IdleScoreDial({
  className = '',
  size = 200,
}: {
  className?: string;
  size?: number;
}) {
  const [scoreIndex, setScoreIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setScoreIndex((i) => (i + 1) % SCORE_SEQUENCE.length), 2200);
    return () => clearInterval(id);
  }, []);

  const score = getIdleScore(scoreIndex);
  const tier = score >= 80 ? 'hot' : score >= 60 ? 'mid' : 'cold';
  const ringColor =
    tier === 'hot'
      ? 'rgba(253, 186, 116, 0.9)'
      : tier === 'mid'
        ? 'rgba(125, 211, 252, 0.9)'
        : 'rgba(148, 163, 184, 0.8)';
  const haloRgb =
    tier === 'hot' ? '253, 186, 116' : tier === 'mid' ? '56, 189, 248' : '148, 163, 184';
  const labelColor =
    tier === 'hot' ? 'text-amber-300' : tier === 'mid' ? 'text-sky-300' : 'text-slate-300';

  // All radii scale proportionally from the 200px reference design so the
  // dial reads the same at hero scale (200) and inline tile scale (~90).
  const SIZE = size;
  const CENTER = SIZE / 2;
  const TICK_INNER = SIZE * 0.4;
  const TICK_OUTER_MAJOR = SIZE * 0.47;
  const TICK_OUTER_MINOR = SIZE * 0.44;
  const ARC_R = SIZE * 0.35;
  const ARC_CIRCUM = 2 * Math.PI * ARC_R;
  const scoreFontPx = Math.round(SIZE * 0.24);
  const labelFontPx = Math.max(Math.round(SIZE * 0.055), 7);
  const showLabel = SIZE >= 130;

  return (
    <div
      className={`gauge-halo pointer-events-none relative select-none ${className}`}
      style={{ ['--halo' as string]: haloRgb }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="drop-shadow-[0_0_26px_rgba(56,189,248,0.25)]"
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={SIZE / 2 - 10}
          fill="none"
          stroke="rgba(148, 163, 184, 0.15)"
          strokeWidth="1"
        />
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
          style={{ originX: `${CENTER}px`, originY: `${CENTER}px` }}
        >
          {Array.from({ length: 36 }).map((_, i) => {
            const angle = (i * 360) / 36;
            const rad = (angle * Math.PI) / 180;
            const outer = i % 3 === 0 ? TICK_OUTER_MAJOR : TICK_OUTER_MINOR;
            // Round to 3dp so SSR and client emit byte-identical strings
            // (prevents a hydration mismatch on otherwise-invisible precision drift).
            const x1 = (CENTER + Math.cos(rad) * TICK_INNER).toFixed(3);
            const y1 = (CENTER + Math.sin(rad) * TICK_INNER).toFixed(3);
            const x2 = (CENTER + Math.cos(rad) * outer).toFixed(3);
            const y2 = (CENTER + Math.sin(rad) * outer).toFixed(3);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="rgba(125, 211, 252, 0.5)"
                strokeWidth={i % 9 === 0 ? 1.8 : 1}
              />
            );
          })}
        </motion.g>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ARC_R}
          fill="none"
          stroke={ringColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * ARC_CIRCUM} ${ARC_CIRCUM}`}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
          style={{ transition: 'stroke-dasharray 1.1s ease-out, stroke 0.6s ease' }}
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-orbitron font-bold tabular-nums leading-none ${labelColor}`}
          style={{ fontSize: `${scoreFontPx}px` }}
        >
          {score}
        </span>
        {showLabel && (
          <span
            className="mt-1 font-mono uppercase tracking-[0.26em] text-white/45"
            style={{ fontSize: `${labelFontPx}px` }}
          >
            Lead Score
          </span>
        )}
      </div>
    </div>
  );
}
