import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { SearchResultFilters } from '@/lib/business/derive-search-results';
import type { BusinessSearchResult, ScoreBreakdown } from '@/types';

import { SearchResultsControls } from './SearchResultsControls';

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

const filters: SearchResultFilters = {
  hasEmail: true,
  hasPhone: false,
  hasSocial: true,
  hasAds: false,
  minBudget: 1500,
};

function lead(leadScore: number): BusinessSearchResult {
  return {
    placeId: String(leadScore),
    name: String(leadScore),
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

function renderControls({
  filteredResults = [lead(34), lead(35), lead(54), lead(55)],
  totalResults = 7,
}: {
  filteredResults?: BusinessSearchResult[];
  totalResults?: number;
} = {}) {
  const onSortChange = vi.fn();
  const onFiltersChange = vi.fn();
  const view = render(
    <SearchResultsControls
      sortBy="score"
      filters={filters}
      filteredResults={filteredResults}
      totalResults={totalResults}
      onSortChange={onSortChange}
      onFiltersChange={onFiltersChange}
    />
  );

  return { ...view, onSortChange, onFiltersChange };
}

afterEach(cleanup);

describe('SearchResultsControls', () => {
  test('renders controlled values and exact sort and budget options', () => {
    renderControls();
    const [sortSelect, budgetSelect] = screen.getAllByRole('combobox') as HTMLSelectElement[];

    expect(sortSelect?.value).toBe('score');
    expect(Array.from(sortSelect?.options ?? [], (option) => [option.value, option.text])).toEqual([
      ['fit', 'Best Fit'],
      ['score', 'Lead Score'],
      ['contactPoints', 'Contact Points'],
      ['reviews', 'Reviews'],
      ['rating', 'Rating'],
    ]);
    expect(budgetSelect?.value).toBe('1500');
    expect(
      Array.from(budgetSelect?.options ?? [], (option) => [option.value, option.text])
    ).toEqual([
      ['0', 'Any Budget'],
      ['500', '$500+'],
      ['1500', '$1.5K+'],
      ['3000', '$3K+'],
      ['5000', '$5K+'],
    ]);
    for (const label of ['Has Email', 'Has Social']) {
      expect(screen.getByRole('button', { name: label }).className).toContain(
        'filter-toggle-active'
      );
    }
    for (const label of ['Has Phone', 'Runs Ads']) {
      expect(screen.getByRole('button', { name: label }).className).not.toContain(
        'filter-toggle-active'
      );
    }
  });

  test('reports every controlled sort, toggle, and numeric budget change', () => {
    const { onSortChange, onFiltersChange } = renderControls();
    const [sortSelect, budgetSelect] = screen.getAllByRole('combobox');

    fireEvent.change(sortSelect!, { target: { value: 'rating' } });
    expect(onSortChange).toHaveBeenCalledWith('rating');

    const toggleCases = [
      ['Has Email', { ...filters, hasEmail: false }],
      ['Has Phone', { ...filters, hasPhone: true }],
      ['Has Social', { ...filters, hasSocial: false }],
      ['Runs Ads', { ...filters, hasAds: true }],
    ] as const;
    for (const [label, expected] of toggleCases) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onFiltersChange).toHaveBeenLastCalledWith(expected);
    }

    fireEvent.change(budgetSelect!, { target: { value: '3000' } });
    expect(onFiltersChange).toHaveBeenLastCalledWith({ ...filters, minBudget: 3000 });
    expect(onFiltersChange).toHaveBeenCalledTimes(5);
  });

  test('uses the exact tier boundaries for counts and shown/total output', () => {
    const { container } = renderControls();
    const readout = container.querySelector('.tier-readout');

    expect(readout?.querySelector('.text-orange-300 .tabular-nums')?.textContent).toBe('1');
    expect(readout?.querySelector('.text-sky-300 .tabular-nums')?.textContent).toBe('2');
    expect(readout?.querySelector('.text-slate-400 .tabular-nums')?.textContent).toBe('1');
    expect(readout?.querySelector(':scope > span:last-child')?.textContent).toBe('4/7');
  });

  test('renders zero tier counts and zero shown results', () => {
    const { container } = renderControls({ filteredResults: [] });
    const readout = container.querySelector('.tier-readout');

    expect(readout?.querySelector('.text-orange-300 .tabular-nums')?.textContent).toBe('0');
    expect(readout?.querySelector('.text-sky-300 .tabular-nums')?.textContent).toBe('0');
    expect(readout?.querySelector('.text-slate-400 .tabular-nums')?.textContent).toBe('0');
    expect(readout?.querySelector(':scope > span:last-child')?.textContent).toBe('0/7');
  });
});
