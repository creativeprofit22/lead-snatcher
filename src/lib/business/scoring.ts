import type { ExtendedBusinessData, ScoreBreakdown, WebsiteAnalysis } from '@/types';
import { INDUSTRY_POLICIES } from './industry-policy';
import { createDemandEvidenceProfile, formatDemandEvidenceLabel } from './revenue-profile';
import {
  calculateScoreBreakdownRawTotal,
  calculateScoreBreakdownTotal,
  createScoreBreakdown,
} from './score-breakdown-contract';
import { isSocialProfileUrl } from './social-profile-url';

const SCORE_POLICY = {
  noWebsite: { points: 45 },
  socialOnlyWebsite: { points: 30 },
  noPhone: { points: 5 },
  fewPhotos: { photoCountThreshold: 5, points: 8 },
  lowReviews: {
    lowReviewCountThreshold: 20,
    lowPoints: 7,
    moderateReviewCountThreshold: 100,
    moderatePoints: 4,
  },
  hiddenGem: { minimumRating: 4, reviewCountThreshold: 50, points: 5 },
  poorPerformance: { performanceThreshold: 50, points: 10, unavailablePoints: 5 },
  notMobileFriendly: { points: 10 },
  noHttps: { points: 5 },
  outdatedWebsite: { points: 10 },
  noOnlineBooking: { points: 8 },
  noSocialLinks: { points: 5 },
  basicTechStack: { points: 7 },
  noViewport: { points: 10 },
  tableLayout: { points: 8 },
  thinContent: { minimumMeasuredWordCount: 1, wordCountThreshold: 150, points: 6 },
  deprecatedTags: { points: 6 },
  templateFingerprint: { points: 7 },
  noForm: { points: 5 },
  fixedPixelWidth: { points: 4 },
  outdatedJquery: { points: 4 },
  noSchemaOrg: { points: 4 },
  noOpenGraph: { points: 3 },
  noLangAttribute: { points: 2 },
  lowAccessibility: { scoreThreshold: 70, points: 6 },
  lowSeo: { scoreThreshold: 70, points: 6 },
  lowBestPractices: { scoreThreshold: 80, points: 4 },
  slowLcp: { millisecondsThreshold: 4_000, points: 5 },
  highCls: { threshold: 0.25, points: 3 },
  qualityChips: { limit: 3 },
} as const;

/**
 * Multi-layer lead scoring system.
 *
 * Basic business-presence, Google profile, website technical, website
 * opportunity, and deep website-quality signals contribute to the total.
 * Marketing and demand/traffic signals remain informational.
 */
export function calculateLeadScore(business: ExtendedBusinessData): ScoreBreakdown {
  const breakdown = createScoreBreakdown();

  const bookingScored = business.industryType
    ? INDUSTRY_POLICIES[business.industryType].bookingScored
    : false;

  // === LAYER 1: Basic Presence ===

  if (!business.website) {
    // NO WEBSITE = BIGGEST OPPORTUNITY
    // They need everything: website, mobile, booking, social integration
    breakdown.noWebsite = SCORE_POLICY.noWebsite.points;

    // Also give implied points for features they're missing
    // Service businesses without website = they definitely need booking
    if (bookingScored) {
      breakdown.noOnlineBooking = SCORE_POLICY.noOnlineBooking.points;
    }
  } else if (isSocialProfileUrl(business.website)) {
    // Social-only is bad but not as bad as nothing
    breakdown.socialOnlyWebsite = SCORE_POLICY.socialOnlyWebsite.points;

    // They still need booking if service business
    if (bookingScored) {
      breakdown.noOnlineBooking = SCORE_POLICY.noOnlineBooking.points;
    }
  }

  if (!business.phone) {
    breakdown.noPhone = SCORE_POLICY.noPhone.points;
  }

  // === LAYER 2: Google Profile Quality ===

  if (business.photoCount < SCORE_POLICY.fewPhotos.photoCountThreshold) {
    breakdown.fewPhotos = SCORE_POLICY.fewPhotos.points;
  }

  const reviewCount = business.reviewCount || 0;
  if (reviewCount < SCORE_POLICY.lowReviews.lowReviewCountThreshold) {
    breakdown.lowReviews = SCORE_POLICY.lowReviews.lowPoints;
  } else if (reviewCount < SCORE_POLICY.lowReviews.moderateReviewCountThreshold) {
    breakdown.lowReviews = SCORE_POLICY.lowReviews.moderatePoints;
  }

  const rating = business.rating || 0;
  if (
    rating >= SCORE_POLICY.hiddenGem.minimumRating &&
    reviewCount < SCORE_POLICY.hiddenGem.reviewCountThreshold
  ) {
    breakdown.hiddenGem = SCORE_POLICY.hiddenGem.points;
  }

  // === LAYER 3: Website Technical ===
  // Only apply if business HAS a website (not social-only)

  const hasRealWebsite = business.website && !isSocialProfileUrl(business.website);

  if (hasRealWebsite) {
    if (business.websiteAnalysis && !business.websiteAnalysis.hasErrors) {
      const analysis = business.websiteAnalysis;

      if (analysis.performanceScore < SCORE_POLICY.poorPerformance.performanceThreshold) {
        breakdown.poorPerformance = SCORE_POLICY.poorPerformance.points;
      }

      if (!analysis.isMobileFriendly) {
        breakdown.notMobileFriendly = SCORE_POLICY.notMobileFriendly.points;
      }

      if (!analysis.isHttps) {
        breakdown.noHttps = SCORE_POLICY.noHttps.points;
      }
    } else if (business.scrapedData && business.scrapedData.isReachable) {
      // Fallback to scraped data if no PageSpeed analysis
      if (!business.scrapedData.hasMobileViewport) {
        breakdown.notMobileFriendly = SCORE_POLICY.notMobileFriendly.points;
      }
      if (!business.scrapedData.isHttps) {
        breakdown.noHttps = SCORE_POLICY.noHttps.points;
      }
    } else {
      // Website exists but couldn't be analyzed - assume issues
      breakdown.poorPerformance = SCORE_POLICY.poorPerformance.unavailablePoints;
    }
  }

  // === LAYER 4: Website Opportunities ===
  // Only apply if business HAS a real website we could scrape

  if (hasRealWebsite && business.scrapedData && business.scrapedData.isReachable) {
    const scraped = business.scrapedData;

    // Outdated website
    if (scraped.estimatedAge === 'outdated' || scraped.estimatedAge === 'ancient') {
      breakdown.outdatedWebsite = SCORE_POLICY.outdatedWebsite.points;
    }

    // No online booking for service businesses (only if not already counted above)
    if (bookingScored && !scraped.hasOnlineBooking && breakdown.noOnlineBooking === 0) {
      breakdown.noOnlineBooking = SCORE_POLICY.noOnlineBooking.points;
    }

    // No social links on website
    if (scraped.socialCount === 0) {
      breakdown.noSocialLinks = SCORE_POLICY.noSocialLinks.points;
    }

    // Basic tech stack (old WordPress, plain HTML, no modern framework)
    const hasModernTech = scraped.techStack.some((t) =>
      ['React', 'Vue', 'Angular', 'TailwindCSS', 'Shopify', 'Webflow'].includes(t)
    );
    const isBasicWordPress = scraped.hasWordPress && !scraped.hasModernDesign;
    const isPlainHtml =
      scraped.techStack.length === 0 ||
      (scraped.techStack.length === 1 && scraped.techStack[0] === 'jQuery');

    if (!hasModernTech && (isBasicWordPress || isPlainHtml)) {
      breakdown.basicTechStack = SCORE_POLICY.basicTechStack.points;
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
      breakdown.noViewport = SCORE_POLICY.noViewport.points;
      qualityChipCandidates.push({
        label: 'No mobile viewport',
        pts: SCORE_POLICY.noViewport.points,
      });
    }

    if (q) {
      if (q.hasTableLayout) {
        breakdown.tableLayout = SCORE_POLICY.tableLayout.points;
        qualityChipCandidates.push({
          label: 'Table-based layout',
          pts: SCORE_POLICY.tableLayout.points,
        });
      }
      if (
        q.wordCount >= SCORE_POLICY.thinContent.minimumMeasuredWordCount &&
        q.wordCount < SCORE_POLICY.thinContent.wordCountThreshold
      ) {
        breakdown.thinContent = SCORE_POLICY.thinContent.points;
        qualityChipCandidates.push({
          label: `Only ${q.wordCount} words`,
          pts: SCORE_POLICY.thinContent.points,
        });
      }
      if (q.hasDeprecatedTags) {
        breakdown.deprecatedTags = SCORE_POLICY.deprecatedTags.points;
        const tag = q.deprecatedTagsFound[0] || 'deprecated tags';
        qualityChipCandidates.push({
          label: `Uses ${tag}`,
          pts: SCORE_POLICY.deprecatedTags.points,
        });
      }
      if (q.templateFingerprint) {
        breakdown.templateFingerprint = SCORE_POLICY.templateFingerprint.points;
        qualityChipCandidates.push({
          label: `${q.templateFingerprint} template`,
          pts: SCORE_POLICY.templateFingerprint.points,
        });
      }
      if (!q.hasAnyForm) {
        breakdown.noForm = SCORE_POLICY.noForm.points;
        qualityChipCandidates.push({
          label: 'No contact form',
          pts: SCORE_POLICY.noForm.points,
        });
      }
      if (q.hasFixedPixelWidth) {
        breakdown.fixedPixelWidth = SCORE_POLICY.fixedPixelWidth.points;
        qualityChipCandidates.push({
          label: 'Fixed pixel widths',
          pts: SCORE_POLICY.fixedPixelWidth.points,
        });
      }
      if (q.isOldJquery) {
        breakdown.outdatedJquery = SCORE_POLICY.outdatedJquery.points;
        qualityChipCandidates.push({
          label: `jQuery ${q.jqueryVersion}`,
          pts: SCORE_POLICY.outdatedJquery.points,
        });
      }
      if (!q.hasSchemaOrg) {
        breakdown.noSchemaOrg = SCORE_POLICY.noSchemaOrg.points;
        qualityChipCandidates.push({
          label: 'No schema.org data',
          pts: SCORE_POLICY.noSchemaOrg.points,
        });
      }
      if (!q.hasOpenGraph) {
        breakdown.noOpenGraph = SCORE_POLICY.noOpenGraph.points;
        qualityChipCandidates.push({
          label: 'No Open Graph tags',
          pts: SCORE_POLICY.noOpenGraph.points,
        });
      }
      if (!q.hasLangAttribute) {
        breakdown.noLangAttribute = SCORE_POLICY.noLangAttribute.points;
        qualityChipCandidates.push({
          label: 'Missing <html lang>',
          pts: SCORE_POLICY.noLangAttribute.points,
        });
      }
    }
  }

  // PageSpeed-based signals — apply whenever we have analysis for a real site.
  if (hasRealWebsite && business.websiteAnalysis && !business.websiteAnalysis.hasErrors) {
    const a = business.websiteAnalysis;
    if (
      typeof a.accessibilityScore === 'number' &&
      a.accessibilityScore < SCORE_POLICY.lowAccessibility.scoreThreshold
    ) {
      breakdown.lowAccessibility = SCORE_POLICY.lowAccessibility.points;
      qualityChipCandidates.push({
        label: `Accessibility ${a.accessibilityScore}`,
        pts: SCORE_POLICY.lowAccessibility.points,
      });
    }
    if (typeof a.seoScore === 'number' && a.seoScore < SCORE_POLICY.lowSeo.scoreThreshold) {
      breakdown.lowSeo = SCORE_POLICY.lowSeo.points;
      qualityChipCandidates.push({
        label: `SEO ${a.seoScore}`,
        pts: SCORE_POLICY.lowSeo.points,
      });
    }
    if (
      typeof a.bestPracticesScore === 'number' &&
      a.bestPracticesScore < SCORE_POLICY.lowBestPractices.scoreThreshold
    ) {
      breakdown.lowBestPractices = SCORE_POLICY.lowBestPractices.points;
      qualityChipCandidates.push({
        label: `Best practices ${a.bestPracticesScore}`,
        pts: SCORE_POLICY.lowBestPractices.points,
      });
    }
    if (
      typeof a.largestContentfulPaint === 'number' &&
      a.largestContentfulPaint > SCORE_POLICY.slowLcp.millisecondsThreshold
    ) {
      breakdown.slowLcp = SCORE_POLICY.slowLcp.points;
      qualityChipCandidates.push({
        label: `LCP ${(a.largestContentfulPaint / 1000).toFixed(1)}s`,
        pts: SCORE_POLICY.slowLcp.points,
      });
    }
    if (
      typeof a.cumulativeLayoutShift === 'number' &&
      a.cumulativeLayoutShift > SCORE_POLICY.highCls.threshold
    ) {
      breakdown.highCls = SCORE_POLICY.highCls.points;
      qualityChipCandidates.push({
        label: `CLS ${a.cumulativeLayoutShift.toFixed(2)}`,
        pts: SCORE_POLICY.highCls.points,
      });
    }
  }

  // Highest-value triggered signals are shown on cards and quoted in sales email.
  breakdown.qualityChips = qualityChipCandidates
    .sort((a, b) => b.pts - a.pts)
    .slice(0, SCORE_POLICY.qualityChips.limit)
    .map((c) => c.label);

  // === MARKETING INTELLIGENCE (informational, not scored) ===
  if (business.scrapedData && 'hasMarketingBudget' in business.scrapedData) {
    breakdown.hasMarketingBudget = business.scrapedData.hasMarketingBudget;
    breakdown.marketingPlatforms = business.scrapedData.marketingSignals?.detectedPlatforms || [];
  }

  // === DEMAND / TRAFFIC SIGNAL (informational, not scored) ===
  // Need points remain independent; this profile only describes review-based evidence.
  const demandProfile = createDemandEvidenceProfile(reviewCount, business.rating);
  breakdown.demandSignal = demandProfile.displaySignal;
  breakdown.demandReasonCode = demandProfile.reasonCode;
  breakdown.demandLabel = formatDemandEvidenceLabel(demandProfile);

  breakdown.rawTotal = calculateScoreBreakdownRawTotal(breakdown);
  breakdown.total = calculateScoreBreakdownTotal(breakdown);

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
