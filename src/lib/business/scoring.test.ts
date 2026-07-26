import { describe, expect, test } from 'vitest';

import type {
  ExtendedBusinessData,
  IndustryType,
  ScoreBreakdown,
  ScrapedWebsiteData,
  WebsiteAnalysis,
  WebsiteQualitySignals,
} from '@/types';
import { createDemandEvidenceProfile } from './revenue-profile';
import { calculateLeadScore } from './scoring';

const healthyQualitySignals: WebsiteQualitySignals = {
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
};

function scrapedWebsite(overrides: Partial<ScrapedWebsiteData> = {}): ScrapedWebsiteData {
  return {
    url: 'https://example.com',
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
    emails: ['hello@example.com'],
    socialLinks: { instagram: 'https://instagram.com/example' },
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
      ...healthyQualitySignals,
      ...overrides.qualitySignals,
    },
    ...overrides,
  };
}

function business(overrides: Partial<ExtendedBusinessData> = {}): ExtendedBusinessData {
  return {
    photoCount: 10,
    phone: '555-0100',
    rating: 4.5,
    reviewCount: 100,
    industryType: 'restaurant',
    ...overrides,
  };
}

const emptyBreakdown: ScoreBreakdown = {
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
  demandLabel: '',
  rawTotal: 0,
  total: 0,
};

const degradedScrape = scrapedWebsite({
  techStack: ['jQuery'],
  hasCustomSite: false,
  estimatedAge: 'ancient',
  hasOnlineBooking: false,
  socialLinks: {},
  socialCount: 0,
  hasMobileViewport: false,
  isHttps: false,
  hasModernDesign: false,
  marketingSignals: {
    hasGoogleAds: true,
    hasFacebookAds: false,
    hasGoogleAnalytics: false,
    hasBingAds: false,
    hasHotjar: false,
    hasOtherAds: false,
    detectedPlatforms: ['Google Ads'],
  },
  hasMarketingBudget: true,
  qualitySignals: {
    hasTableLayout: true,
    wordCount: 100,
    hasAnyForm: false,
    hasSchemaOrg: false,
    hasOpenGraph: false,
    hasDeprecatedTags: true,
    deprecatedTagsFound: ['marquee'],
    hasFixedPixelWidth: true,
    hasLangAttribute: false,
    jqueryVersion: '1.12.4',
    isOldJquery: true,
    templateFingerprint: 'Wix',
  },
});

const degradedAnalysis: WebsiteAnalysis = {
  url: 'https://example.com',
  isHttps: false,
  performanceScore: 20,
  accessibilityScore: 40,
  seoScore: 50,
  bestPracticesScore: 60,
  largestContentfulPaint: 5_500,
  cumulativeLayoutShift: 0.42,
  isMobileFriendly: false,
  responseTime: 5_000,
  hasErrors: false,
  analyzedAt: '2026-01-01T00:00:00.000Z',
};

describe('calculateLeadScore website states', () => {
  test('locks the implied opportunity score for a service business with no site', () => {
    expect(calculateLeadScore(business({ website: null }))).toEqual({
      ...emptyBreakdown,
      noWebsite: 45,
      noOnlineBooking: 8,
      demandSignal: 'medium',
      demandReasonCode: 'established_traffic',
      demandLabel: '100 reviews · 4.5★: established traffic',
      rawTotal: 53,
      total: 53,
    });
  });

  test('locks the smaller implied opportunity score for a social-only site', () => {
    expect(
      calculateLeadScore(
        business({ website: 'https://instagram.com/example', industryType: 'salon' })
      )
    ).toEqual({
      ...emptyBreakdown,
      socialOnlyWebsite: 30,
      noOnlineBooking: 8,
      demandSignal: 'medium',
      demandReasonCode: 'established_traffic',
      demandLabel: '100 reviews · 4.5★: established traffic',
      rawTotal: 38,
      total: 38,
    });
  });

  test('locks all current signals for a reachable degraded site without PageSpeed data', () => {
    expect(
      calculateLeadScore(
        business({
          website: 'https://example.com',
          phone: null,
          photoCount: 0,
          rating: 4.7,
          reviewCount: 10,
          scrapedData: degradedScrape,
        })
      )
    ).toEqual({
      ...emptyBreakdown,
      noPhone: 5,
      fewPhotos: 8,
      lowReviews: 7,
      hiddenGem: 5,
      notMobileFriendly: 10,
      noHttps: 5,
      outdatedWebsite: 10,
      noOnlineBooking: 8,
      noSocialLinks: 5,
      basicTechStack: 7,
      noViewport: 10,
      tableLayout: 8,
      thinContent: 6,
      deprecatedTags: 6,
      templateFingerprint: 7,
      noForm: 5,
      fixedPixelWidth: 4,
      outdatedJquery: 4,
      noSchemaOrg: 4,
      noOpenGraph: 3,
      noLangAttribute: 2,
      qualityChips: ['No mobile viewport', 'Table-based layout', 'Wix template'],
      hasMarketingBudget: true,
      marketingPlatforms: ['Google Ads'],
      demandSignal: 'low',
      demandReasonCode: 'emerging_traffic',
      demandLabel: '10 reviews · 4.7★: early traffic evidence',
      rawTotal: 129,
      total: 100,
    });
  });

  test('keeps a 99-point signal sum unchanged', () => {
    const result = calculateLeadScore(
      business({
        website: 'https://example.com',
        phone: null,
        photoCount: 0,
        rating: 4.7,
        reviewCount: 10,
        scrapedData: {
          ...degradedScrape,
          hasMobileViewport: true,
          qualitySignals: {
            ...degradedScrape.qualitySignals!,
            hasTableLayout: false,
            hasLangAttribute: true,
          },
        },
      })
    );

    expect(result).toMatchObject({ rawTotal: 99, total: 99 });
  });

  test('keeps a 100-point signal sum unchanged', () => {
    const result = calculateLeadScore(
      business({
        website: 'https://example.com',
        phone: null,
        photoCount: 0,
        rating: 4.7,
        reviewCount: 10,
        scrapedData: {
          ...degradedScrape,
          estimatedAge: 'recent',
          qualitySignals: {
            ...degradedScrape.qualitySignals!,
            hasTableLayout: false,
            hasDeprecatedTags: false,
            deprecatedTagsFound: [],
            hasAnyForm: true,
          },
        },
      })
    );

    expect(result).toMatchObject({ rawTotal: 100, total: 100 });
  });

  test('caps the public score while retaining every stacked signal point', () => {
    const result = calculateLeadScore(
      business({
        website: 'https://example.com',
        phone: null,
        photoCount: 0,
        rating: 4.7,
        reviewCount: 10,
        scrapedData: degradedScrape,
        websiteAnalysis: degradedAnalysis,
      })
    );

    expect(result).toMatchObject({
      poorPerformance: 10,
      notMobileFriendly: 10,
      noHttps: 5,
      lowAccessibility: 6,
      lowSeo: 6,
      lowBestPractices: 4,
      slowLcp: 5,
      highCls: 3,
      rawTotal: 163,
      total: 100,
    });
  });
});

describe('calculateLeadScore booking rules', () => {
  test.each([
    ['restaurant', 8],
    ['salon', 8],
    ['fitness', 8],
    ['medical', 8],
    ['retail', 0],
    ['automotive', 8],
    ['real_estate', 0],
    ['professional_services', 0],
    ['other', 0],
  ] satisfies Array<[IndustryType, number]>)(
    'scores reachable %s sites with and without booking',
    (industryType, expectedMissingBookingScore) => {
      const withoutBooking = calculateLeadScore(
        business({
          website: 'https://example.com',
          industryType,
          scrapedData: scrapedWebsite({ hasOnlineBooking: false }),
        })
      );
      const withBooking = calculateLeadScore(
        business({
          website: 'https://example.com',
          industryType,
          scrapedData: scrapedWebsite({ hasOnlineBooking: true }),
        })
      );

      expect(withoutBooking.noOnlineBooking).toBe(expectedMissingBookingScore);
      expect(withoutBooking.total).toBe(expectedMissingBookingScore);
      expect(withBooking.noOnlineBooking).toBe(0);
      expect(withBooking.total).toBe(0);
    }
  );
});

describe('calculateLeadScore demand evidence boundaries', () => {
  const cases = [
    [49, 0, 'emerging', 'unrated', 'low', 'emerging_traffic'],
    [49, 3.9, 'emerging', 'drag', 'low', 'emerging_traffic'],
    [49, 4.0, 'emerging', 'solid', 'low', 'emerging_traffic'],
    [49, 4.5, 'emerging', 'strong', 'low', 'emerging_traffic'],
    [49, 4.6, 'emerging', 'premium', 'low', 'emerging_traffic'],
    [50, 0, 'established', 'unrated', 'medium', 'established_traffic_unrated'],
    [50, 3.9, 'established', 'drag', 'medium', 'established_traffic_rating_drag'],
    [50, 4.0, 'established', 'solid', 'medium', 'established_traffic'],
    [50, 4.5, 'established', 'strong', 'medium', 'established_traffic'],
    [50, 4.6, 'established', 'premium', 'medium', 'boutique_demand'],
    [199, 0, 'established', 'unrated', 'medium', 'established_traffic_unrated'],
    [199, 3.9, 'established', 'drag', 'medium', 'established_traffic_rating_drag'],
    [199, 4.0, 'established', 'solid', 'medium', 'established_traffic'],
    [199, 4.5, 'established', 'strong', 'medium', 'established_traffic'],
    [199, 4.6, 'established', 'premium', 'medium', 'boutique_demand'],
    [200, 0, 'high', 'unrated', 'medium', 'high_traffic_unrated'],
    [200, 3.9, 'high', 'drag', 'medium', 'high_traffic_rating_drag'],
    [200, 4.0, 'high', 'solid', 'high', 'high_traffic'],
    [200, 4.5, 'high', 'strong', 'high', 'high_traffic'],
    [200, 4.6, 'high', 'premium', 'high', 'high_traffic'],
    [499, 0, 'high', 'unrated', 'medium', 'high_traffic_unrated'],
    [499, 3.9, 'high', 'drag', 'medium', 'high_traffic_rating_drag'],
    [499, 4.0, 'high', 'solid', 'high', 'high_traffic'],
    [499, 4.5, 'high', 'strong', 'high', 'high_traffic'],
    [499, 4.6, 'high', 'premium', 'high', 'high_traffic'],
    [500, 0, 'sustained', 'unrated', 'medium', 'sustained_traffic_unrated'],
    [500, 3.9, 'sustained', 'drag', 'medium', 'sustained_traffic_rating_drag'],
    [500, 4.0, 'sustained', 'solid', 'high', 'sustained_traffic'],
    [500, 4.5, 'sustained', 'strong', 'high', 'sustained_premium_demand'],
    [500, 4.6, 'sustained', 'premium', 'high', 'sustained_premium_demand'],
  ] as const;

  test.each(cases)(
    'classifies %i reviews at %f stars as %s / %s',
    (reviewCount, rating, volumeBand, ratingQualityBand, displaySignal, reasonCode) => {
      const profile = createDemandEvidenceProfile(reviewCount, rating);

      expect(profile).toMatchObject({
        volumeBand,
        ratingQualityBand,
        displaySignal,
        reasonCode,
      });
      expect(calculateLeadScore(business({ reviewCount, rating }))).toMatchObject({
        demandSignal: displaySignal,
        demandReasonCode: reasonCode,
      });
    }
  );
});
