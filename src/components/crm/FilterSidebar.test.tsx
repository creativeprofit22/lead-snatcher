import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  defaultLeadListQuery,
  encodeLeadListQuery,
  parseLeadListQuery,
  type LeadListFilters,
} from '@/lib/crm-lead-query';

import { FilterSidebar } from './FilterSidebar';

const tagCatalog = {
  tags: [],
  loading: false,
  error: null,
  refetch: vi.fn().mockResolvedValue(undefined),
};

function renderScoreFilters(filters: LeadListFilters = defaultLeadListQuery) {
  const onFiltersChange = vi.fn();

  render(
    <FilterSidebar
      filters={filters}
      onFiltersChange={onFiltersChange}
      isOpen={false}
      onClose={vi.fn()}
      leadCount={0}
      tagCatalog={tagCatalog}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lead Score' }));

  return {
    maximumScoreInput: screen.getByRole('spinbutton', { name: 'Maximum lead score' }),
    onFiltersChange,
  };
}

function expectValidQuery(filters: LeadListFilters) {
  expect(filters.minScore).toBeGreaterThanOrEqual(0);
  expect(filters.maxScore).toBeLessThanOrEqual(100);
  expect(filters.minScore).toBeLessThanOrEqual(filters.maxScore);
  expect(parseLeadListQuery(encodeLeadListQuery(filters))).toEqual(filters);
}

afterEach(cleanup);

describe('FilterSidebar score range', () => {
  test('preserves a maximum score of zero and keeps the minimum at or below it', () => {
    const { maximumScoreInput, onFiltersChange } = renderScoreFilters({
      ...defaultLeadListQuery,
      minScore: 30,
    });

    fireEvent.change(maximumScoreInput, { target: { value: '0' } });

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...defaultLeadListQuery,
      minScore: 0,
      maxScore: 0,
    });
    expectValidQuery(onFiltersChange.mock.lastCall?.[0] as LeadListFilters);
  });

  test.each([
    ['empty', '', 100],
    ['invalid', 'not-a-number', 100],
    ['above the upper bound', '101', 100],
    ['below the lower bound', '-1', 0],
  ])('turns %s maximum-score input into a valid query', (_case, value, expectedMaxScore) => {
    const { maximumScoreInput, onFiltersChange } = renderScoreFilters();

    fireEvent.change(maximumScoreInput, { target: { value } });

    const nextFilters = onFiltersChange.mock.lastCall?.[0] as LeadListFilters;
    expect(nextFilters.maxScore).toBe(expectedMaxScore);
    expectValidQuery(nextFilters);
  });
});
