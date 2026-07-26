import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
} from '@/lib/business/search-snapshot';
import type { SearchSessionPayload } from '@/lib/business/search-session-client';
import type { EnrichmentResult } from '@/lib/hooks/useEnrichmentStream';
import type { EnrichmentStatus } from '@/components/leads/EnrichButton';

const sessionHarness = vi.hoisted(() => ({
  resumePayload: null as SearchSessionPayload | null,
  loadSavedSession: null as ((payload: SearchSessionPayload) => void) | null,
  persistEnrichment: vi.fn(),
  runSearch: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/business/run-business-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/business/run-business-search')>();
  return { ...actual, runBusinessSearch: sessionHarness.runSearch };
});

vi.mock('@/components/preloader', () => ({ PreLoader: () => null }));
vi.mock('@/components/settings', () => ({ SettingsModal: () => null }));
vi.mock('@/components/auth', () => ({ UserMenu: () => null }));
vi.mock('@/components/leads/BatchEnrichBar', () => ({ BatchEnrichBar: () => null }));
vi.mock('@/components/leads/EnrichmentExplainer', () => ({
  EnrichmentExplainer: () => null,
  shouldShowExplainer: () => false,
}));

vi.mock('@/lib/hooks/useEnrichmentStream', async () => {
  const React = await import('react');
  return {
    useEnrichmentStream: () => {
      const [statusMap, setStatusMap] = React.useState<Record<string, EnrichmentStatus>>({});
      const [resultMap, setResultMap] = React.useState<Record<string, EnrichmentResult>>({});
      const replaceSession = React.useCallback(
        (
          status: Record<string, EnrichmentStatus> | undefined,
          result: Record<string, EnrichmentResult> | undefined
        ) => {
          setStatusMap(status ?? {});
          setResultMap(result ?? {});
        },
        []
      );
      return {
        statusMap,
        resultMap,
        enrichLeads: vi.fn().mockResolvedValue(undefined),
        hydrate: vi.fn(),
        replaceSession,
        bannerError: null,
        clearBannerError: vi.fn(),
      };
    },
  };
});

vi.mock('@/lib/business/search-session-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/business/search-session-client')>();
  return {
    ...actual,
    useSearchSessionPersistence: ({
      onReplaceSession,
    }: {
      onReplaceSession: (payload: SearchSessionPayload) => void;
    }) => {
      sessionHarness.loadSavedSession = onReplaceSession;
      const payload = sessionHarness.resumePayload;
      return {
        resumeCard: payload
          ? {
              businessType: payload.businessType,
              city: payload.city,
              country: payload.country,
              resultCount: payload.results.length,
              updatedAt: new Date(payload.timestamp).toISOString(),
              payload,
            }
          : null,
        resumeDismissed: false,
        resumeLastSearch: () => payload && onReplaceSession(payload),
        loadSavedSession: onReplaceSession,
        dismissResume: vi.fn(),
        persistSearch: vi.fn(),
        persistEnrichment: sessionHarness.persistEnrichment,
      };
    },
  };
});

vi.mock('@/components/search', () => ({
  WelcomeHeader: () => null,
  formatLocationSelection: (location: { cityQuery: string; neighborhoodLabel: string | null }) =>
    location.neighborhoodLabel
      ? `${location.neighborhoodLabel}, ${location.cityQuery}`
      : location.cityQuery,
  CityInput: ({
    location,
    onLocationChange,
    onSearch,
  }: {
    location: { cityQuery: string; neighborhoodLabel: string | null };
    onLocationChange: (location: { cityQuery: string; neighborhoodLabel: string | null }) => void;
    onSearch: () => void;
  }) => (
    <div>
      <input
        aria-label="City"
        value={
          location.neighborhoodLabel
            ? `${location.neighborhoodLabel}, ${location.cityQuery}`
            : location.cityQuery
        }
        onChange={(event) =>
          onLocationChange({ cityQuery: event.currentTarget.value, neighborhoodLabel: null })
        }
      />
      <button onClick={onSearch}>Search now</button>
    </div>
  ),
  RadarScan: ({ onComplete }: { onComplete: () => void }) => (
    <button onClick={onComplete}>Complete radar</button>
  ),
  ActivityTicker: () => null,
  SavedSessionsPanel: () => null,
  BusinessTypeSelector: ({
    selected,
    onSelect,
    customIndustry,
  }: {
    selected: string | null;
    onSelect: (industry: 'retail') => void;
    customIndustry: string;
  }) => (
    <div
      data-testid="business-type-selector"
      data-selected={selected ?? ''}
      data-custom={customIndustry}
    >
      <button onClick={() => onSelect('retail')}>Choose retail</button>
    </div>
  ),
  ResumeSearchCard: ({
    businessType,
    onResume,
  }: {
    businessType: string;
    onResume: () => void;
  }) => <button onClick={onResume}>Resume {businessType}</button>,
  SearchResultsView: ({
    title,
    getSessionPayload,
    onBack,
    enrichStatusMap,
    enrichResultMap,
    selectedForEnrich,
  }: {
    title: string;
    getSessionPayload: () => PersistedSearchPayload;
    onBack: () => void;
    enrichStatusMap: Record<string, EnrichmentStatus>;
    enrichResultMap: Record<string, EnrichmentResult>;
    selectedForEnrich: Set<string>;
  }) => (
    <div>
      <h1>{title}</h1>
      <output
        data-testid="browser-session-state"
        data-status={JSON.stringify(enrichStatusMap)}
        data-result={JSON.stringify(enrichResultMap)}
        data-selected={JSON.stringify(Array.from(selectedForEnrich))}
      />
      <button
        data-testid="save-session-payload"
        onClick={(event) => {
          event.currentTarget.dataset.payload = JSON.stringify(getSessionPayload());
        }}
      >
        Save session
      </button>
      <button onClick={onBack}>Back to search</button>
    </div>
  ),
}));

import Home from './page';

function payload(overrides: Partial<SearchSessionPayload>): SearchSessionPayload {
  return {
    version: SEARCH_SNAPSHOT_VERSION,
    results: [],
    businessType: 'retail',
    industry: 'retail',
    city: 'Leeds',
    country: 'gb',
    timestamp: 1_725_000_123_456,
    zones: [],
    ...overrides,
  };
}

function expectBrowserSessionState(
  status: Record<string, EnrichmentStatus>,
  result: Record<string, EnrichmentResult>,
  selected: string[]
): void {
  const output = screen.getByTestId('browser-session-state');
  expect(JSON.parse(output.dataset.status ?? '{}')).toEqual(status);
  expect(JSON.parse(output.dataset.result ?? '{}')).toEqual(result);
  expect(JSON.parse(output.dataset.selected ?? '[]')).toEqual(selected);
}

beforeEach(() => {
  sessionHarness.resumePayload = null;
  sessionHarness.loadSavedSession = null;
  sessionHarness.persistEnrichment.mockClear();
  sessionHarness.runSearch.mockReset();
});

afterEach(() => cleanup());

describe('home search session identity', () => {
  test('does not patch enrichment cache while mounting the empty search view', () => {
    render(<Home />);

    expect(sessionHarness.persistEnrichment).not.toHaveBeenCalled();
  });

  test('auto-resumes a custom query and keeps it in the named-session payload', () => {
    sessionHarness.resumePayload = payload({
      businessType: 'HVAC contractors',
      industry: 'other',
      city: 'Austin',
      country: 'us',
    });
    render(<Home />);

    fireEvent.click(screen.getByRole('button', { name: 'Resume HVAC contractors' }));

    expect(screen.getByRole('heading', { name: 'HVAC contractors in Austin' })).toBeTruthy();
    const saveButton = screen.getByTestId('save-session-payload');
    fireEvent.click(saveButton);
    expect(JSON.parse(saveButton.dataset.payload ?? '{}')).toMatchObject({
      businessType: 'HVAC contractors',
      industry: 'other',
      city: 'Austin',
      country: 'us',
    });
  });

  test('loading an enum session after a custom session clears the stale custom query', () => {
    render(<Home />);
    const load = sessionHarness.loadSavedSession;
    if (!load) throw new Error('Expected the saved-session load callback');

    act(() =>
      load(
        payload({
          businessType: 'HVAC contractors',
          industry: 'other',
          city: 'Austin',
          country: 'us',
        })
      )
    );
    expect(screen.getByRole('heading', { name: 'HVAC contractors in Austin' })).toBeTruthy();

    act(() => load(payload({})));
    expect(screen.getByRole('heading', { name: 'Retail Store in Leeds' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to search' }));
    expect(screen.getByTestId('business-type-selector')).toMatchObject({
      dataset: expect.objectContaining({ selected: '', custom: '' }),
    });
  });

  test('A to B with absent browser state clears enrichment and selection', () => {
    render(<Home />);
    const load = sessionHarness.loadSavedSession;
    if (!load) throw new Error('Expected the saved-session load callback');

    act(() =>
      load(
        payload({
          enrichStatusMap: { shared: 'enriched' },
          enrichResultMap: { shared: { website: 'https://a.example' } },
          selectedForEnrich: ['shared'],
        })
      )
    );
    expectBrowserSessionState(
      { shared: 'enriched' },
      { shared: { website: 'https://a.example' } },
      ['shared']
    );

    act(() => load(payload({ city: 'York' })));
    expectBrowserSessionState({}, {}, []);
  });

  test('explicit empty browser state replaces populated A state', () => {
    render(<Home />);
    const load = sessionHarness.loadSavedSession;
    if (!load) throw new Error('Expected the saved-session load callback');

    act(() =>
      load(
        payload({
          enrichStatusMap: { a: 'error' },
          enrichResultMap: { a: { error: 'failed' } },
          selectedForEnrich: ['a'],
        })
      )
    );
    act(() =>
      load(
        payload({
          city: 'York',
          enrichStatusMap: {},
          enrichResultMap: {},
          selectedForEnrich: [],
        })
      )
    );

    expectBrowserSessionState({}, {}, []);
  });

  test('fresh search after Back commits a clean browser session', async () => {
    const freshSnapshot = payload({
      businessType: 'retail',
      industry: 'retail',
      city: 'Bristol',
      country: 'gb',
    });
    sessionHarness.runSearch.mockResolvedValue({
      results: [],
      marketDensity: null,
      zoneScanStatus: 'ok',
      zones: [],
      zoneBbox: null,
      singleZone: true,
      focusedZoneId: null,
      cachePayload: freshSnapshot,
      notification: { type: 'success', message: 'Found businesses' },
      shouldReveal: true,
      shouldPersist: true,
    });
    render(<Home />);
    const load = sessionHarness.loadSavedSession;
    if (!load) throw new Error('Expected the saved-session load callback');

    act(() =>
      load(
        payload({
          businessType: 'HVAC contractors',
          industry: 'other',
          enrichStatusMap: { stale: 'enriched' },
          enrichResultMap: { stale: { website: 'https://stale.example' } },
          selectedForEnrich: ['stale'],
        })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to search' }));
    expect(screen.getByTestId('business-type-selector')).toMatchObject({
      dataset: expect.objectContaining({ selected: '', custom: '' }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Choose retail' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), {
      target: { value: 'Bristol' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search now' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Complete radar' })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete radar' }));

    expect(screen.getByRole('heading', { name: 'Retail Store in Bristol' })).toBeTruthy();
    expectBrowserSessionState({}, {}, []);
  });

  test('incoming populated state replaces overlapping place IDs instead of merging', () => {
    render(<Home />);
    const load = sessionHarness.loadSavedSession;
    if (!load) throw new Error('Expected the saved-session load callback');

    act(() =>
      load(
        payload({
          enrichStatusMap: { shared: 'error', onlyA: 'enriched' },
          enrichResultMap: {
            shared: { website: 'https://a.example' },
            onlyA: { website: 'https://only-a.example' },
          },
          selectedForEnrich: ['onlyA'],
        })
      )
    );
    act(() =>
      load(
        payload({
          city: 'York',
          enrichStatusMap: { shared: 'enriched', onlyB: 'rate_limited' },
          enrichResultMap: {
            shared: { website: 'https://b.example' },
            onlyB: { error: 'slow down' },
          },
          selectedForEnrich: ['shared'],
        })
      )
    );

    expectBrowserSessionState(
      { shared: 'enriched', onlyB: 'rate_limited' },
      {
        shared: { website: 'https://b.example' },
        onlyB: { error: 'slow down' },
      },
      ['shared']
    );
  });
});
