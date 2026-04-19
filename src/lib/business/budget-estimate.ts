/**
 * Budget Estimation
 *
 * Estimates how much a business could potentially afford to pay
 * for digital services, based on area quality + individual signals.
 *
 * No LLM needed — just signal math.
 */

import type { ScoreBreakdown } from '@/types';

interface BudgetInput {
  areaScore: number; // 0-100 from Overpass
  areaLevel: string; // premium, commercial, moderate, developing
  reviewCount: number;
  hasMarketingBudget: boolean;
  hasWebsite: boolean;
  contactPoints: number;
  revenueSignal: 'high' | 'medium' | 'low';
  /** Google-style price tier, 0-4. Single strongest income proxy when present. */
  priceLevel?: number;
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

  // Price tier — strong income proxy when available (0-25 points).
  if (typeof input.priceLevel === 'number') {
    const priceMap = [0, 7, 14, 20, 25];
    const pricePoints = priceMap[input.priceLevel] ?? 0;
    budgetPoints += pricePoints;
    const labels = ['Free / non-commercial', 'Budget pricing ($)', 'Mid-range pricing ($$)', 'Upscale pricing ($$$)', 'Premium pricing ($$$$)'];
    if (input.priceLevel >= 1) {
      reasons.push(labels[input.priceLevel]);
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

  // Revenue signal from reviews (0-15 points)
  if (input.revenueSignal === 'high') {
    budgetPoints += 15;
    reasons.push(`High traffic business (${input.reviewCount}+ reviews)`);
  } else if (input.revenueSignal === 'medium') {
    budgetPoints += 9;
    reasons.push('Established business with steady traffic');
  } else {
    budgetPoints += 3;
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
  priceLevel?: number
): BudgetInput {
  return {
    areaScore,
    areaLevel,
    reviewCount,
    hasMarketingBudget: breakdown.hasMarketingBudget,
    hasWebsite,
    contactPoints,
    revenueSignal: breakdown.revenueSignal,
    priceLevel,
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
