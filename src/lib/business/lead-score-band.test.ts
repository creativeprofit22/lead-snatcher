import { describe, expect, test } from 'vitest';

import { getLeadScoreBand } from './lead-score-band';

describe('getLeadScoreBand', () => {
  test.each([
    [34, 'cold'],
    [35, 'mid'],
    [54, 'mid'],
    [55, 'hot'],
  ] as const)('classifies a score of %i as %s', (score, expectedBand) => {
    expect(getLeadScoreBand(score)).toBe(expectedBand);
  });
});
