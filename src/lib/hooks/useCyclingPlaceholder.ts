'use client';

import { useEffect, useState } from 'react';

interface Options {
  /** Words/phrases to cycle through, in order. */
  phrases: string[];
  /** ms between each typed character. */
  typeSpeedMs?: number;
  /** ms between each deleted character. */
  deleteSpeedMs?: number;
  /** ms to hold the fully-typed phrase before deleting. */
  holdMs?: number;
  /** Pause typing/deleting while this is true (e.g. input is focused/non-empty). */
  paused?: boolean;
}

/**
 * Terminal-style cycling placeholder: types a phrase, holds, deletes, types the next.
 * Runs continuously with no start/end state — the consumer can freeze it via `paused`
 * when a real value is being entered.
 */
export function useCyclingPlaceholder({
  phrases,
  typeSpeedMs = 55,
  deleteSpeedMs = 28,
  holdMs = 1400,
  paused = false,
}: Options): string {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [display, setDisplay] = useState('');
  const [mode, setMode] = useState<'typing' | 'holding' | 'deleting'>('typing');

  useEffect(() => {
    if (paused || phrases.length === 0) return;
    const current = phrases[phraseIndex % phrases.length];

    if (mode === 'typing') {
      if (display.length < current.length) {
        const t = setTimeout(
          () => setDisplay(current.slice(0, display.length + 1)),
          typeSpeedMs
        );
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setMode('deleting'), holdMs);
      return () => clearTimeout(t);
    }

    if (mode === 'deleting') {
      if (display.length > 0) {
        const t = setTimeout(
          () => setDisplay(current.slice(0, display.length - 1)),
          deleteSpeedMs
        );
        return () => clearTimeout(t);
      }
      // Brief pause before the next phrase starts typing.
      const t = setTimeout(() => {
        setPhraseIndex((i) => (i + 1) % phrases.length);
        setMode('typing');
      }, 240);
      return () => clearTimeout(t);
    }
  }, [display, mode, phraseIndex, phrases, typeSpeedMs, deleteSpeedMs, holdMs, paused]);

  return display;
}
