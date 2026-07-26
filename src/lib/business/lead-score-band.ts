export const LEAD_SCORE_THRESHOLDS = {
  hot: 55,
  mid: 35,
} as const;

export type LeadScoreBand = 'hot' | 'mid' | 'cold';

export const LEAD_SCORE_BAND_LABELS = {
  hot: 'Hot',
  mid: 'Warm',
  cold: 'Cold',
} as const satisfies Record<LeadScoreBand, string>;

export function getLeadScoreBand(leadScore: number): LeadScoreBand {
  if (leadScore >= LEAD_SCORE_THRESHOLDS.hot) return 'hot';
  if (leadScore >= LEAD_SCORE_THRESHOLDS.mid) return 'mid';
  return 'cold';
}
