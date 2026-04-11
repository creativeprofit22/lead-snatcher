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
}

export interface BudgetEstimate {
  min: number;
  max: number;
  label: string;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

/**
 * Estimate potential budget a business could afford for digital services
 */
export function estimateBudget(input: BudgetInput): BudgetEstimate {
  const reasons: string[] = [];
  let budgetPoints = 0;

  // Area quality (0-40 points)
  if (input.areaScore >= 75) {
    budgetPoints += 40;
    reasons.push('Located in a premium commercial zone');
  } else if (input.areaScore >= 50) {
    budgetPoints += 25;
    reasons.push('Located in an active commercial area');
  } else if (input.areaScore >= 25) {
    budgetPoints += 12;
    reasons.push('Located in a moderate commercial area');
  } else {
    budgetPoints += 5;
    reasons.push('Located in a developing area');
  }

  // Revenue signal from reviews (0-25 points)
  if (input.revenueSignal === 'high') {
    budgetPoints += 25;
    reasons.push(`High traffic business (${input.reviewCount}+ reviews)`);
  } else if (input.revenueSignal === 'medium') {
    budgetPoints += 15;
    reasons.push('Established business with steady traffic');
  } else {
    budgetPoints += 5;
  }

  // Marketing budget signal (0-20 points)
  if (input.hasMarketingBudget) {
    budgetPoints += 20;
    reasons.push('Already investing in paid advertising');
  }

  // Has website = has spent on digital before (0-10 points)
  if (input.hasWebsite) {
    budgetPoints += 10;
    reasons.push('Already invested in a website');
  } else {
    reasons.push('No website — first-time digital investment');
  }

  // Contact points as engagement signal (0-5 points)
  if (input.contactPoints >= 4) {
    budgetPoints += 5;
    reasons.push('Multiple contact channels active');
  }

  // Convert points (0-100) to budget range
  let min: number;
  let max: number;
  let confidence: BudgetEstimate['confidence'];

  if (budgetPoints >= 75) {
    min = 5000;
    max = 15000;
    confidence = 'high';
  } else if (budgetPoints >= 55) {
    min = 3000;
    max = 7000;
    confidence = 'high';
  } else if (budgetPoints >= 40) {
    min = 1500;
    max = 4000;
    confidence = 'medium';
  } else if (budgetPoints >= 25) {
    min = 500;
    max = 2000;
    confidence = 'medium';
  } else {
    min = 200;
    max = 1000;
    confidence = 'low';
  }

  const label = formatBudgetLabel(min, max);

  return { min, max, label, confidence, reasons };
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
  areaLevel: string
): BudgetInput {
  return {
    areaScore,
    areaLevel,
    reviewCount,
    hasMarketingBudget: breakdown.hasMarketingBudget,
    hasWebsite,
    contactPoints,
    revenueSignal: breakdown.revenueSignal,
  };
}
