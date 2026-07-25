import { describe, expect, test } from 'vitest';
import type { BusinessSearchResult, ScoreBreakdown } from '@/types';
import {
  filterAndSortResults,
  isRealEmail,
  mergeEnrichmentResults,
  selectResultsById,
  type SearchResultFilters,
  type SearchResultSort,
} from './derive-search-results';

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

function lead(
  placeId: string,
  overrides: Partial<BusinessSearchResult> = {}
): BusinessSearchResult {
  return {
    placeId,
    name: placeId,
    photoCount: 0,
    types: [],
    socialLinks: {},
    contactPoints: 0,
    leadScore: 0,
    scoreBreakdown,
    opportunities: [],
    industryType: 'other',
    ...overrides,
  };
}

const noFilters: SearchResultFilters = {
  hasEmail: false,
  hasPhone: false,
  hasSocial: false,
  hasAds: false,
  minBudget: 0,
};

function ids(results: readonly BusinessSearchResult[]): string[] {
  return results.map((result) => result.placeId);
}

describe('mergeEnrichmentResults', () => {
  test('keeps an existing website, adds a discovered website, and lets discovered socials win', () => {
    const existing = lead('existing', {
      website: 'https://original.example',
      socialLinks: {
        facebook: 'https://facebook.com/original',
        instagram: 'https://instagram.com/original',
      },
      contactPoints: 3,
    });
    const missing = lead('missing', { socialLinks: {} });
    const untouched = lead('untouched');
    const results = [existing, missing, untouched];

    const merged = mergeEnrichmentResults(results, {
      existing: {
        website: 'https://discovered.example',
        socials: {
          facebook: 'https://facebook.com/discovered',
          twitter: 'https://twitter.com/discovered',
        },
      },
      missing: { website: 'https://found.example' },
    });

    expect(merged[0]).toMatchObject({
      website: 'https://original.example',
      contactPoints: 3,
      socialLinks: {
        facebook: 'https://facebook.com/discovered',
        instagram: 'https://instagram.com/original',
        twitter: 'https://twitter.com/discovered',
      },
    });
    expect(merged[1]?.website).toBe('https://found.example');
    expect(merged[2]).toBe(untouched);
  });

  test('does not mutate the result array, leads, or social maps', () => {
    const results = [
      lead('one', {
        website: 'https://original.example',
        socialLinks: { facebook: 'https://facebook.com/original' },
        contactPoints: 2,
      }),
    ];
    const before = structuredClone(results);

    mergeEnrichmentResults(results, {
      one: {
        website: 'https://discovered.example',
        socials: { facebook: 'https://facebook.com/discovered' },
      },
    });

    expect(results).toEqual(before);
  });
});

describe('filterAndSortResults filters', () => {
  const results = [
    lead('complete', {
      email: 'hello@complete.co',
      phone: '123',
      socialLinks: { instagram: 'https://instagram.com/complete' },
      scoreBreakdown: { ...scoreBreakdown, hasMarketingBudget: true },
      budgetEstimate: {
        min: 1500,
        max: 3000,
        label: '$1.5K - $3K',
        confidence: 'medium',
        reasons: [],
        points: 50,
      },
    }),
    lead('junk-email', { email: 'noreply@example.com' }),
    lead('empty-social-key', { socialLinks: { instagram: undefined } }),
    lead('below-budget', {
      budgetEstimate: {
        min: 500,
        max: 1000,
        label: '$500 - $1K',
        confidence: 'low',
        reasons: [],
        points: 20,
      },
    }),
    lead('no-budget'),
  ];

  test.each([
    ['hasEmail', { hasEmail: true }, ['complete']],
    ['hasPhone', { hasPhone: true }, ['complete']],
    ['hasSocial', { hasSocial: true }, ['complete', 'empty-social-key']],
    ['hasAds', { hasAds: true }, ['complete']],
    ['minBudget', { minBudget: 1500 }, ['complete']],
  ] satisfies Array<[string, Partial<SearchResultFilters>, string[]]>)(
    'applies the %s filter',
    (_name, filter, expected) => {
      expect(ids(filterAndSortResults(results, { ...noFilters, ...filter }, 'score'))).toEqual(
        expected
      );
    }
  );

  test('combines active filters and treats zero as no budget filter', () => {
    expect(
      ids(
        filterAndSortResults(
          results,
          { ...noFilters, hasEmail: true, hasPhone: true, minBudget: 0 },
          'score'
        )
      )
    ).toEqual(['complete']);
    expect(filterAndSortResults(results, noFilters, 'score')).toHaveLength(results.length);
  });
});

describe('filterAndSortResults sorting', () => {
  test.each([
    [
      'fit',
      [
        lead('missing-fit', { leadScore: 90 }),
        lead('fit-tie-lower-score', { fitScore: 90, leadScore: 50 }),
        lead('highest-fit', { fitScore: 95, leadScore: 20 }),
      ],
      ['highest-fit', 'missing-fit', 'fit-tie-lower-score'],
    ],
    [
      'contactPoints',
      [
        lead('lower-contacts', { contactPoints: 2, leadScore: 99 }),
        lead('tie-lower-score', { contactPoints: 4, leadScore: 40 }),
        lead('tie-higher-score', { contactPoints: 4, leadScore: 70 }),
      ],
      ['tie-higher-score', 'tie-lower-score', 'lower-contacts'],
    ],
    [
      'reviews',
      [
        lead('missing-reviews'),
        lead('most-reviews', { reviewCount: 100 }),
        lead('zero-reviews', { reviewCount: 0 }),
      ],
      ['most-reviews', 'missing-reviews', 'zero-reviews'],
    ],
    [
      'rating',
      [
        lead('missing-rating'),
        lead('highest-rating', { rating: 4.9 }),
        lead('zero-rating', { rating: 0 }),
      ],
      ['highest-rating', 'missing-rating', 'zero-rating'],
    ],
    [
      'score',
      [
        lead('lower-score', { leadScore: 60, contactPoints: 9 }),
        lead('tie-lower-contacts', { leadScore: 80, contactPoints: 2 }),
        lead('tie-higher-contacts', { leadScore: 80, contactPoints: 5 }),
      ],
      ['tie-higher-contacts', 'tie-lower-contacts', 'lower-score'],
    ],
  ] satisfies Array<[SearchResultSort, BusinessSearchResult[], string[]]>)(
    '%s order and tie-breaks',
    (sort, input, expected) => {
      expect(ids(filterAndSortResults(input, noFilters, sort))).toEqual(expected);
    }
  );

  test('does not mutate the input array while sorting', () => {
    const results = [lead('low', { leadScore: 10 }), lead('high', { leadScore: 90 })];
    const before = structuredClone(results);

    const sorted = filterAndSortResults(results, noFilters, 'score');

    expect(results).toEqual(before);
    expect(ids(sorted)).toEqual(['high', 'low']);
  });
});

describe('isRealEmail', () => {
  test.each([
    'user@business.co',
    'name@business.co',
    'someone@business.co',
    'test@business.co',
    'your-address@business.co',
    'hello@example.com',
    'hello@domain.com',
    'hello@email.com',
    'noreply@business.co',
    'no-reply@business.co',
    'placeholder@business.co',
    'sample@business.co',
    'changeme@business.co',
    'hello@wix.com',
    'sentry@business.co',
    'wordpress@business.co',
  ])('rejects junk pattern %s', (email) => {
    expect(isRealEmail(email)).toBe(false);
  });

  test.each(['hello@business.co', 'team@email.com.au', ''])('keeps non-junk value %s', (email) => {
    expect(isRealEmail(email)).toBe(true);
  });
});

describe('selectResultsById', () => {
  test('returns selected leads in result order, regardless of selection insertion order', () => {
    const results = [lead('one'), lead('two'), lead('three')];
    const selectedIds = new Set(['three', 'one']);

    expect(ids(selectResultsById(results, selectedIds))).toEqual(['one', 'three']);
    expect(ids(results)).toEqual(['one', 'two', 'three']);
  });
});
