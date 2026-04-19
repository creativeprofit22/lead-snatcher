import type { ScoreBreakdown, ExtendedBusinessData, WebsiteAnalysis } from '@/types';

// Industries that benefit from online booking
const BOOKING_INDUSTRIES = ['salon', 'fitness', 'medical', 'restaurant', 'automotive'];

/**
 * Multi-Layer Lead Scoring System v4
 *
 * CORE PRINCIPLE: No website = BIGGEST opportunity
 * Businesses without websites get implied points for missing features they'd need.
 *
 * Layer 1: Basic Presence (max 50 pts)
 *   - No website: +45 pts (THE biggest opportunity - they need everything!)
 *   - Social-only website: +30 pts (needs real website)
 *   - No phone: +5 pts
 *
 * Layer 2: Google Profile Quality (max 20 pts)
 *   - Few photos (<5): +8 pts
 *   - Low reviews (<20): +7 pts, (20-100): +4 pts
 *   - Hidden gem (rating ≥4.0 + low reviews): +5 pts
 *
 * Layer 3: Website Technical (max 25 pts) - only for sites that exist
 *   - Poor performance (<50): +10 pts
 *   - Not mobile-friendly: +10 pts
 *   - No HTTPS: +5 pts
 *
 * Layer 4: Website Opportunities (max 30 pts) - from Scraping
 *   - Outdated website (>3 years): +10 pts
 *   - No online booking (for service businesses): +8 pts
 *   - No social links on site: +5 pts
 *   - Basic tech stack: +7 pts
 *
 * Total max: ~100 pts (varies by situation)
 */
export function calculateLeadScore(business: ExtendedBusinessData): ScoreBreakdown {
  const breakdown: ScoreBreakdown = {
    // Layer 1
    noWebsite: 0,
    socialOnlyWebsite: 0,
    noPhone: 0,
    // Layer 2
    fewPhotos: 0,
    lowReviews: 0,
    hiddenGem: 0,
    // Layer 3
    poorPerformance: 0,
    notMobileFriendly: 0,
    noHttps: 0,
    // Layer 4
    outdatedWebsite: 0,
    noOnlineBooking: 0,
    noSocialLinks: 0,
    basicTechStack: 0,
    // Layer 5 — concrete, defensible website-quality signals
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
    revenueLabel: '',
    total: 0,
  };

  const isServiceBusiness = business.industryType && BOOKING_INDUSTRIES.includes(business.industryType);

  // === LAYER 1: Basic Presence ===

  if (!business.website) {
    // NO WEBSITE = BIGGEST OPPORTUNITY
    // They need everything: website, mobile, booking, social integration
    breakdown.noWebsite = 45;

    // Also give implied points for features they're missing
    // Service businesses without website = they definitely need booking
    if (isServiceBusiness) {
      breakdown.noOnlineBooking = 8;
    }
  } else if (isSocialOnlyWebsite(business.website)) {
    // Social-only is bad but not as bad as nothing
    breakdown.socialOnlyWebsite = 30;

    // They still need booking if service business
    if (isServiceBusiness) {
      breakdown.noOnlineBooking = 8;
    }
  }

  if (!business.phone) {
    breakdown.noPhone = 5;
  }

  // === LAYER 2: Google Profile Quality (max 20 pts) ===

  if (business.photoCount < 5) {
    breakdown.fewPhotos = 8;
  }

  const reviewCount = business.reviewCount || 0;
  if (reviewCount < 20) {
    breakdown.lowReviews = 7;
  } else if (reviewCount < 100) {
    breakdown.lowReviews = 4;
  }

  const rating = business.rating || 0;
  if (rating >= 4.0 && reviewCount < 50) {
    breakdown.hiddenGem = 5;
  }

  // === LAYER 3: Website Technical (max 25 pts) ===
  // Only apply if business HAS a website (not social-only)

  const hasRealWebsite = business.website && !isSocialOnlyWebsite(business.website);

  if (hasRealWebsite) {
    if (business.websiteAnalysis && !business.websiteAnalysis.hasErrors) {
      const analysis = business.websiteAnalysis;

      if (analysis.performanceScore < 50) {
        breakdown.poorPerformance = 10;
      }

      if (!analysis.isMobileFriendly) {
        breakdown.notMobileFriendly = 10;
      }

      if (!analysis.isHttps) {
        breakdown.noHttps = 5;
      }
    } else if (business.scrapedData && business.scrapedData.isReachable) {
      // Fallback to scraped data if no PageSpeed analysis
      if (!business.scrapedData.hasMobileViewport) {
        breakdown.notMobileFriendly = 10;
      }
      if (!business.scrapedData.isHttps) {
        breakdown.noHttps = 5;
      }
    } else {
      // Website exists but couldn't be analyzed - assume issues
      breakdown.poorPerformance = 5;
    }
  }

  // === LAYER 4: Website Opportunities (max 30 pts) - from Scraping ===
  // Only apply if business HAS a real website we could scrape

  if (hasRealWebsite && business.scrapedData && business.scrapedData.isReachable) {
    const scraped = business.scrapedData;

    // Outdated website
    if (scraped.estimatedAge === 'outdated' || scraped.estimatedAge === 'ancient') {
      breakdown.outdatedWebsite = 10;
    }

    // No online booking for service businesses (only if not already counted above)
    if (isServiceBusiness && !scraped.hasOnlineBooking && breakdown.noOnlineBooking === 0) {
      breakdown.noOnlineBooking = 8;
    }

    // No social links on website
    if (scraped.socialCount === 0) {
      breakdown.noSocialLinks = 5;
    }

    // Basic tech stack (old WordPress, plain HTML, no modern framework)
    const hasModernTech = scraped.techStack.some((t) =>
      ['React', 'Vue', 'Angular', 'TailwindCSS', 'Shopify', 'Webflow'].includes(t)
    );
    const isBasicWordPress = scraped.hasWordPress && !scraped.hasModernDesign;
    const isPlainHtml =
      scraped.techStack.length === 0 || (scraped.techStack.length === 1 && scraped.techStack[0] === 'jQuery');

    if (!hasModernTech && (isBasicWordPress || isPlainHtml)) {
      breakdown.basicTechStack = 7;
    }
  }

  // === LAYER 5: Website Quality (HTML + PageSpeed deep signals) ===
  // Only apply if business HAS a real, reachable website so we have
  // actual signals to score on. Every trigger is a concrete fact we
  // can put in a sales email — "no mobile viewport", "Wix template",
  // "accessibility 42".
  const qualityChipCandidates: Array<{ label: string; pts: number }> = [];

  if (hasRealWebsite && business.scrapedData && business.scrapedData.isReachable) {
    const scraped = business.scrapedData;
    const q = scraped.qualitySignals;

    if (!scraped.hasMobileViewport) {
      breakdown.noViewport = 10;
      qualityChipCandidates.push({ label: 'No mobile viewport', pts: 10 });
    }

    if (q) {
      if (q.hasTableLayout) {
        breakdown.tableLayout = 8;
        qualityChipCandidates.push({ label: 'Table-based layout', pts: 8 });
      }
      if (q.wordCount > 0 && q.wordCount < 150) {
        breakdown.thinContent = 6;
        qualityChipCandidates.push({ label: `Only ${q.wordCount} words`, pts: 6 });
      }
      if (q.hasDeprecatedTags) {
        breakdown.deprecatedTags = 6;
        const tag = q.deprecatedTagsFound[0] || 'deprecated tags';
        qualityChipCandidates.push({ label: `Uses ${tag}`, pts: 6 });
      }
      if (q.templateFingerprint) {
        breakdown.templateFingerprint = 7;
        qualityChipCandidates.push({
          label: `${q.templateFingerprint} template`,
          pts: 7,
        });
      }
      if (!q.hasAnyForm) {
        breakdown.noForm = 5;
        qualityChipCandidates.push({ label: 'No contact form', pts: 5 });
      }
      if (q.hasFixedPixelWidth) {
        breakdown.fixedPixelWidth = 4;
        qualityChipCandidates.push({ label: 'Fixed pixel widths', pts: 4 });
      }
      if (q.isOldJquery) {
        breakdown.outdatedJquery = 4;
        qualityChipCandidates.push({
          label: `jQuery ${q.jqueryVersion}`,
          pts: 4,
        });
      }
      if (!q.hasSchemaOrg) {
        breakdown.noSchemaOrg = 4;
        qualityChipCandidates.push({ label: 'No schema.org data', pts: 4 });
      }
      if (!q.hasOpenGraph) {
        breakdown.noOpenGraph = 3;
        qualityChipCandidates.push({ label: 'No Open Graph tags', pts: 3 });
      }
      if (!q.hasLangAttribute) {
        breakdown.noLangAttribute = 2;
        qualityChipCandidates.push({ label: 'Missing <html lang>', pts: 2 });
      }
    }
  }

  // PageSpeed-based signals — apply whenever we have analysis for a real site.
  if (hasRealWebsite && business.websiteAnalysis && !business.websiteAnalysis.hasErrors) {
    const a = business.websiteAnalysis;
    if (typeof a.accessibilityScore === 'number' && a.accessibilityScore < 70) {
      breakdown.lowAccessibility = 6;
      qualityChipCandidates.push({
        label: `Accessibility ${a.accessibilityScore}`,
        pts: 6,
      });
    }
    if (typeof a.seoScore === 'number' && a.seoScore < 70) {
      breakdown.lowSeo = 6;
      qualityChipCandidates.push({ label: `SEO ${a.seoScore}`, pts: 6 });
    }
    if (typeof a.bestPracticesScore === 'number' && a.bestPracticesScore < 80) {
      breakdown.lowBestPractices = 4;
      qualityChipCandidates.push({
        label: `Best practices ${a.bestPracticesScore}`,
        pts: 4,
      });
    }
    if (typeof a.largestContentfulPaint === 'number' && a.largestContentfulPaint > 4000) {
      breakdown.slowLcp = 5;
      qualityChipCandidates.push({
        label: `LCP ${(a.largestContentfulPaint / 1000).toFixed(1)}s`,
        pts: 5,
      });
    }
    if (typeof a.cumulativeLayoutShift === 'number' && a.cumulativeLayoutShift > 0.25) {
      breakdown.highCls = 3;
      qualityChipCandidates.push({
        label: `CLS ${a.cumulativeLayoutShift.toFixed(2)}`,
        pts: 3,
      });
    }
  }

  // Top 3 triggered signals, most valuable first — these are what the
  // card renders as chips and what the sales email quotes.
  breakdown.qualityChips = qualityChipCandidates
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3)
    .map((c) => c.label);

  // === MARKETING INTELLIGENCE (informational, not scored) ===
  if (business.scrapedData && 'hasMarketingBudget' in business.scrapedData) {
    breakdown.hasMarketingBudget = business.scrapedData.hasMarketingBudget;
    breakdown.marketingPlatforms = business.scrapedData.marketingSignals?.detectedPlatforms || [];
  }

  // === REVENUE SIGNAL (informational, not scored) ===
  // High review count = high foot traffic = revenue
  if (reviewCount >= 200) {
    breakdown.revenueSignal = 'high';
    breakdown.revenueLabel = `${reviewCount} reviews — high traffic, likely has budget`;
  } else if (reviewCount >= 50) {
    breakdown.revenueSignal = 'medium';
    breakdown.revenueLabel = `${reviewCount} reviews — established business`;
  } else {
    breakdown.revenueSignal = 'low';
    breakdown.revenueLabel = reviewCount > 0
      ? `${reviewCount} reviews — newer or low-traffic business`
      : 'No reviews — very new or unlisted';
  }

  // Calculate total
  breakdown.total =
    breakdown.noWebsite +
    breakdown.socialOnlyWebsite +
    breakdown.noPhone +
    breakdown.fewPhotos +
    breakdown.lowReviews +
    breakdown.hiddenGem +
    breakdown.poorPerformance +
    breakdown.notMobileFriendly +
    breakdown.noHttps +
    breakdown.outdatedWebsite +
    breakdown.noOnlineBooking +
    breakdown.noSocialLinks +
    breakdown.basicTechStack +
    breakdown.noViewport +
    breakdown.tableLayout +
    breakdown.thinContent +
    breakdown.deprecatedTags +
    breakdown.templateFingerprint +
    breakdown.noForm +
    breakdown.fixedPixelWidth +
    breakdown.outdatedJquery +
    breakdown.noSchemaOrg +
    breakdown.noOpenGraph +
    breakdown.noLangAttribute +
    breakdown.lowAccessibility +
    breakdown.lowSeo +
    breakdown.lowBestPractices +
    breakdown.slowLcp +
    breakdown.highCls;

  return breakdown;
}

/**
 * Calculate score with website analysis data
 */
export function calculateLeadScoreWithAnalysis(
  business: Omit<ExtendedBusinessData, 'websiteAnalysis'>,
  websiteAnalysis?: WebsiteAnalysis | null
): ScoreBreakdown {
  return calculateLeadScore({
    ...business,
    websiteAnalysis,
  });
}

/**
 * Check if a website is just a social media profile
 */
function isSocialOnlyWebsite(website: string): boolean {
  const socialPatterns = [
    'facebook.com',
    'fb.com',
    'instagram.com',
    'twitter.com',
    'x.com',
    'tiktok.com',
    'linkedin.com',
    'youtube.com',
  ];

  const lowerWebsite = website.toLowerCase();
  return socialPatterns.some((pattern) => lowerWebsite.includes(pattern));
}

/**
 * Get priority level based on score
 *
 * With v4 scoring:
 * - No website + service business + few photos + low reviews = 45+8+8+7 = 68+ (Hot)
 * - No website + few photos + low reviews = 45+8+7 = 60 (Hot)
 * - Social-only + service business + few photos = 30+8+8 = 46+ (Warm)
 * - Bad website with issues = 15-45 typically (Warm to Hot depending on issues)
 * - Good website with minor issues = 5-20 (Cold - they're doing okay)
 */
export function getLeadPriority(score: number): 'high' | 'medium' | 'low' {
  if (score >= 55) return 'high'; // Hot Lead - major opportunities
  if (score >= 35) return 'medium'; // Warm Lead - some opportunities
  return 'low'; // Cold Lead - fewer immediate needs
}

/**
 * Get score color for display
 */
export function getScoreColor(score: number): string {
  if (score >= 55) return '#22c55e'; // green - Hot Lead
  if (score >= 35) return '#eab308'; // yellow - Warm Lead
  return '#6b7280'; // gray - Cold Lead
}
