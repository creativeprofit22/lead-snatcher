import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Zone } from '@/lib/business/zone-grid';
import { AreaDensityMeter } from './AreaDensityMeter';
import { getIdleScore, IdleScoreDial } from './IdleScoreDial';
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

  test('ranks multiple zones, falls back to the top zone, and selects another', () => {
    const onZoneSelect = vi.fn();
    render(
      <ZoneChipsStrip
        zones={[zone('low', 40), zone('high', 90)]}
        focusedZoneId="missing"
        onZoneSelect={onZoneSelect}
      />
    );

    expect(screen.getByText('2 zones · tap to jump scan')).toBeTruthy();
    expect(screen.getByText('Viewing').parentElement?.textContent).toContain('Zone high');
    expect((screen.getByRole('button', { name: /Zone high/i }) as HTMLButtonElement).disabled).toBe(
      true
    );

    fireEvent.click(screen.getByRole('button', { name: /Zone low/i }));
    expect(onZoneSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'low' }));
  });
});
