import { describe, expect, test } from 'vitest';
import {
  SCORE_BREAKDOWN_INFORMATIONAL_KEYS,
  SCORE_BREAKDOWN_SCORED_KEYS,
  calculateScoreBreakdownRawTotal,
  calculateScoreBreakdownTotal,
  createScoreBreakdown,
  normalizeLeadScore,
  scoreBreakdownSchema,
} from './score-breakdown-contract';

describe('score breakdown contract', () => {
  test('creates complete, independent defaults from the canonical fields', () => {
    const first = createScoreBreakdown();
    const second = createScoreBreakdown();

    expect(SCORE_BREAKDOWN_SCORED_KEYS.every((key) => first[key] === 0)).toBe(true);
    expect(SCORE_BREAKDOWN_INFORMATIONAL_KEYS).toEqual([
      'qualityChips',
      'hasMarketingBudget',
      'marketingPlatforms',
      'demandSignal',
      'demandReasonCode',
      'demandLabel',
    ]);
    expect(first).toMatchObject({
      qualityChips: [],
      hasMarketingBudget: false,
      marketingPlatforms: [],
      demandSignal: 'low',
      demandReasonCode: 'no_review_evidence',
      demandLabel: '',
      rawTotal: 0,
      total: 0,
    });
    expect(first.qualityChips).not.toBe(second.qualityChips);
    expect(first.marketingPlatforms).not.toBe(second.marketingPlatforms);
  });

  test.each([
    [99, 99],
    [100, 100],
    [101, 100],
  ])('normalizes %i signal points to a %i public score', (rawTotal, total) => {
    const breakdown = createScoreBreakdown({ noWebsite: rawTotal });

    expect(calculateScoreBreakdownRawTotal(breakdown)).toBe(rawTotal);
    expect(calculateScoreBreakdownTotal(breakdown)).toBe(total);
    expect(normalizeLeadScore(rawTotal)).toBe(total);
    expect(breakdown).toMatchObject({ rawTotal, total });
  });

  test('normalizes runtime input with defaults and recalculated totals', () => {
    expect(scoreBreakdownSchema.parse({ noWebsite: 120, rawTotal: 999, total: 999 })).toMatchObject(
      {
        noWebsite: 120,
        socialOnlyWebsite: 0,
        qualityChips: [],
        demandSignal: 'low',
        demandReasonCode: 'no_review_evidence',
        rawTotal: 120,
        total: 100,
      }
    );
  });

  test('migrates legacy revenue display fields to demand terminology', () => {
    expect(
      scoreBreakdownSchema.parse({
        revenueSignal: 'high',
        revenueLabel: 'Legacy display label',
      })
    ).toMatchObject({
      demandSignal: 'high',
      demandLabel: 'Legacy display label',
    });
  });
});
