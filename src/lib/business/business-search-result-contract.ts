import { z } from 'zod';
import type { BusinessSearchResult } from '@/types';
import { industryTypeSchema } from '@/lib/validations';
import {
  LEAD_SCORE_MAX,
  LEAD_SCORE_MIN,
  normalizeLeadScore,
  scoreBreakdownSchema,
} from './score-breakdown-contract';

/** Runtime contract shared by live search responses and durable search snapshots. */
export const businessSearchResultSchema: z.ZodType<BusinessSearchResult> = z
  .object({
    placeId: z.string(),
    name: z.string(),
    photoCount: z.number(),
    types: z.array(z.string()),
    socialLinks: z.record(z.string(), z.string()).optional().default({}),
    contactPoints: z.number(),
    leadScore: z.number().int().min(LEAD_SCORE_MIN).max(LEAD_SCORE_MAX),
    scoreBreakdown: scoreBreakdownSchema,
    opportunities: z.array(z.string()),
    industryType: industryTypeSchema,
  })
  .passthrough();

/** Durable-result contract that normalizes scores written by the legacy uncapped scorer. */
export const persistedBusinessSearchResultSchema: z.ZodType<BusinessSearchResult> = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

    const fields = value as Record<string, unknown>;
    const leadScore = fields.leadScore;
    if (typeof leadScore !== 'number' || !Number.isInteger(leadScore)) return value;

    return { ...fields, leadScore: normalizeLeadScore(leadScore) };
  },
  businessSearchResultSchema
);
