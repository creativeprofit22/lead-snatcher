import { describe, expect, test } from 'vitest';

import type { BudgetEstimate } from './budget-contract';
import { buildBudgetInput, computeFitScore, estimateBudget } from './budget-estimate';
import type { BudgetInput } from './budget-estimate';

type BudgetTierExpectation = Pick<
  BudgetEstimate,
  'points' | 'min' | 'max' | 'label' | 'confidence'
>;

const boundaryCases: Array<{
  name: string;
  input: BudgetInput;
  expected: BudgetTierExpectation;
}> = [
  {
    name: '24 points, immediately below the $500 tier',
    input: {
      areaScore: 25,
      reviewCount: 0,
      hasMarketingBudget: true,
      hasWebsite: true,
      contactPoints: 0,
    },
    expected: {
      points: 24,
      min: 200,
      max: 1_000,
      label: '$200 - $1K',
      confidence: 'low',
    },
  },
  {
    name: '25 points, at the $500 tier boundary',
    input: {
      reviewCount: 0,
      hasMarketingBudget: false,
      hasWebsite: false,
      contactPoints: 0,
      priceLevel: 4,
    },
    expected: {
      points: 25,
      min: 500,
      max: 2_000,
      label: '$500 - $2K',
      confidence: 'medium',
    },
  },
  {
    name: '39 points, immediately below the $1.5K tier',
    input: {
      areaScore: 0,
      reviewCount: 0,
      hasMarketingBudget: true,
      hasWebsite: true,
      contactPoints: 0,
      priceLevel: 3,
    },
    expected: {
      points: 39,
      min: 500,
      max: 2_000,
      label: '$500 - $2K',
      confidence: 'medium',
    },
  },
  {
    name: '40 points, at the $1.5K tier boundary',
    input: {
      areaScore: 50,
      reviewCount: 0,
      hasMarketingBudget: true,
      hasWebsite: false,
      contactPoints: 0,
      priceLevel: 2,
    },
    expected: {
      points: 40,
      min: 1_500,
      max: 4_000,
      label: '$1.5K - $4K',
      confidence: 'medium',
    },
  },
  {
    name: '54 points, immediately below the $3K tier',
    input: {
      areaScore: 50,
      reviewCount: 0,
      hasMarketingBudget: true,
      hasWebsite: true,
      contactPoints: 4,
      priceLevel: 3,
    },
    expected: {
      points: 54,
      min: 1_500,
      max: 4_000,
      label: '$1.5K - $4K',
      confidence: 'medium',
    },
  },
  {
    name: '55 points, at the $3K tier boundary',
    input: {
      areaScore: 75,
      reviewCount: 1,
      hasMarketingBudget: false,
      hasWebsite: true,
      contactPoints: 4,
      priceLevel: 4,
    },
    expected: {
      points: 55,
      min: 3_000,
      max: 7_000,
      label: '$3K - $7K',
      confidence: 'high',
    },
  },
  {
    name: '74 points, immediately below the $5K tier',
    input: {
      areaScore: 75,
      reviewCount: 30,
      hasMarketingBudget: true,
      hasWebsite: true,
      contactPoints: 4,
      priceLevel: 4,
    },
    expected: {
      points: 74,
      min: 3_000,
      max: 7_000,
      label: '$3K - $7K',
      confidence: 'high',
    },
  },
  {
    name: '75 points, at the $5K tier boundary',
    input: {
      areaScore: 75,
      reviewCount: 49,
      hasMarketingBudget: true,
      hasWebsite: true,
      contactPoints: 4,
      priceLevel: 4,
    },
    expected: {
      points: 75,
      min: 5_000,
      max: 15_000,
      label: '$5K - $15K',
      confidence: 'high',
    },
  },
];

describe('estimateBudget tiers', () => {
  test.each(boundaryCases)('$name', ({ input, expected }) => {
    expect(estimateBudget(input)).toMatchObject(expected);
  });

  test('builds estimator input from named fields and maps marketing evidence', () => {
    expect(
      buildBudgetInput({
        breakdown: { hasMarketingBudget: true },
        areaScore: 50,
        reviewCount: 10,
        rating: 4.5,
        hasWebsite: true,
        contactPoints: 3,
        priceLevel: 2,
        zoneArchetype: 'corporate',
        businessTypes: ['accounting'],
        businessName: 'Example Co',
      })
    ).toEqual({
      areaScore: 50,
      reviewCount: 10,
      rating: 4.5,
      hasWebsite: true,
      contactPoints: 3,
      priceLevel: 2,
      zoneArchetype: 'corporate',
      businessTypes: ['accounting'],
      businessName: 'Example Co',
      hasMarketingBudget: true,
    });
  });
});

describe('estimateBudget demand evidence', () => {
  test.each([
    [49, 0, 10, undefined],
    [49, 3.9, 8, undefined],
    [49, 4.0, 10, undefined],
    [49, 4.5, 10, undefined],
    [49, 4.6, 12, undefined],
    [50, 0, 10, '50 reviews: established traffic; rating unavailable'],
    [50, 3.9, 8, '50 reviews · 3.9★: established traffic with rating drag'],
    [50, 4.0, 10, '50 reviews · 4.0★: established traffic'],
    [50, 4.5, 10, '50 reviews · 4.5★: established traffic'],
    [50, 4.6, 12, '50 reviews · 4.6★: boutique demand signal'],
    [199, 0, 14, '199 reviews: established traffic; rating unavailable'],
    [199, 3.9, 10, '199 reviews · 3.9★: established traffic with rating drag'],
    [199, 4.0, 14, '199 reviews · 4.0★: established traffic'],
    [199, 4.5, 14, '199 reviews · 4.5★: established traffic'],
    [199, 4.6, 17, '199 reviews · 4.6★: boutique demand signal'],
    [200, 0, 14, '200 reviews: high traffic; rating unavailable'],
    [200, 3.9, 10, '200 reviews · 3.9★: high traffic with rating drag'],
    [200, 4.0, 14, '200 reviews · 4.0★: high traffic signal'],
    [200, 4.5, 14, '200 reviews · 4.5★: high traffic signal'],
    [200, 4.6, 17, '200 reviews · 4.6★: high traffic signal'],
    [499, 0, 16, '499 reviews: high traffic; rating unavailable'],
    [499, 3.9, 12, '499 reviews · 3.9★: high traffic with rating drag'],
    [499, 4.0, 16, '499 reviews · 4.0★: high traffic signal'],
    [499, 4.5, 16, '499 reviews · 4.5★: high traffic signal'],
    [499, 4.6, 19, '499 reviews · 4.6★: high traffic signal'],
    [500, 0, 16, '500 reviews: sustained traffic; rating unavailable'],
    [500, 3.9, 12, '500 reviews · 3.9★: sustained traffic with rating drag'],
    [500, 4.0, 16, '500 reviews · 4.0★: sustained traffic'],
    [500, 4.5, 16, '500 reviews · 4.5★: sustained premium demand'],
    [500, 4.6, 19, '500 reviews · 4.6★: sustained premium demand'],
  ] as const)(
    'keeps capacity math independent at %i reviews and %f stars',
    (reviewCount, rating, points, demandReason) => {
      const estimate = estimateBudget({
        reviewCount,
        rating,
        hasMarketingBudget: false,
        hasWebsite: false,
        contactPoints: 0,
      });

      expect(estimate.points).toBe(points);
      expect(estimate.reasons.find((reason) => reason.includes('reviews'))).toBe(demandReason);
    }
  );
});

describe('estimateBudget low-margin gating', () => {
  test.each([
    ['a low-margin place type', { businessTypes: ['fast_food_restaurant'] as string[] }],
    ['a low-margin business-name tell', { businessName: "Bob's Kebab House" }],
  ] as const)('blocks the luxury-zone backstop for %s', (_name, lowMarginSignal) => {
    const commonInput = {
      zoneArchetype: 'luxury' as const,
      reviewCount: 0,
      rating: 0,
      hasMarketingBudget: false,
      hasWebsite: false,
      contactPoints: 0,
    };

    expect(estimateBudget(commonInput)).toMatchObject({
      points: 18,
      reasons: [
        'Located in a luxury-retail district (price proxy)',
        'No website — first-time digital investment',
      ],
    });
    expect(estimateBudget({ ...commonInput, ...lowMarginSignal })).toMatchObject({
      points: 7,
      reasons: [
        'Low-margin business type — budget pricing ($)',
        'No website — first-time digital investment',
      ],
    });
  });
});

describe('computeFitScore', () => {
  test.each([
    { leadScore: -20, budgetPoints: 50, expected: 0 },
    { leadScore: 99, budgetPoints: 100, expected: 99 },
    { leadScore: 100, budgetPoints: -50, expected: 40 },
    { leadScore: 50, budgetPoints: 50, expected: 35 },
    { leadScore: 120, budgetPoints: 120, expected: 100 },
  ])(
    'normalizes lead $leadScore and budget $budgetPoints to produce $expected',
    ({ leadScore, budgetPoints, expected }) => {
      expect(computeFitScore(leadScore, budgetPoints)).toBe(expected);
    }
  );
});
