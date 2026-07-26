import { describe, expect, test } from 'vitest';
import type {
  BusinessSearchResult,
  ScoreBreakdown,
  ScrapedWebsiteData,
  WebsiteAnalysis,
} from '@/types';
import {
  filterAndSortResults,
  isRealEmail,
  mergeEnrichmentResults,
  rederiveEnrichedSearchResult,
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
  demandSignal: 'low',
  demandReasonCode: 'no_review_evidence',
  demandLabel: 'Limited traffic signal',
  rawTotal: 0,
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

function healthyScrapedEvidence(): ScrapedWebsiteData {
  return {
    url: 'https://original.example',
    isReachable: true,
    loadTimeMs: 250,
    techStack: ['React'],
    hasWordPress: false,
    hasShopify: false,
    hasSquarespace: false,
    hasWix: false,
    hasCustomSite: true,
    estimatedAge: 'recent',
    hasOnlineBooking: true,
    hasContactForm: true,
    hasLiveChat: true,
    hasNewsletter: true,
    hasEcommerce: false,
    hasBlog: true,
    emails: [],
    socialLinks: { facebook: 'https://facebook.com/original' },
    socialCount: 1,
    hasMobileViewport: true,
    isHttps: true,
    hasSSLIssues: false,
    hasModernDesign: true,
    imageCount: 10,
    hasVideo: false,
    marketingSignals: {
      hasGoogleAds: false,
      hasFacebookAds: false,
      hasGoogleAnalytics: false,
      hasBingAds: false,
      hasHotjar: false,
      hasOtherAds: false,
      detectedPlatforms: [],
    },
    hasMarketingBudget: false,
    scrapedAt: '2026-01-01T00:00:00.000Z',
    qualitySignals: {
      hasTableLayout: false,
      wordCount: 500,
      hasAnyForm: true,
      hasSchemaOrg: true,
      hasOpenGraph: true,
      hasDeprecatedTags: false,
      deprecatedTagsFound: [],
      hasFixedPixelWidth: false,
      hasLangAttribute: true,
      jqueryVersion: null,
      isOldJquery: false,
      templateFingerprint: null,
    },
  };
}

function healthyPageSpeedEvidence(): WebsiteAnalysis {
  return {
    url: 'https://original.example',
    isHttps: true,
    performanceScore: 95,
    accessibilityScore: 95,
    seoScore: 95,
    bestPracticesScore: 95,
    largestContentfulPaint: 1_500,
    cumulativeLayoutShift: 0.05,
    isMobileFriendly: true,
    responseTime: 250,
    hasErrors: false,
    analyzedAt: '2026-01-01T00:00:00.000Z',
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
  test('preserves website precedence while enriched socials replace matching keys', () => {
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
      socialLinks: {
        facebook: 'https://facebook.com/discovered',
        instagram: 'https://instagram.com/original',
        twitter: 'https://twitter.com/discovered',
      },
    });
    expect(existing.contactPoints).toBe(3);
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

  test('re-derives intelligence after discovering a website with no new site evidence', () => {
    const original = lead('discovered-website', {
      phone: '555-0100',
      photoCount: 10,
      rating: 4.5,
      reviewCount: 100,
      contactPoints: 1,
      leadScore: 45,
      scoreBreakdown: { ...scoreBreakdown, noWebsite: 45, rawTotal: 45, total: 45 },
      opportunities: ['Website design and development'],
    });

    const result = rederiveEnrichedSearchResult(
      original,
      { website: 'https://found.example' },
      { score: 50, level: 'commercial', archetype: 'mixed' }
    );

    expect(result).toMatchObject({
      website: 'https://found.example',
      contactPoints: 2,
      leadScore: 5,
      fitScore: 3,
      areaLevel: 'commercial',
      scoreBreakdown: { noWebsite: 0, poorPerformance: 5, total: 5 },
      budgetEstimate: { min: 1_500, points: 40 },
    });
    expect(result.opportunities).toContain('SEO audit and optimization');
    expect(result.opportunities).not.toContain('Website design and development');
    expect(result.budgetEstimate?.reasons).toContain('Already invested in a website');
    expect(result.budgetEstimate?.reasons).not.toContain(
      'No website — first-time digital investment'
    );

    expect(filterAndSortResults([result], { ...noFilters, hasSocial: true }, 'fit')).toEqual([]);
    const displayedForSave = filterAndSortResults(
      [result],
      { ...noFilters, minBudget: 1_500 },
      'fit'
    );
    expect(displayedForSave).toEqual([result]);
    expect(displayedForSave[0]).toMatchObject({
      website: 'https://found.example',
      leadScore: 5,
      opportunities: result.opportunities,
    });
  });

  test('re-derives intelligence after socials are added and replaced while preserving site evidence', () => {
    const scrapedData = healthyScrapedEvidence();
    const websiteAnalysis = healthyPageSpeedEvidence();
    const original = lead('social-enrichment', {
      website: 'https://original.example',
      photoCount: 10,
      rating: 4.5,
      reviewCount: 100,
      socialLinks: { facebook: 'https://facebook.com/original' },
      contactPoints: 2,
      leadScore: 99,
      scrapedData,
      websiteAnalysis,
    });

    const [result] = mergeEnrichmentResults(
      [original],
      {
        'social-enrichment': {
          website: 'https://ignored.example',
          socials: {
            facebook: 'https://facebook.com/replacement',
            instagram: 'https://instagram.com/discovered',
            twitter: 'https://twitter.com/discovered',
          },
        },
      },
      { score: 50, level: 'commercial', archetype: 'mixed' }
    );

    expect(result).toMatchObject({
      website: 'https://original.example',
      socialLinks: {
        facebook: 'https://facebook.com/replacement',
        instagram: 'https://instagram.com/discovered',
        twitter: 'https://twitter.com/discovered',
      },
      contactPoints: 4,
      leadScore: 5,
      fitScore: 3,
      scoreBreakdown: { noWebsite: 0, total: 5 },
      budgetEstimate: { min: 1_500, points: 43 },
    });
    expect(result?.scrapedData).toBe(scrapedData);
    expect(result?.websiteAnalysis).toBe(websiteAnalysis);
    expect(result?.opportunities).not.toContain('Website design and development');
    expect(result?.budgetEstimate?.reasons).toContain('Multiple contact channels active');

    const displayedForSave = filterAndSortResults(
      result ? [result] : [],
      { ...noFilters, hasSocial: true, minBudget: 1_500 },
      'fit'
    );
    expect(displayedForSave).toEqual([result]);
    expect(displayedForSave[0]).toMatchObject({
      contactPoints: 4,
      leadScore: 5,
      fitScore: 3,
      budgetEstimate: { points: 43 },
    });
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
      ['highest-fit', 'fit-tie-lower-score', 'missing-fit'],
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
