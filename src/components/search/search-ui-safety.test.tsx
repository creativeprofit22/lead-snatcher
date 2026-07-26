import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Zone } from '@/lib/business/zone-contract';
import { AreaDensityMeter } from './AreaDensityMeter';
import { getIdleScore, IdleScoreDial } from './IdleScoreDial';
import { RadarScan } from './RadarScan';
import type { RadarPin, RadarZoneDot } from './radar-geometry';
import { RegionPicker } from './RegionPicker';
import { ZoneChipsStrip } from './ZoneChipsStrip';
import {
  RADAR_COMPLETE_HOLD_MS,
  RADAR_ZONE_BLOOM_HOLD_MS,
  RADAR_ZONE_STAGGER_MS,
  RADAR_ZOOM_DURATION_MS,
  useRadarScanSequence,
} from './useRadarScanSequence';
import { isDirectionalFallbackLabel, selectVisibleZoneChips } from './zone-presentation';

vi.mock('@/components/animata/gauge-chart', () => ({
  default: ({ progress }: { progress: number }) => <div data-testid="gauge">{progress}</div>,
}));

vi.mock('@/components/motion-primitives/sliding-number', () => ({
  SlidingNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function zone(id: string, score: number): Zone {
  return {
    id,
    label: `Zone ${id}`,
    latitude: 51.5,
    longitude: -0.1,
    score,
    wealthScore: score,
    businessScore: score - 5,
    archetype: 'mixed',
    level: 'commercial',
    amenities: {
      banks: 1,
      hotels: 0,
      hospitals: 0,
      pharmacies: 0,
      supermarkets: 0,
      fuelStations: 0,
      affluenceSpots: 0,
      total: 1,
    },
    radiusMeters: 1_000,
    distanceFromCenterMeters: 500,
  };
}

async function advanceTime(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function runRegionDebounce() {
  await advanceTime(700);
}

function useFakeAnimationFrames() {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16)
  );
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => window.clearTimeout(frame));
}

describe('AreaDensityMeter', () => {
  test('uses the medium palette for unknown and inherited level names', () => {
    render(
      <AreaDensityMeter
        score={50}
        level="toString"
        label="Unclassified"
        description="No known density level was returned."
      />
    );

    expect(screen.getByText('toString density zone').className).toContain('text-amber-400');
    expect(screen.getByTestId('gauge').textContent).toBe('50');
  });
});

describe('IdleScoreDial', () => {
  test('falls back safely when the sequence or index has no score', () => {
    expect(getIdleScore(99, [12, 34])).toBe(12);
    expect(getIdleScore(0, [])).toBe(72);
  });

  test('cycles to the next score on its interval', () => {
    vi.useFakeTimers();
    render(<IdleScoreDial />);

    expect(screen.getByText('72')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_200));
    expect(screen.getByText('84')).toBeTruthy();
  });
});

describe('RegionPicker', () => {
  test('debounces a successful neighborhood response', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        regions: [
          { direction: 'central', label: 'Central', score: 88, zoneCount: 1, topLabel: 'Mayfair' },
          { direction: 'n', label: 'North', score: 65, zoneCount: 1, topLabel: 'Camden' },
        ],
        zones: [],
        singleZone: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<RegionPicker city="London" country="GB" onNeighborhoodSelect={vi.fn()} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Scanning London…')).toBeTruthy();
    await runRegionDebounce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/business/neighborhoods?city=London&country=GB');
    expect(screen.getByText('Browse London by region')).toBeTruthy();
    expect(screen.getByText('Mayfair')).toBeTruthy();
  });

  test('treats a malformed response body as empty data', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => 'not-an-object' })
    );

    const { container } = render(
      <RegionPicker city="London" country="GB" onNeighborhoodSelect={vi.fn()} />
    );
    await runRegionDebounce();

    expect(container.childElementCount).toBe(0);
  });

  test('aborts an in-flight request when the city changes', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        signals.push(init?.signal as AbortSignal);
        return new Promise(() => {});
      })
    );

    const { rerender, unmount } = render(
      <RegionPicker city="London" country="GB" onNeighborhoodSelect={vi.fn()} />
    );
    await runRegionDebounce();
    expect(signals[0]?.aborted).toBe(false);

    rerender(<RegionPicker city="Manchester" country="GB" onNeighborhoodSelect={vi.fn()} />);
    expect(signals[0]?.aborted).toBe(true);

    await runRegionDebounce();
    expect(signals[1]?.aborted).toBe(false);
    unmount();
    expect(signals[1]?.aborted).toBe(true);
  });
});

describe('zone presentation', () => {
  test('recognizes directional fallback labels without hiding named zones', () => {
    expect(isDirectionalFallbackLabel('North')).toBe(true);
    expect(isDirectionalFallbackLabel('SW Quadrant')).toBe(true);
    expect(isDirectionalFallbackLabel('Mayfair')).toBe(false);
  });

  test('selects ranked eligible chips without mutation and replaces the capped rank with focus', () => {
    const zones = Array.from({ length: 8 }, (_, index) => zone(String(index + 1), 100 - index));
    zones.push({ ...zone('zero-score', 0) });
    zones.push({
      ...zone('no-amenities', 110),
      amenities: { ...zone('no-amenities', 110).amenities, total: 0 },
    });
    const originalIds = zones.map(({ id }) => id);

    const selection = selectVisibleZoneChips(zones, '8');

    expect(selection.eligibleTotal).toBe(8);
    expect(selection.visibleZones.map(({ id }) => id)).toEqual(['1', '2', '3', '4', '5', '6', '8']);
    expect(zones.map(({ id }) => id)).toEqual(originalIds);
  });
});

describe('ZoneChipsStrip', () => {
  test.each([{ zones: [] }, { zones: [zone('only', 70)] }])(
    'renders nothing for zero or one ranked zones',
    ({ zones }) => {
      const { container } = render(<ZoneChipsStrip zones={zones} onZoneSelect={vi.fn()} />);

      expect(container.childElementCount).toBe(0);
    }
  );

  test('honors a second-ranked authoritative focus and selects the top zone', () => {
    const onZoneSelect = vi.fn();
    render(
      <ZoneChipsStrip
        zones={[zone('second', 40), zone('top', 90)]}
        focusedZoneId="second"
        onZoneSelect={onZoneSelect}
      />
    );

    expect(screen.getByText('2 zones · tap to jump scan')).toBeTruthy();
    expect(screen.getByText('Viewing').parentElement?.textContent).toContain('Zone second');
    expect(
      (screen.getByRole('button', { name: /Zone second/i }) as HTMLButtonElement).disabled
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Zone top/i }));
    expect(onZoneSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'top' }));
  });

  test('keeps an eighth-ranked authoritative focus inside the seven-chip limit', () => {
    const zones = Array.from({ length: 8 }, (_, index) => zone(String(index + 1), 100 - index));

    render(<ZoneChipsStrip zones={zones} focusedZoneId="8" onZoneSelect={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect((screen.getByRole('button', { name: /Zone 8/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.queryByRole('button', { name: /Zone 7/i })).toBeNull();
    expect(screen.getByText('Viewing').parentElement?.textContent).toContain('Zone 8');
    expect(screen.getByText('Showing 7 of 8 scanned zones')).toBeTruthy();
  });

  test('derives global disabled behavior from the rescanning zone ID', () => {
    const onZoneSelect = vi.fn();
    const zones = [zone('focused', 90), zone('rescanning', 80), zone('available', 70)];
    const { rerender } = render(
      <ZoneChipsStrip
        zones={zones}
        focusedZoneId="focused"
        rescanningZoneId="rescanning"
        onZoneSelect={onZoneSelect}
      />
    );

    expect(
      (screen.getByRole('button', { name: /Zone rescanning/i }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /Zone available/i }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Zone available/i }));
    expect(onZoneSelect).not.toHaveBeenCalled();

    rerender(<ZoneChipsStrip zones={zones} focusedZoneId="focused" onZoneSelect={onZoneSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Zone available/i }));
    expect(onZoneSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'available' }));
  });
});

describe('useRadarScanSequence', () => {
  const pin: RadarPin = { key: 'pin-1', x: 300, y: 250, angle: 180 };
  const zoneDot: RadarZoneDot = {
    id: 'zone-1',
    label: 'Zone 1',
    score: 80,
    labeled: true,
    x: 250,
    y: 250,
  };

  test('keeps pending input in the sweep phase without completing', async () => {
    useFakeAnimationFrames();
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useRadarScanSequence({
        sequenceKey: 'pending',
        resultsPending: true,
        zoneDots: [],
        pins: [],
        onComplete,
      })
    );

    await advanceTime(10_000);

    expect(result.current.phase).toBe('sweep');
    expect(onComplete).not.toHaveBeenCalled();
  });

  test('completes settled empty input once after the completion hold', async () => {
    useFakeAnimationFrames();
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useRadarScanSequence({
        sequenceKey: 'empty',
        resultsPending: false,
        zoneDots: [],
        pins: [],
        onComplete,
      })
    );

    await advanceTime(0);
    expect(result.current.phase).toBe('complete');
    await advanceTime(RADAR_COMPLETE_HOLD_MS - 1);
    expect(onComplete).not.toHaveBeenCalled();
    await advanceTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    await advanceTime(RADAR_COMPLETE_HOLD_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('skips directly to pins when settled results have no zones', async () => {
    useFakeAnimationFrames();
    const { result } = renderHook(() =>
      useRadarScanSequence({
        sequenceKey: 'no-zones',
        resultsPending: false,
        zoneDots: [],
        pins: [pin],
      })
    );

    await advanceTime(0);
    expect(result.current.phase).toBe('pins');
    expect(result.current.bloomedCount).toBe(0);
  });

  test('orders bloom, zoom, pin reveal, and completion', async () => {
    useFakeAnimationFrames();
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useRadarScanSequence({
        sequenceKey: 'full',
        resultsPending: false,
        zoneDots: [zoneDot],
        pins: [pin],
        onComplete,
      })
    );
    const bloomDuration = RADAR_ZONE_STAGGER_MS + RADAR_ZONE_BLOOM_HOLD_MS;

    await advanceTime(0);
    expect(result.current.phase).toBe('bloom');
    await advanceTime(bloomDuration - 1);
    expect(result.current.phase).toBe('bloom');
    expect(result.current.bloomedCount).toBe(1);
    await advanceTime(1);
    expect(result.current.phase).toBe('zooming');
    await advanceTime(RADAR_ZOOM_DURATION_MS);
    expect(result.current.phase).toBe('pins');
    await advanceTime(16);
    expect(result.current.phase).toBe('complete');
    expect(result.current.litPinIds.has(pin.key)).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    await advanceTime(RADAR_COMPLETE_HOLD_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('clears the completion hold when unmounted', async () => {
    useFakeAnimationFrames();
    const onComplete = vi.fn();
    const quickPin = { ...pin, angle: 1 };
    const { result, unmount } = renderHook(() =>
      useRadarScanSequence({
        sequenceKey: 'unmount',
        resultsPending: false,
        zoneDots: [],
        pins: [quickPin],
        onComplete,
      })
    );

    await advanceTime(0);
    await advanceTime(16);
    expect(result.current.phase).toBe('complete');
    unmount();
    await advanceTime(RADAR_COMPLETE_HOLD_MS);

    expect(onComplete).not.toHaveBeenCalled();
  });

  test('resets state and cancels stale completion when input is replaced', async () => {
    useFakeAnimationFrames();
    const onComplete = vi.fn();
    const quickPin = { ...pin, angle: 1 };
    const { result, rerender } = renderHook(
      ({
        sequenceKey,
        resultsPending,
        pins,
      }: {
        sequenceKey: string;
        resultsPending: boolean;
        pins: RadarPin[];
      }) =>
        useRadarScanSequence({
          sequenceKey,
          resultsPending,
          zoneDots: [],
          pins,
          onComplete,
        }),
      { initialProps: { sequenceKey: 'first', resultsPending: false, pins: [quickPin] } }
    );

    await advanceTime(0);
    await advanceTime(16);
    expect(result.current.phase).toBe('complete');

    rerender({ sequenceKey: 'replacement-pending', resultsPending: true, pins: [] });
    await advanceTime(0);
    expect(result.current.phase).toBe('sweep');
    expect(result.current.litPinIds.size).toBe(0);
    await advanceTime(RADAR_COMPLETE_HOLD_MS);
    expect(onComplete).not.toHaveBeenCalled();

    rerender({ sequenceKey: 'replacement-empty', resultsPending: false, pins: [] });
    await advanceTime(0);
    expect(result.current.phase).toBe('complete');
    await advanceTime(RADAR_COMPLETE_HOLD_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('RadarScan', () => {
  test('completes a settled empty result set through the real coordinator', async () => {
    useFakeAnimationFrames();
    const onComplete = vi.fn();
    render(
      <RadarScan city="York" results={[]} zones={[]} focusedZoneId={null} onComplete={onComplete} />
    );

    await advanceTime(1);
    expect(onComplete).not.toHaveBeenCalled();
    await advanceTime(RADAR_COMPLETE_HOLD_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test('locks and labels the authoritative focus when it ranks second by score', async () => {
    vi.useFakeTimers();
    render(
      <RadarScan
        city="London"
        results={null}
        zones={[zone('top', 90), zone('second', 70)]}
        zoneBbox={[51, 52, -1, 0]}
        focusedZoneId="second"
      />
    );

    await advanceTime(0);
    await advanceTime(1_300);

    expect(screen.getByLabelText('Radar lock: Zone second')).toBeTruthy();
    expect(screen.queryByLabelText('Radar lock: Zone top')).toBeNull();
  });
});
