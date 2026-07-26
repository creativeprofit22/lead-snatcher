'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { crossedAngle, type RadarPin, type RadarZoneDot } from './radar-geometry';

export const RADAR_SWEEP_DURATION_MS = 2_400;
export const RADAR_BULK_DROP_AFTER_MS = 3_200;
export const RADAR_COMPLETE_HOLD_MS = 700;
export const RADAR_ZONE_STAGGER_MS = 90;
export const RADAR_ZONE_BLOOM_HOLD_MS = 1_100;
export const RADAR_ZOOM_DURATION_MS = 900;

export type RadarScanPhase = 'sweep' | 'bloom' | 'zooming' | 'pins' | 'complete';

interface UseRadarScanSequenceOptions {
  sequenceKey: string;
  resultsPending: boolean;
  zoneDots: readonly RadarZoneDot[];
  pins: readonly RadarPin[];
  onComplete?: () => void;
}

interface RadarScanSequence {
  phase: RadarScanPhase;
  bloomedCount: number;
  litPinIds: ReadonlySet<string>;
}

export function useRadarScanSequence({
  sequenceKey,
  resultsPending,
  zoneDots,
  pins,
  onComplete,
}: UseRadarScanSequenceOptions): RadarScanSequence {
  const [phase, setPhase] = useState<RadarScanPhase>('sweep');
  const [bloomedCount, setBloomedCount] = useState(0);
  const [litPinIds, setLitPinIds] = useState<Set<string>>(() => new Set());
  const zoneCount = zoneDots.length;

  const onCompleteRef = useRef(onComplete);
  const litPinIdsRef = useRef<Set<string>>(new Set());
  const sequenceStartRef = useRef(0);
  const pinRevealStartRef = useRef<number | null>(null);
  const lastSweepAngleRef = useRef(0);
  const completedRef = useRef(false);
  const timersRef = useRef<Set<number>>(new Set());
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const clearScheduledWork = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const scheduleTimeout = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const completeSequence = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setPhase('complete');
    scheduleTimeout(() => onCompleteRef.current?.(), RADAR_COMPLETE_HOLD_MS);
  }, [scheduleTimeout]);

  useEffect(() => {
    clearScheduledWork();
    sequenceStartRef.current = performance.now();
    pinRevealStartRef.current = null;
    lastSweepAngleRef.current = 0;
    completedRef.current = false;
    litPinIdsRef.current = new Set();
    scheduleTimeout(() => {
      setLitPinIds(new Set());
      setBloomedCount(0);
      setPhase('sweep');
    }, 0);

    return clearScheduledWork;
  }, [clearScheduledWork, scheduleTimeout, sequenceKey]);

  useEffect(() => {
    if (phase !== 'sweep') return;

    if (zoneCount > 0) {
      scheduleTimeout(() => setPhase('bloom'), 0);
      return;
    }
    if (resultsPending) return;
    if (pins.length > 0) {
      scheduleTimeout(() => {
        pinRevealStartRef.current = performance.now();
        setPhase('pins');
      }, 0);
      return;
    }
    scheduleTimeout(completeSequence, 0);
  }, [completeSequence, phase, pins.length, resultsPending, scheduleTimeout, zoneCount]);

  useEffect(() => {
    if (phase !== 'bloom' || zoneCount === 0) return;

    for (let index = 0; index < zoneCount; index += 1) {
      scheduleTimeout(() => {
        setBloomedCount((current) => Math.max(current, index + 1));
      }, index * RADAR_ZONE_STAGGER_MS);
    }

    scheduleTimeout(
      () => setPhase('zooming'),
      zoneCount * RADAR_ZONE_STAGGER_MS + RADAR_ZONE_BLOOM_HOLD_MS
    );
  }, [phase, scheduleTimeout, zoneCount]);

  useEffect(() => {
    if (phase !== 'zooming') return;

    scheduleTimeout(() => {
      pinRevealStartRef.current = performance.now();
      setPhase('pins');
    }, RADAR_ZOOM_DURATION_MS);
  }, [phase, scheduleTimeout]);

  useEffect(() => {
    if (phase !== 'pins' || completedRef.current) return;
    if (pins.length === 0) {
      if (!resultsPending) scheduleTimeout(completeSequence, 0);
      return;
    }

    const revealPins = () => {
      const now = performance.now();
      const elapsed = now - sequenceStartRef.current;
      const currentAngle = ((elapsed / RADAR_SWEEP_DURATION_MS) * 360) % 360;
      const previousAngle = lastSweepAngleRef.current;
      let changed = false;

      pins.forEach((pin) => {
        if (litPinIdsRef.current.has(pin.key)) return;
        if (crossedAngle(previousAngle, currentAngle, pin.angle)) {
          litPinIdsRef.current.add(pin.key);
          changed = true;
        }
      });

      const revealStart = pinRevealStartRef.current ?? now;
      if (now - revealStart > RADAR_BULK_DROP_AFTER_MS) {
        pins.forEach((pin) => {
          if (!litPinIdsRef.current.has(pin.key)) {
            litPinIdsRef.current.add(pin.key);
            changed = true;
          }
        });
      }

      if (changed) setLitPinIds(new Set(litPinIdsRef.current));
      lastSweepAngleRef.current = currentAngle;

      if (litPinIdsRef.current.size >= pins.length) {
        animationFrameRef.current = null;
        completeSequence();
        return;
      }

      animationFrameRef.current = requestAnimationFrame(revealPins);
    };

    animationFrameRef.current = requestAnimationFrame(revealPins);
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [completeSequence, phase, pins, resultsPending, scheduleTimeout]);

  return { phase, bloomedCount, litPinIds };
}
