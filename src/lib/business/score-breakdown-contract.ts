import { z } from 'zod';
import { DEMAND_REASON_CODES } from './revenue-profile';

const scoredFieldSchemas = {
  // Basic [REDACTED] opportunities.
  noWebsite: z.number().default(0),
  socialOnlyWebsite: z.number().default(0),
  noPhone: z.number().default(0),

  // Google Business Profile quality signals.
  fewPhotos: z.number().default(0),
  lowReviews: z.number().default(0),
  hiddenGem: z.number().default(0),

  // Website technical signals.
  poorPerformance: z.number().default(0),
  notMobileFriendly: z.number().default(0),
  noHttps: z.number().default(0),

  // Website opportunity signals.
  outdatedWebsite: z.number().default(0),
  noOnlineBooking: z.number().default(0),
  noSocialLinks: z.number().default(0),
  basicTechStack: z.number().default(0),

  // Deep website-quality signals from HTML and PageSpeed analysis.
  noViewport: z.number().default(0),
  tableLayout: z.number().default(0),
  thinContent: z.number().default(0),
  deprecatedTags: z.number().default(0),
  templateFingerprint: z.number().default(0),
  noForm: z.number().default(0),
  fixedPixelWidth: z.number().default(0),
  outdatedJquery: z.number().default(0),
  noSchemaOrg: z.number().default(0),
  noOpenGraph: z.number().default(0),
  noLangAttribute: z.number().default(0),
  lowAccessibility: z.number().default(0),
  lowSeo: z.number().default(0),
  lowBestPractices: z.number().default(0),
  slowLcp: z.number().default(0),
  highCls: z.number().default(0),
};

const informationalFieldSchemas = {
  /** Human-readable summaries of the highest-value website-quality signals. */
  qualityChips: z.array(z.string()).default(() => []),
  /** Whether detected advertising signals suggest an active marketing budget. */
  hasMarketingBudget: z.boolean().default(false),
  /** Advertising and analytics platforms detected on the website. */
  marketingPlatforms: z.array(z.string()).default(() => []),
  /** Coarse demand/traffic signal derived from both review volume and rating quality. */
  demandSignal: z.enum(['high', 'medium', 'low']).default('low'),
  /** Stable code identifying the demand evidence behind the display signal. */
  demandReasonCode: z.enum(DEMAND_REASON_CODES).default('no_review_evidence'),
  /** Human-readable explanation of the review-based demand/traffic evidence. */
  demandLabel: z.string().default(''),
};

function keysOf<const Shape extends Record<string, unknown>>(shape: Shape) {
  return Object.freeze(Object.keys(shape)) as ReadonlyArray<keyof Shape>;
}

/** Canonical fields included in the lead-score total. */
export const SCORE_BREAKDOWN_SCORED_KEYS = keysOf(scoredFieldSchemas);

/** Canonical fields retained for display but excluded from the lead-score total. */
export const SCORE_BREAKDOWN_INFORMATIONAL_KEYS = keysOf(informationalFieldSchemas);

const scoreBreakdownObjectSchema = z.object({
  ...scoredFieldSchemas,
  ...informationalFieldSchemas,
  /** Sum of every canonical scored field before the public score cap is applied. */
  rawTotal: z.number().default(0),
  /** Public lead score normalized to the inclusive 0-100 range. */
  total: z.number().default(0),
});

const scoreBreakdownFieldsSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const fields = value as Record<string, unknown>;
  return {
    ...fields,
    demandSignal: fields.demandSignal ?? fields.revenueSignal,
    demandLabel: fields.demandLabel ?? fields.revenueLabel,
  };
}, scoreBreakdownObjectSchema);

type ScoreBreakdownFields = z.infer<typeof scoreBreakdownFieldsSchema>;

function sumScoredFields(breakdown: Pick<ScoreBreakdownFields, ScoreBreakdownScoredKey>): number {
  return SCORE_BREAKDOWN_SCORED_KEYS.reduce((total, key) => total + breakdown[key], 0);
}

export const LEAD_SCORE_MIN = 0;
export const LEAD_SCORE_MAX = 100;

/** Normalize a signal-point total to the public lead-score range. */
export function normalizeLeadScore(rawTotal: number): number {
  return Math.max(LEAD_SCORE_MIN, Math.min(LEAD_SCORE_MAX, rawTotal));
}

export const scoreBreakdownSchema = scoreBreakdownFieldsSchema.transform((breakdown) => {
  const rawTotal = sumScoredFields(breakdown);

  return {
    ...breakdown,
    rawTotal,
    total: normalizeLeadScore(rawTotal),
  };
});

export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type ScoreBreakdownScoredKey = (typeof SCORE_BREAKDOWN_SCORED_KEYS)[number];
export type ScoreBreakdownInformationalKey = (typeof SCORE_BREAKDOWN_INFORMATIONAL_KEYS)[number];

/** Sum the canonical scored fields without normalizing or capping the result. */
export function calculateScoreBreakdownRawTotal(
  breakdown: Pick<ScoreBreakdown, ScoreBreakdownScoredKey>
): number {
  return sumScoredFields(breakdown);
}

/** Calculate the normalized public total from every canonical scored field. */
export function calculateScoreBreakdownTotal(
  breakdown: Pick<ScoreBreakdown, ScoreBreakdownScoredKey>
): number {
  return normalizeLeadScore(calculateScoreBreakdownRawTotal(breakdown));
}

/** Create a complete score breakdown with fresh defaults and derived totals. */
export function createScoreBreakdown(
  overrides: Partial<Omit<ScoreBreakdown, 'rawTotal' | 'total'>> = {}
): ScoreBreakdown {
  return scoreBreakdownSchema.parse(overrides);
}
