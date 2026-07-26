import { describe, expect, test } from 'vitest';
import {
  LEAD_LIST_FOLLOW_UP_FILTERS,
  LEAD_LIST_SORT_FIELDS,
  LEAD_LIST_SORT_ORDERS,
  LEAD_LIST_UI_SORT_FIELDS,
  defaultLeadListQuery,
  encodeLeadListQuery,
  hasActiveLeadListFilters,
  parseLeadListQuery,
  type LeadListFilters,
  type LeadListQuery,
} from '@/lib/crm-lead-query';

function params(query = '') {
  return new URLSearchParams(query);
}

const representativeQuery: LeadListQuery = {
  statuses: ['new', 'proposal_sent'],
  industries: ['restaurant', 'professional_services'],
  tags: ['tag-1', 'tag-2'],
  minScore: 20,
  maxScore: 85,
  followUp: 'this_week',
  sortBy: 'updatedAt',
  sortOrder: 'asc',
};

const roundTripCases: [string, LeadListQuery][] = [
  ...LEAD_LIST_FOLLOW_UP_FILTERS.map((followUp): [string, LeadListQuery] => [
    `follow-up ${followUp}`,
    { ...representativeQuery, followUp },
  ]),
  ...LEAD_LIST_SORT_FIELDS.map((sortBy): [string, LeadListQuery] => [
    `API sort field ${sortBy}`,
    { ...representativeQuery, sortBy },
  ]),
  ...LEAD_LIST_UI_SORT_FIELDS.map((sortBy): [string, LeadListQuery] => [
    `UI sort field ${sortBy}`,
    { ...representativeQuery, sortBy },
  ]),
  ...LEAD_LIST_SORT_ORDERS.map((sortOrder): [string, LeadListQuery] => [
    `sort order ${sortOrder}`,
    { ...representativeQuery, sortOrder },
  ]),
];

describe('lead list query contract', () => {
  test('uses the current defaults for an empty query', () => {
    expect(parseLeadListQuery(params())).toEqual(defaultLeadListQuery);
    expect(encodeLeadListQuery(defaultLeadListQuery).toString()).toBe(
      'sortBy=savedAt&sortOrder=desc'
    );
  });

  test.each<[string, Partial<LeadListFilters>, boolean]>([
    ['default filters', {}, false],
    ['status', { statuses: ['new'] }, true],
    ['industry', { industries: ['medical'] }, true],
    ['tag', { tags: ['priority'] }, true],
    ['minimum score', { minScore: 1 }, true],
    ['maximum score', { maxScore: 99 }, true],
    ['follow-up', { followUp: 'today' }, true],
    ['sort field only', { sortBy: 'leadScore' }, false],
    ['sort order only', { sortOrder: 'asc' }, false],
  ])('reports %s activity', (_name, overrides, expected) => {
    const filters = { ...defaultLeadListQuery, ...overrides };

    expect(hasActiveLeadListFilters(filters)).toBe(expected);
  });

  test('checks filter activity without mutating the input', () => {
    const filters: LeadListFilters = {
      ...defaultLeadListQuery,
      statuses: ['new'],
      industries: ['medical'],
      tags: ['priority'],
    };
    const originalFilters = structuredClone(filters);

    hasActiveLeadListFilters(filters);

    expect(filters).toEqual(originalFilters);
  });

  test.each(roundTripCases)('round-trips the canonical %s', (_name, query) => {
    expect(parseLeadListQuery(encodeLeadListQuery(query))).toEqual(query);
  });

  test('preserves legacy singular status and industry URLs', () => {
    expect(parseLeadListQuery(params('status=won&industry=salon'))).toMatchObject({
      statuses: ['won'],
      industries: ['salon'],
    });
  });

  test.each([
    ['all', [], 'sortBy=savedAt&sortOrder=desc'],
    ['won', ['won'], 'statuses=won&sortBy=savedAt&sortOrder=desc'],
    ['lost', ['lost'], 'statuses=lost&sortBy=savedAt&sortOrder=desc'],
    [
      'pipeline',
      ['contacted', 'called', 'proposal_sent', 'negotiating'],
      'statuses=contacted%2Ccalled%2Cproposal_sent%2Cnegotiating&sortBy=savedAt&sortOrder=desc',
    ],
  ] as const)('encodes the current %s tab query shape', (_tab, statuses, expected) => {
    expect(
      encodeLeadListQuery({ ...defaultLeadListQuery, statuses: [...statuses] }).toString()
    ).toBe(expected);
  });

  test('encodes the current combined filter query shape', () => {
    const encoded = encodeLeadListQuery({
      ...defaultLeadListQuery,
      statuses: ['new'],
      industries: ['medical'],
      tags: ['priority'],
      minScore: 10,
      maxScore: 90,
      followUp: 'today',
      sortBy: 'leadScore',
      sortOrder: 'asc',
    });

    expect(encoded.toString()).toBe(
      'statuses=new&industries=medical&tags=priority&minScore=10&maxScore=90&followUp=today&sortBy=leadScore&sortOrder=asc'
    );
  });

  test('keeps parsed legacy and tag input stable after canonical encoding', () => {
    const parsed = parseLeadListQuery(
      params('status=won&industry=salon&tags=%20tag-1%20,tag-2,tag-1')
    );
    const encoded = encodeLeadListQuery(parsed);

    expect(encoded.toString()).toBe(
      'statuses=won&industries=salon&tags=tag-1%2Ctag-2&sortBy=savedAt&sortOrder=desc'
    );
    expect(parseLeadListQuery(encoded)).toEqual(parsed);
  });

  test.each(['abc', '1.5', '-1', '101', ''])('rejects invalid score %j', (score) => {
    expect(() => parseLeadListQuery(params(`minScore=${score}`))).toThrow();
  });

  test('rejects an inverted score range', () => {
    expect(() => parseLeadListQuery(params('minScore=80&maxScore=20'))).toThrow(
      'minScore must be less than or equal to maxScore'
    );
  });

  test.each([
    'statuses=new,invalid',
    'status=invalid',
    'industries=restaurant,invalid',
    'industry=invalid',
    'followUp=tomorrow',
    'sortBy=invalid',
    'sortOrder=sideways',
    'tags=tag-1,,tag-2',
  ])('rejects malformed enum or list input: %s', (query) => {
    expect(() => parseLeadListQuery(params(query))).toThrow();
  });
});
