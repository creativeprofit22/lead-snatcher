import { describe, expect, test } from 'vitest';
import {
  defaultLeadListQuery,
  encodeLeadListQuery,
  parseLeadListQuery,
  type LeadListQuery,
} from '@/lib/crm-lead-query';

function params(query = '') {
  return new URLSearchParams(query);
}

describe('lead list query contract', () => {
  test('uses the current defaults for an empty query', () => {
    expect(parseLeadListQuery(params())).toEqual(defaultLeadListQuery);
    expect(encodeLeadListQuery(defaultLeadListQuery).toString()).toBe(
      'sortBy=savedAt&sortOrder=desc'
    );
  });

  test('round-trips every filter and sort value', () => {
    const query: LeadListQuery = {
      statuses: ['new', 'proposal_sent'],
      industries: ['restaurant', 'professional_services'],
      tags: ['tag-1', 'tag-2'],
      minScore: 20,
      maxScore: 85,
      followUp: 'this_week',
      sortBy: 'updatedAt',
      sortOrder: 'asc',
    };

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

  test('trims and deduplicates tag IDs', () => {
    expect(parseLeadListQuery(params('tags=tag-1,%20tag-2%20,tag-1')).tags).toEqual([
      'tag-1',
      'tag-2',
    ]);
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
