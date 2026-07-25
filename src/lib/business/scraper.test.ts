import type { BusinessSearchResult, ExtendedBusinessData } from '@/types';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { HostResolver } from './public-url';
import { extractWebsiteData } from './scraper-extract';
import { createInitialScrapeResult, scrapeWebsite } from './scraper';

const FIXED_TIME = '2026-07-25T12:00:00.000Z';
const resolvePublicHost: HostResolver = async () => [{ address: '93.184.216.34', family: 4 }];

const scraperOutputFixture = createInitialScrapeResult(
  'https://example.com',
  FIXED_TIME
) satisfies Awaited<ReturnType<typeof scrapeWebsite>>;
const extendedBusinessFixture = {
  photoCount: 0,
  scrapedData: scraperOutputFixture,
} satisfies ExtendedBusinessData;
const businessSearchResultFixture = {
  placeId: 'fixture',
  name: 'Fixture',
  photoCount: 0,
  types: [],
  socialLinks: {},
  contactPoints: 0,
  leadScore: 0,
  scoreBreakdown: {} as BusinessSearchResult['scoreBreakdown'],
  opportunities: [],
  industryType: 'other',
  scrapedData: scraperOutputFixture,
} satisfies BusinessSearchResult;
void [extendedBusinessFixture, businessSearchResultFixture];

function expectedInitialResult(url = 'https://example.com') {
  return {
    url,
    isReachable: false,
    loadTimeMs: 0,
    techStack: [],
    hasWordPress: false,
    hasShopify: false,
    hasSquarespace: false,
    hasWix: false,
    hasCustomSite: true,
    estimatedAge: 'unknown',
    hasOnlineBooking: false,
    hasContactForm: false,
    hasLiveChat: false,
    hasNewsletter: false,
    hasEcommerce: false,
    hasBlog: false,
    emails: [],
    socialLinks: {},
    socialCount: 0,
    hasMobileViewport: false,
    isHttps: true,
    hasSSLIssues: false,
    hasModernDesign: false,
    imageCount: 0,
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
    qualitySignals: {
      hasTableLayout: false,
      wordCount: 0,
      hasAnyForm: false,
      hasSchemaOrg: false,
      hasOpenGraph: false,
      hasDeprecatedTags: false,
      deprecatedTagsFound: [],
      hasFixedPixelWidth: false,
      hasLangAttribute: false,
      jqueryVersion: null,
      isOldJquery: false,
      templateFingerprint: null,
    },
    scrapedAt: FIXED_TIME,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('website HTML extraction', () => {
  test('returns exact defaults for minimal HTML', () => {
    expect(extractWebsiteData('', 2026)).toEqual({
      techStack: [],
      hasWordPress: false,
      hasShopify: false,
      hasSquarespace: false,
      hasWix: false,
      hasCustomSite: true,
      estimatedAge: 'unknown',
      hasOnlineBooking: false,
      hasContactForm: false,
      hasLiveChat: false,
      hasNewsletter: false,
      hasEcommerce: false,
      hasBlog: false,
      emails: [],
      socialLinks: {},
      socialCount: 0,
      hasMobileViewport: false,
      hasModernDesign: false,
      imageCount: 0,
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
      qualitySignals: {
        hasTableLayout: false,
        wordCount: 0,
        hasAnyForm: false,
        hasSchemaOrg: false,
        hasOpenGraph: false,
        hasDeprecatedTags: false,
        deprecatedTagsFound: [],
        hasFixedPixelWidth: false,
        hasLangAttribute: false,
        jqueryVersion: null,
        isOldJquery: false,
        templateFingerprint: null,
      },
    });
  });

  test('characterizes every extractor family with dense HTML', () => {
    const html = `
      <html lang="de-DE">
        <head>
          <title> Dense Co </title>
          <meta name="description" content=" Dense description ">
          <meta name="viewport" content="width=device-width">
          <meta property="og:title" content="Dense Co">
          <script type="application/ld+json">{"@context":"https://schema.org"}</script>
          <script src="/wp-content/cdn.shopify/squarespace/wixstatic/webflow/_next/vue.js/angular/bootstrap/tailwind/jquery-1.12.4.js"></script>
          <script>
            googlesyndication.com; connect.facebook.net; googletagmanager.com;
            bat.bing.com; hotjar.com; adroll.com;
          </script>
        </head>
        <body bgcolor="#fff">
          <center><font><marquee>Book now contact email message intercom newsletter checkout blog</marquee></font></center>
          <form><input name="message"></form>
          <table width="900"><tr><td><table width="800"></table></td></tr></table>
          <div style="width: 700px">Dense visible words</div>
          alpha@dense.test beta@dense.test alpha@dense.test noreply@dense.test
          gamma@dense.test delta@dense.test epsilon@dense.test zeta@dense.test
          <a href="https://facebook.com/first">Facebook</a>
          <a href="https://facebook.com/second">Facebook again</a>
          <a href="https://instagram.com/dense">Instagram</a>
          <a href="https://x.com/dense">Twitter</a>
          <a href="https://linkedin.com/company/dense">LinkedIn</a>
          <a href="https://youtube.com/dense">YouTube</a>
          <a href="https://tiktok.com/@dense">TikTok</a>
          <img><IMG><img><video></video>
          godaddysites.com wix.com
        </body>
      </html>
    `;

    expect(extractWebsiteData(html, 2026)).toEqual({
      title: 'Dense Co',
      description: 'Dense description',
      language: 'de',
      techStack: [
        'WordPress',
        'Shopify',
        'Squarespace',
        'Wix',
        'Webflow',
        'React',
        'Vue',
        'Angular',
        'Bootstrap',
        'TailwindCSS',
        'jQuery',
      ],
      hasWordPress: true,
      hasShopify: true,
      hasSquarespace: true,
      hasWix: true,
      hasCustomSite: false,
      estimatedAge: 'unknown',
      hasOnlineBooking: true,
      hasContactForm: true,
      hasLiveChat: true,
      hasNewsletter: true,
      hasEcommerce: true,
      hasBlog: true,
      emails: [
        'alpha@dense.test',
        'beta@dense.test',
        'gamma@dense.test',
        'delta@dense.test',
        'epsilon@dense.test',
      ],
      socialLinks: {
        facebook: 'https://facebook.com/first',
        instagram: 'https://instagram.com/dense',
        twitter: 'https://x.com/dense',
        linkedin: 'https://linkedin.com/company/dense',
        youtube: 'https://youtube.com/dense',
        tiktok: 'https://tiktok.com/@dense',
      },
      socialCount: 6,
      hasMobileViewport: true,
      hasModernDesign: true,
      imageCount: 3,
      hasVideo: true,
      marketingSignals: {
        hasGoogleAds: true,
        hasFacebookAds: true,
        hasGoogleAnalytics: true,
        hasBingAds: true,
        hasHotjar: true,
        hasOtherAds: true,
        detectedPlatforms: [
          'Google Ads',
          'Facebook Ads',
          'Google Analytics',
          'Bing Ads',
          'Hotjar',
          'Other Ad Networks',
        ],
      },
      hasMarketingBudget: true,
      qualitySignals: {
        hasTableLayout: true,
        wordCount: 32,
        hasAnyForm: true,
        hasSchemaOrg: true,
        hasOpenGraph: true,
        hasDeprecatedTags: true,
        deprecatedTagsFound: ['<marquee>', '<center>', '<font>', 'bgcolor='],
        hasFixedPixelWidth: true,
        hasLangAttribute: true,
        jqueryVersion: '1.12.4',
        isOldJquery: true,
        templateFingerprint: 'Wix',
      },
    });
  });

  test.each([
    [2025, 'new'],
    [2023, 'recent'],
    [2020, 'outdated'],
    [2019, 'ancient'],
  ] as const)('classifies copyright year %i at its age-bucket boundary', (year, age) => {
    expect(extractWebsiteData(`© ${year}`, 2026)).toMatchObject({
      copyrightYear: year,
      estimatedAge: age,
    });
  });

  test('ignores invalid copyright captures and keeps empty captures absent', () => {
    expect(extractWebsiteData('<title></title> © 1999 copyright 2027', 2026)).toMatchObject({
      estimatedAge: 'unknown',
    });
    expect(extractWebsiteData('<title></title> © Example', 2026)).not.toHaveProperty('title');
    expect(extractWebsiteData('© Example', 2026)).not.toHaveProperty('copyrightYear');
  });

  test.each([
    ['jquery-2.0.9.js', '2.0.9', true],
    ['jquery-2.1.0.js', '2.1.0', false],
  ])('preserves the jQuery 2.0 boundary for %s', (html, version, isOldJquery) => {
    expect(extractWebsiteData(html, 2026).qualitySignals).toMatchObject({
      jqueryVersion: version,
      isOldJquery,
    });
  });

  test('requires three fixed-width matches', () => {
    expect(
      extractWebsiteData('<div width="900"><div style="width: 800px">', 2026).qualitySignals
        .hasFixedPixelWidth
    ).toBe(false);
    expect(
      extractWebsiteData('<div width="900"><div style="width: 800px"><main width=700>', 2026)
        .qualitySignals.hasFixedPixelWidth
    ).toBe(true);
  });

  test('requires two tables without modern layout evidence', () => {
    expect(extractWebsiteData('<table>', 2026).qualitySignals.hasTableLayout).toBe(false);
    expect(extractWebsiteData('<table><table>', 2026).qualitySignals.hasTableLayout).toBe(true);
    expect(
      extractWebsiteData('<div style="display: grid"><table><table>', 2026).qualitySignals
        .hasTableLayout
    ).toBe(false);
  });

  test('uses the first configured template fingerprint', () => {
    expect(
      extractWebsiteData('godaddysites.com appears before wix.com', 2026).qualitySignals
        .templateFingerprint
    ).toBe('Wix');
  });

  test('distinguishes a contact form from any form', () => {
    const genericForm = extractWebsiteData('<form><input></form>', 2026);
    expect(genericForm.hasContactForm).toBe(false);
    expect(genericForm.qualitySignals.hasAnyForm).toBe(true);

    const contactTextWithoutForm = extractWebsiteData('Contact us by email', 2026);
    expect(contactTextWithoutForm.hasContactForm).toBe(false);
    expect(contactTextWithoutForm.qualitySignals.hasAnyForm).toBe(false);
  });
});

describe('website scrape result shape', () => {
  test('creates the complete fresh default shape without optional own properties', () => {
    expect(createInitialScrapeResult('https://example.com', FIXED_TIME)).toEqual(
      expectedInitialResult()
    );
  });

  test('preserves the complete own-property shape after a successful scrape', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '<html lang="en"><head><title>Example</title></head><body><p>Hello world</p></body></html>',
          { status: 200 }
        )
      );

    const result = await scrapeWebsite('https://example.com', {
      fetch: fetcher,
      resolve: resolvePublicHost,
    });

    expect(result).toEqual({
      ...expectedInitialResult(),
      isReachable: true,
      title: 'Example',
      language: 'en',
      qualitySignals: {
        ...expectedInitialResult().qualitySignals,
        wordCount: 3,
        hasLangAttribute: true,
      },
    });
  });

  test('preserves the complete own-property shape for an unreachable response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
    const fetcher = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }));

    const result = await scrapeWebsite('https://example.com', {
      fetch: fetcher,
      resolve: resolvePublicHost,
    });

    expect(result).toEqual({
      ...expectedInitialResult(),
      error: 'HTTP 503',
    });
  });
});
