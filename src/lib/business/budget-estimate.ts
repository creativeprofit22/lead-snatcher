/**
 * Budget Estimation
 *
 * Estimates how much a business could potentially afford to pay
 * for digital services, based on area quality + individual signals.
 *
 * No LLM needed — just signal math.
 */

import type { ScoreBreakdown } from '@/types';
import type { ZoneArchetype } from './zone-grid';

interface BudgetInput {
  areaScore: number; // 0-100 from Overpass
  areaLevel: string; // premium, commercial, moderate, developing
  reviewCount: number;
  /** Google rating 0-5. Combined with reviewCount for the revenue composite. */
  rating?: number;
  hasMarketingBudget: boolean;
  hasWebsite: boolean;
  contactPoints: number;
  /** Google-style price tier, 0-4. Single strongest income proxy when present. */
  priceLevel?: number;
  /** Zone archetype — used as a price-level backstop when Google priceLevel is absent. */
  zoneArchetype?: ZoneArchetype;
  /** Google place types — used to detect low-margin business types that shouldn't inherit neighborhood premium. */
  businessTypes?: string[];
  /** Business name — used as a secondary signal for low-margin tells (e.g. "kebab", "laundry") when types are generic. */
  businessName?: string;
}

/**
 * Google place types that identify inherently low-margin businesses.
 * A Mayfair kebab shop has a Mayfair postcode but a kebab-shop margin —
 * the neighborhood premium shouldn't override the business-level reality.
 * These terms are what RapidAPI's Maps provider and Google Places both
 * surface in the `types` array.
 */
const LOW_MARGIN_TYPES = new Set([
  'fast_food_restaurant',
  'meal_takeaway',
  'takeaway',
  'convenience_store',
  'liquor_store',
  'laundry',
  'dry_cleaning',
  'gas_station',
  'car_wash',
  'pawn_shop',
  'check_cashing',
  'vape_shop',
  'tanning_studio',
  // NB: salons/hair_care/nail_salon deliberately excluded. A Mayfair cut
  // can run £300 and a walk-in down the street is £15 — both tagged
  // identically by Google. Price tier for these is handled by the
  // quality gate on the zone backstop further down, not by type.
]);

/**
 * Name-level low-margin tells. Fallback when `types` lacks a specific
 * low-margin tag (e.g. "Bob's Kebabs" tagged only as "restaurant"). Kept
 * narrow to avoid false positives — only extremely common low-margin
 * descriptors that are unlikely to appear in a premium business name.
 */
const LOW_MARGIN_NAME_TELLS = [
  /\bkebab\b/i,
  /\btakeaway\b/i,
  /\btake[- ]?out\b/i,
  /\bfish\s*&\s*chips\b/i,
  /\blaundromat\b/i,
  /\bdry\s*clean(er)?s?\b/i,
  /\bvape\b/i,
];

function detectLowMargin(types?: string[], name?: string): boolean {
  if (types?.some((t) => LOW_MARGIN_TYPES.has(t))) return true;
  if (name && LOW_MARGIN_NAME_TELLS.some((re) => re.test(name))) return true;
  return false;
}

export interface BudgetEstimate {
  min: number;
  max: number;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  /** Raw 0-100 score the budget range was derived from. Used by Fit Score. */
  points: number;
}

/**
 * Estimate potential budget a business could afford for digital services
 */
export function estimateBudget(input: BudgetInput): BudgetEstimate {
  const reasons: string[] = [];
  let budgetPoints = 0;
  const isLowMargin = detectLowMargin(input.businessTypes, input.businessName);

  // Price tier — strongest single income proxy (0-25 pts). When Google
  // priceLevel is missing, fall back to the zone archetype so a boutique
  // in a luxury district still gets price credit from its neighborhood.
  //
  // Low-margin business types (kebab shops, laundromats, fast food) are
  // the exception: a cheap business in a rich postcode is still a cheap
  // business. Skip the zone backstop entirely, and if Google also didn't
  // provide a priceLevel, treat it as $ (level 1) — because the business
  // type itself is the price signal.
  if (typeof input.priceLevel === 'number') {
    const priceMap = [0, 7, 14, 20, 25];
    const pricePoints = priceMap[input.priceLevel] ?? 0;
    budgetPoints += pricePoints;
    const labels = [
      'Free / non-commercial',
      'Budget pricing ($)',
      'Mid-range pricing ($$)',
      'Upscale pricing ($$$)',
      'Premium pricing ($$$$)',
    ];
    if (input.priceLevel >= 1) {
      reasons.push(labels[input.priceLevel] ?? 'Known pricing tier');
    }
  } else if (isLowMargin) {
    // Force budget pricing regardless of neighborhood.
    budgetPoints += 7;
    reasons.push('Low-margin business type — budget pricing ($)');
  } else if (input.zoneArchetype) {
    // Quality-gated zone backstop. The neighborhood tier only transfers
    // to the business when the business itself shows signals that match.
    // A 3.9★ 80-review salon in Mayfair is a cheap walk-in with a fancy
    // postcode — it shouldn't inherit the luxury-district price premium.
    // Gate:
    //   rating ≥ 4.5  OR  unrated/new business   → full backstop
    //   rating 4.0-4.4 AND ≥50 reviews           → half backstop
    //   rating < 4.0 with ≥20 reviews            → zero backstop (quality drag)
    //   everything else                          → quarter backstop
    const archetypeBackstop: Record<ZoneArchetype, number> = {
      luxury: 18,
      corporate: 12,
      mixed: 9,
      developing: 3,
    };
    const basePts = archetypeBackstop[input.zoneArchetype];
    const rating = input.rating ?? 0;
    const reviews = Math.max(0, input.reviewCount);
    const unrated = rating === 0 && reviews < 20;

    let gate: number;
    if (rating >= 4.5 || unrated) gate = 1.0;
    else if (rating >= 4.0 && reviews >= 50) gate = 0.5;
    else if (rating > 0 && rating < 4.0 && reviews >= 20) gate = 0;
    else gate = 0.25;

    const pts = Math.round(basePts * gate);
    budgetPoints += pts;

    const tierLabel =
      input.zoneArchetype === 'luxury'
        ? 'luxury-retail district'
        : input.zoneArchetype === 'corporate'
          ? 'corporate/business district'
          : input.zoneArchetype === 'mixed'
            ? 'mixed commercial district'
            : 'developing area';

    if (gate >= 1.0 && pts > 0) {
      reasons.push(`Located in a ${tierLabel} (price proxy)`);
    } else if (gate >= 0.5) {
      reasons.push(
        `Located in a ${tierLabel}, but quality signals partial (${rating.toFixed(1)}★)`
      );
    } else if (gate === 0 && rating > 0) {
      reasons.push(
        `${tierLabel} address, but ${rating.toFixed(1)}★ rating suggests budget-tier operation`
      );
    } else if (pts > 0) {
      reasons.push(`${tierLabel} address — weak quality signals, neighborhood premium reduced`);
    }
  }

  // Area quality (0-20 points)
  if (input.areaScore >= 75) {
    budgetPoints += 20;
    reasons.push('Located in a premium commercial zone');
  } else if (input.areaScore >= 50) {
    budgetPoints += 14;
    reasons.push('Located in an active commercial area');
  } else if (input.areaScore >= 25) {
    budgetPoints += 7;
    reasons.push('Located in a moderate commercial area');
  } else {
    budgetPoints += 2;
    reasons.push('Located in a developing area');
  }

  // Revenue composite (0-20 pts) — volume curve × rating quality multiplier.
  // Replaces the old binary review-count tier. A 4.8★ boutique with 150
  // reviews now has a meaningful signal; a 3.8★ chain with 2K reviews gets
  // a quality drag instead of a flat "high traffic" tier. Volume saturates
  // around 2K reviews so a 500-review business isn't drowned by 5K-review
  // mega-chains.
  {
    const reviews = Math.max(0, input.reviewCount);
    const rating = input.rating ?? 0;
    // log10(n+1)*6: 0 at 0, ~12 at 100, ~16 at 500, ~18 at 1000, ~20 at 2000
    const volumeCurve = Math.min(20, Math.log10(reviews + 1) * 6);
    let qualityMult = 1.0;
    let qualityNote: string | null = null;
    if (rating >= 4.6) {
      qualityMult = 1.2;
      qualityNote = `${rating.toFixed(1)}★ quality premium`;
    } else if (rating >= 4.0 || rating === 0) {
      qualityMult = 1.0; // neutral — unrated businesses aren't punished
    } else {
      qualityMult = 0.75;
      qualityNote = `${rating.toFixed(1)}★ rating drag`;
    }
    const revenuePoints = Math.max(0, Math.min(20, Math.round(volumeCurve * qualityMult)));
    budgetPoints += revenuePoints;

    // Pick a single, legible reason line that captures the shape of the signal.
    if (reviews >= 500 && rating >= 4.5) {
      reasons.push(`${reviews} reviews @ ${rating.toFixed(1)}★ — sustained premium demand`);
    } else if (reviews >= 200) {
      reasons.push(`${reviews} reviews — high traffic, likely has budget`);
    } else if (reviews >= 50 && rating >= 4.6) {
      reasons.push(`${rating.toFixed(1)}★ on ${reviews} reviews — boutique demand signal`);
    } else if (reviews >= 50) {
      reasons.push(`${reviews} reviews — established traffic`);
    }
    if (qualityNote && reviews >= 50) reasons.push(qualityNote);
  }

  // Marketing budget signal (0-12 points)
  if (input.hasMarketingBudget) {
    budgetPoints += 12;
    reasons.push('Already investing in paid advertising');
  }

  // Has website = has spent on digital before (0-5 points)
  if (input.hasWebsite) {
    budgetPoints += 5;
    reasons.push('Already invested in a website');
  } else {
    reasons.push('No website — first-time digital investment');
  }

  // Contact points as engagement signal (0-3 points)
  if (input.contactPoints >= 4) {
    budgetPoints += 3;
    reasons.push('Multiple contact channels active');
  }

  // Clamp to 100 — the totals above sum to a max of 100.
  const points = Math.max(0, Math.min(100, budgetPoints));

  let min: number;
  let max: number;
  let confidence: BudgetEstimate['confidence'];

  if (points >= 75) {
    min = 5000;
    max = 15000;
    confidence = 'high';
  } else if (points >= 55) {
    min = 3000;
    max = 7000;
    confidence = 'high';
  } else if (points >= 40) {
    min = 1500;
    max = 4000;
    confidence = 'medium';
  } else if (points >= 25) {
    min = 500;
    max = 2000;
    confidence = 'medium';
  } else {
    min = 200;
    max = 1000;
    confidence = 'low';
  }

  const label = formatBudgetLabel(min, max);

  return { min, max, label, confidence, reasons, points };
}

function formatBudgetLabel(min: number, max: number): string {
  const fmt = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n}`);
  return `${fmt(min)} - ${fmt(max)}`;
}

/**
 * Build budget input from search result data + area score
 */
export function buildBudgetInput(
  breakdown: ScoreBreakdown,
  reviewCount: number,
  hasWebsite: boolean,
  contactPoints: number,
  areaScore: number,
  areaLevel: string,
  priceLevel?: number,
  rating?: number,
  zoneArchetype?: ZoneArchetype,
  businessTypes?: string[],
  businessName?: string
): BudgetInput {
  return {
    areaScore,
    areaLevel,
    reviewCount,
    rating,
    hasMarketingBudget: breakdown.hasMarketingBudget,
    hasWebsite,
    contactPoints,
    priceLevel,
    zoneArchetype,
    businessTypes,
    businessName,
  };
}

/**
 * Combine need (leadScore) with capacity (budget points) into a single
 * 0-100 ranking metric. Capacity gates need: a high-need business with
 * zero capacity keeps only 40% of its lead score.
 *
 *   capacity = 0   → fitScore = leadScore × 0.4
 *   capacity = 50  → fitScore = leadScore × 0.7
 *   capacity = 100 → fitScore = leadScore × 1.0
 */
export function computeFitScore(leadScore: number, budgetPoints: number): number {
  const need = Math.max(0, Math.min(100, leadScore));
  const capacity = Math.max(0, Math.min(100, budgetPoints));
  const multiplier = 0.4 + 0.6 * (capacity / 100);
  return Math.round(need * multiplier);
}
