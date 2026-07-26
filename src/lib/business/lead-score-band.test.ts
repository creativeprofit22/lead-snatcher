import { describe, expect, test } from 'vitest';

import { getLeadScoreBand, LEAD_SCORE_BAND_LABELS } from './lead-score-band';

describe('getLeadScoreBand', () => {
  test.each([
    [34, 'cold'],
    [35, 'mid'],
    [54, 'mid'],
    [55, 'hot'],
  ] as const)('classifies a score of %i as %s', (score, expectedBand) => {
    expect(getLeadScoreBand(score)).toBe(expectedBand);
  });

  test('uses canonical user-facing labels for each internal band', () => {
    expect(LEAD_SCORE_BAND_LABELS).toEqual({ hot: 'Hot', mid: 'Warm', cold: 'Cold' });
  });
});
