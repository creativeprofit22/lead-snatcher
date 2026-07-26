import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { SearchResultFilters } from '@/lib/business/derive-search-results';
import type { PersistedSearchPayload, SearchMarketDensity } from '@/lib/business/search-snapshot';
import type { Zone } from '@/lib/business/zone-contract';
import type { BusinessSearchResult, ScoreBreakdown } from '@/types';

import { SearchResultsView, type SearchResultsViewProps } from './SearchResultsView';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/motion-primitives/sliding-number', () => ({
  SlidingNumber: ({ value }: { value: number }) => (
    <span data-testid="animated-count">{value}</span>
  ),
}));

vi.mock('./SearchResultsControls', () => ({
  getLeadResultTier: (score: number) => (score >= 55 ? 'hot' : score >= 35 ? 'mid' : 'cold'),
  SearchResultsControls: ({
    filteredResults,
    totalResults,
    onSortChange,
    onFiltersChange,
    filters,
  }: {
    filteredResults: BusinessSearchResult[];
    totalResults: number;
    onSortChange: (sort: string) => void;
    onFiltersChange: (filters: SearchResultFilters) => void;
    filters: SearchResultFilters;
  }) => (
    <div
      data-testid="results-controls"
      data-filtered={filteredResults.map((result) => result.placeId).join(',')}
      data-total={totalResults}
    >
      <button onClick={() => onSortChange('rating')}>Change sort</button>
      <button onClick={() => onFiltersChange({ ...filters, hasEmail: !filters.hasEmail })}>
        Change filters
      </button>
    </div>
  ),
}));

vi.mock('./SaveSessionButton', () => ({
  SaveSessionButton: ({
    defaultName,
    getPayload,
  }: {
    defaultName: string;
    getPayload: () => PersistedSearchPayload;
  }) => (
    <button
      data-testid="save-session"
      data-default-name={defaultName}
      onClick={(event) => {
        event.currentTarget.dataset.payload = JSON.stringify(getPayload());
      }}
    >
      Save Session
    </button>
  ),
}));

vi.mock('./ZoneChipsStrip', () => ({
  ZoneChipsStrip: ({
    zones,
    disabled,
    onZoneSelect,
  }: {
    zones: Zone[];
    disabled?: boolean;
    onZoneSelect: (zone: Zone) => void;
  }) => (
    <button
      data-testid="zone-strip"
      data-disabled={String(!!disabled)}
      onClick={() => onZoneSelect(zones[1]!)}
    >
      Switch zone
    </button>
  ),
}));

vi.mock('./AreaDensityMeter', () => ({
  AreaDensityMeter: ({
    score,
    focusedZone,
    cityLabel,
    singleZone,
  }: {
    score: number;
    focusedZone?: Zone;
    cityLabel?: string;
    singleZone?: boolean;
  }) => (
    <div
      data-testid="density-meter"
      data-score={score}
      data-zone={focusedZone?.id}
      data-city={cityLabel}
      data-single-zone={String(!!singleZone)}
    />
  ),
}));

vi.mock('@/components/leads/ErrorBanner', () => ({
  ErrorBanner: ({
    message,
    severity,
    action,
    onDismiss,
  }: {
    message: string;
    severity?: string;
    action?: { label: string; href?: string };
    onDismiss: () => void;
  }) => (
    <div
      data-testid={`banner-${message}`}
      data-severity={severity}
      data-action-label={action?.label}
      data-action-href={action?.href}
    >
      <button onClick={onDismiss}>Dismiss {message}</button>
    </div>
  ),
}));

vi.mock('@/components/leads/LeadResultCard', () => ({
  LeadResultCard: ({
    lead,
    rank,
    tier,
    selected,
    enrichmentStatus,
    enrichmentResult,
    saveBusy,
    onToggleSelection,
    onEnrich,
    onRequestEnrichmentExplainer,
    onSave,
  }: {
    lead: BusinessSearchResult;
    rank: number;
    tier: string;
    selected: boolean;
    enrichmentStatus: string;
    enrichmentResult?: { website?: string };
    saveBusy: boolean;
    onToggleSelection: () => void;
    onEnrich: () => void;
    onRequestEnrichmentExplainer: () => boolean;
    onSave: () => void;
  }) => (
    <article
      data-testid={`lead-${lead.placeId}`}
      data-rank={rank}
      data-tier={tier}
      data-selected={String(selected)}
      data-enrichment-status={enrichmentStatus}
      data-enrichment-website={enrichmentResult?.website}
      data-save-busy={String(saveBusy)}
    >
      <button onClick={onToggleSelection}>Toggle {lead.placeId}</button>
      <button onClick={onEnrich}>Enrich {lead.placeId}</button>
      <button onClick={onRequestEnrichmentExplainer}>Explain {lead.placeId}</button>
      <button onClick={onSave}>Save {lead.placeId}</button>
    </article>
  ),
}));

vi.mock('@/components/leads/SaveLeadModal', () => ({
  SaveLeadModal: ({
    isOpen,
    businessName,
    onClose,
    onViewCRM,
  }: {
    isOpen: boolean;
    businessName: string;
    onClose: () => void;
    onViewCRM: () => void;
  }) => (
    <div data-testid="save-lead-modal" data-open={String(isOpen)} data-business-name={businessName}>
      <button onClick={onClose}>Close saved lead</button>
      <button onClick={onViewCRM}>View saved lead</button>
    </div>
  ),
}));

const scoreBreakdown: ScoreBreakdown = {
  noWebsite: 0,
  socialOnlyWebsite: 0,
  noPhone: 0,
  fewPhotos: 0,
  lowReviews: 0,
  hiddenGem: 0,
  poorPerformance: 0,
  notMobileFriendly: 0,
  noHttps: 0,
  outdatedWebsite: 0,
  noOnlineBooking: 0,
  noSocialLinks: 0,
  basicTechStack: 0,
  noViewport: 0,
  tableLayout: 0,
  thinContent: 0,
  deprecatedTags: 0,
  templateFingerprint: 0,
  noForm: 0,
  fixedPixelWidth: 0,
  outdatedJquery: 0,
  noSchemaOrg: 0,
  noOpenGraph: 0,
  noLangAttribute: 0,
  lowAccessibility: 0,
  lowSeo: 0,
  lowBestPractices: 0,
  slowLcp: 0,
  highCls: 0,
  qualityChips: [],
  hasMarketingBudget: false,
  marketingPlatforms: [],
  revenueSignal: 'low',
  revenueLabel: 'Low revenue signal',
  total: 0,
};

function lead(placeId: string, leadScore: number): BusinessSearchResult {
  return {
    placeId,
    name: `Lead ${placeId}`,
    photoCount: 0,
    types: [],
    socialLinks: {},
    contactPoints: 0,
    leadScore,
    scoreBreakdown,
    opportunities: [],
    industryType: 'other',
  };
}

const amenities: Zone['amenities'] = {
  banks: 1,
  hotels: 1,
  hospitals: 1,
  pharmacies: 1,
  supermarkets: 1,
  fuelStations: 1,
  affluenceSpots: 1,
  total: 7,
};

const zones: Zone[] = [
  {
    id: 'central',
    label: 'Central',
    latitude: 1,
    longitude: 2,
    score: 80,
    wealthScore: 80,
    businessScore: 80,
    archetype: 'mixed',
    level: 'commercial',
    amenities,
    radiusMeters: 1000,
    distanceFromCenterMeters: 0,
  },
  {
    id: 'north',
    label: 'North',
    latitude: 2,
    longitude: 3,
    score: 60,
    wealthScore: 60,
    businessScore: 60,
    archetype: 'corporate',
    level: 'moderate',
    amenities,
    radiusMeters: 1000,
    distanceFromCenterMeters: 1000,
  },
];

const rawResults = [lead('raw-only', 40), lead('second', 20), lead('first', 60)];
const filteredResults = [rawResults[2]!, rawResults[1]!];
const filters: SearchResultFilters = {
  hasEmail: false,
  hasPhone: false,
  hasSocial: false,
  hasAds: false,
  minBudget: 0,
};

function createProps(overrides: Partial<SearchResultsViewProps> = {}): SearchResultsViewProps {
  return {
    title: 'Plumbers in Leeds',
    city: 'Leeds',
    animatedResultsCount: 3,
    totalResults: rawResults.length,
    filteredResults,
    sortBy: 'fit',
    filters,
    onSortChange: vi.fn(),
    onFiltersChange: vi.fn(),
    defaultSessionName: 'Plumbers in Leeds',
    getSessionPayload: vi.fn(
      (): PersistedSearchPayload => ({
        version: 2,
        results: rawResults,
        industry: 'other',
        city: 'Leeds',
        country: 'gb',
        timestamp: Date.now(),
      })
    ),
    zones,
    focusedZone: zones[0],
    focusedZoneId: 'central',
    rescanningZoneId: null,
    zoneScanStatus: 'ok',
    marketDensity: null,
    singleZone: false,
    onBack: vi.fn(),
    onZoneSelect: vi.fn(),
    searchBannerError: null,
    onDismissSearchBanner: vi.fn(),
    enrichBannerError: null,
    onDismissEnrichBanner: vi.fn(),
    selectedForEnrich: new Set(),
    enrichStatusMap: {},
    enrichResultMap: {},
    savingLeadIds: new Set(),
    onToggleSelection: vi.fn(),
    onEnrichLead: vi.fn(),
    onRequestEnrichmentExplainer: vi.fn(() => true),
    onSaveLead: vi.fn(),
    savedLeadModal: { isOpen: false, businessName: '' },
    onCloseSavedLeadModal: vi.fn(),
    onViewSavedLeadCRM: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SearchResultsView', () => {
  test('maps filtered order to card rank and tier with placeId-keyed state and callbacks', () => {
    const props = createProps({
      selectedForEnrich: new Set(['second']),
      enrichStatusMap: { first: 'enriching' },
      enrichResultMap: { second: { website: 'https://second.example' } },
      savingLeadIds: new Set(['second']),
    });
    render(<SearchResultsView {...props} />);

    const cards = screen.getAllByRole('article');
    expect(cards.map((card) => card.dataset.testid)).toEqual(['lead-first', 'lead-second']);
    expect(screen.getByTestId('lead-first')).toMatchObject({
      dataset: expect.objectContaining({
        rank: '1',
        tier: 'hot',
        selected: 'false',
        enrichmentStatus: 'enriching',
        saveBusy: 'false',
      }),
    });
    expect(screen.getByTestId('lead-second')).toMatchObject({
      dataset: expect.objectContaining({
        rank: '2',
        tier: 'cold',
        selected: 'true',
        enrichmentStatus: 'idle',
        enrichmentWebsite: 'https://second.example',
        saveBusy: 'true',
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Toggle second' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enrich first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explain second' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save first' }));

    expect(props.onToggleSelection).toHaveBeenCalledWith('second');
    expect(props.onEnrichLead).toHaveBeenCalledWith(filteredResults[0]);
    expect(props.onRequestEnrichmentExplainer).toHaveBeenCalledWith(filteredResults[1]);
    expect(props.onSaveLead).toHaveBeenCalledWith(filteredResults[0]);
  });

  test('delegates back, controls, and zone callbacks and applies rescan disabled styling', () => {
    const props = createProps();
    const { container, rerender } = render(<SearchResultsView {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByTestId('zone-strip'));
    fireEvent.click(screen.getByRole('button', { name: 'Change sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change filters' }));

    expect(props.onBack).toHaveBeenCalledOnce();
    expect(props.onZoneSelect).toHaveBeenCalledWith(zones[1]);
    expect(props.onSortChange).toHaveBeenCalledWith('rating');
    expect(props.onFiltersChange).toHaveBeenCalledWith({ ...filters, hasEmail: true });

    rerender(<SearchResultsView {...props} rescanningZoneId="north" />);
    expect(screen.getByTestId('zone-strip').getAttribute('data-disabled')).toBe('true');
    expect(container.querySelector('.grid')?.className).toContain('pointer-events-none opacity-40');
  });

  test('renders mutually exclusive unavailable and scored density branches', () => {
    const marketDensity: SearchMarketDensity = {
      count: 20,
      level: 'high',
      label: 'Dense market',
      description: 'Density details',
      areaScore: 82,
      amenities,
    };
    const { rerender } = render(
      <SearchResultsView {...createProps({ marketDensity, zoneScanStatus: 'unavailable' })} />
    );

    expect(screen.getByRole('status').textContent).toContain('Market density unavailable');
    expect(screen.getByRole('status').textContent).toContain('Density details');
    expect(screen.queryByTestId('density-meter')).toBeNull();

    rerender(
      <SearchResultsView
        {...createProps({ marketDensity, zoneScanStatus: 'ok', singleZone: true })}
      />
    );
    expect(screen.queryByText('Market density unavailable')).toBeNull();
    expect(screen.getByTestId('density-meter')).toMatchObject({
      dataset: expect.objectContaining({
        score: '82',
        zone: 'central',
        city: 'Leeds',
        singleZone: 'true',
      }),
    });
  });

  test('maps search and enrichment banners to exact severity, action, and dismiss callbacks', () => {
    const props = createProps({
      searchBannerError: { message: 'Search auth', severity: 'error', isAuthError: true },
      enrichBannerError: { message: 'Slow down', kind: 'rate_limited' },
    });
    const { rerender } = render(<SearchResultsView {...props} />);

    expect(screen.getByTestId('banner-Search auth')).toMatchObject({
      dataset: expect.objectContaining({
        severity: 'error',
        actionLabel: 'Log in',
        actionHref: '/login',
      }),
    });
    expect(screen.getByTestId('banner-Slow down')).toMatchObject({
      dataset: expect.objectContaining({ severity: 'warning' }),
    });
    expect(screen.getByTestId('banner-Slow down').dataset.actionLabel).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Search auth' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Slow down' }));
    expect(props.onDismissSearchBanner).toHaveBeenCalledOnce();
    expect(props.onDismissEnrichBanner).toHaveBeenCalledOnce();

    rerender(
      <SearchResultsView
        {...createProps({
          enrichBannerError: { message: 'Session ended', kind: 'session_expired' },
        })}
      />
    );
    expect(screen.getByTestId('banner-Session ended')).toMatchObject({
      dataset: expect.objectContaining({
        severity: 'error',
        actionLabel: 'Log in',
        actionHref: '/login',
      }),
    });
  });

  test('shows raw total while controls use filtered results and lazily requests raw session payload', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const getSessionPayload = vi.fn(
      (): PersistedSearchPayload => ({
        version: 2,
        results: rawResults,
        industry: 'other',
        city: 'Leeds',
        country: 'gb',
        timestamp: Date.now(),
      })
    );
    render(<SearchResultsView {...createProps({ getSessionPayload })} />);

    expect(screen.getByTestId('animated-count').textContent).toBe('3');
    expect(screen.getByTestId('results-controls').getAttribute('data-filtered')).toBe(
      'first,second'
    );
    expect(screen.getByTestId('results-controls').getAttribute('data-total')).toBe('3');
    expect(getSessionPayload).not.toHaveBeenCalled();

    vi.setSystemTime(500);
    fireEvent.click(screen.getByTestId('save-session'));
    const payload = JSON.parse(screen.getByTestId('save-session').dataset.payload ?? '{}') as {
      results: BusinessSearchResult[];
      timestamp: number;
    };
    expect(getSessionPayload).toHaveBeenCalledOnce();
    expect(payload.results.map((result) => result.placeId)).toEqual([
      'raw-only',
      'second',
      'first',
    ]);
    expect(payload.timestamp).toBe(500);
  });

  test('passes modal state and delegates close and CRM callbacks', () => {
    const props = createProps({
      savedLeadModal: { isOpen: true, businessName: 'Lead first' },
    });
    render(<SearchResultsView {...props} />);

    expect(screen.getByTestId('save-lead-modal')).toMatchObject({
      dataset: expect.objectContaining({ open: 'true', businessName: 'Lead first' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close saved lead' }));
    fireEvent.click(screen.getByRole('button', { name: 'View saved lead' }));
    expect(props.onCloseSavedLeadModal).toHaveBeenCalledOnce();
    expect(props.onViewSavedLeadCRM).toHaveBeenCalledOnce();
  });
});
