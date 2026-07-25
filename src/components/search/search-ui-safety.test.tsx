import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Zone } from '@/lib/business/zone-contract';
import { AreaDensityMeter } from './AreaDensityMeter';
import { getIdleScore, IdleScoreDial } from './IdleScoreDial';
import { RadarScan } from './RadarScan';
import { RegionPicker } from './RegionPicker';
import { ZoneChipsStrip } from './ZoneChipsStrip';

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

async function runRegionDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
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
  });
});

describe('RadarScan', () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_300);
    });

    expect(screen.getByLabelText('Radar lock: Zone second')).toBeTruthy();
    expect(screen.queryByLabelText('Radar lock: Zone top')).toBeNull();
  });
});
