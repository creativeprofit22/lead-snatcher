import { z } from 'zod';
import { industryTypeSchema, leadStatusSchema } from '@/lib/validations';
import type { IndustryType, LeadStatus } from '@/types';

export const LEAD_LIST_SORT_FIELDS = [
  'savedAt',
  'leadScore',
  'name',
  'status',
  'lastContactedAt',
  'nextFollowUpAt',
  'updatedAt',
] as const;

export const LEAD_LIST_UI_SORT_FIELDS = [
  'savedAt',
  'leadScore',
  'name',
  'nextFollowUpAt',
] as const satisfies readonly LeadListSortField[];

export const LEAD_LIST_FOLLOW_UP_FILTERS = ['all', 'today', 'overdue', 'this_week'] as const;

export type LeadListSortField = (typeof LEAD_LIST_SORT_FIELDS)[number];
export type LeadListUiSortField = (typeof LEAD_LIST_UI_SORT_FIELDS)[number];
export type LeadListSortOrder = 'asc' | 'desc';
export type LeadListFollowUp = (typeof LEAD_LIST_FOLLOW_UP_FILTERS)[number];

export interface LeadListQuery {
  statuses: LeadStatus[];
  industries: IndustryType[];
  tags: string[];
  minScore: number;
  maxScore: number;
  followUp: LeadListFollowUp;
  sortBy: LeadListSortField;
  sortOrder: LeadListSortOrder;
}

export type LeadListFilters = Omit<LeadListQuery, 'sortBy'> & {
  sortBy: LeadListUiSortField;
};

export const defaultLeadListQuery: LeadListFilters = {
  statuses: [],
  industries: [],
  tags: [],
  minScore: 0,
  maxScore: 100,
  followUp: 'all',
  sortBy: 'savedAt',
  sortOrder: 'desc',
};

const scoreSchema = (name: 'minScore' | 'maxScore') =>
  z
    .string()
    .regex(/^\d+$/, `${name} must be an integer`)
    .transform(Number)
    .pipe(
      z.number().int().min(0, `${name} must be at least 0`).max(100, `${name} must be at most 100`)
    );

const commaSeparatedStringsSchema = z
  .string()
  .transform((value) => value.split(',').map((item) => item.trim()));

const statusesSchema = commaSeparatedStringsSchema
  .pipe(z.array(leadStatusSchema).min(1, 'statuses must include at least one value'))
  .transform((statuses) => [...new Set(statuses)]);

const industriesSchema = commaSeparatedStringsSchema
  .pipe(z.array(industryTypeSchema).min(1, 'industries must include at least one value'))
  .transform((industries) => [...new Set(industries)]);

const tagIdsSchema = z
  .string()
  .transform((value) => value.split(',').map((tagId) => tagId.trim()))
  .pipe(z.array(z.string().min(1, 'Tag IDs cannot be empty')).min(1))
  .transform((tagIds) => [...new Set(tagIds)]);

const rawLeadListQuerySchema = z.object({
  status: leadStatusSchema.optional(),
  statuses: statusesSchema.optional(),
  industry: industryTypeSchema.optional(),
  industries: industriesSchema.optional(),
  tags: tagIdsSchema.optional(),
  minScore: scoreSchema('minScore').optional(),
  maxScore: scoreSchema('maxScore').optional(),
  followUp: z.enum(LEAD_LIST_FOLLOW_UP_FILTERS).optional(),
  sortBy: z.enum(LEAD_LIST_SORT_FIELDS).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const leadListQuerySchema = rawLeadListQuerySchema
  .transform(
    (query): LeadListQuery => ({
      statuses: query.statuses ?? (query.status ? [query.status] : []),
      industries: query.industries ?? (query.industry ? [query.industry] : []),
      tags: query.tags ?? [],
      minScore: query.minScore ?? defaultLeadListQuery.minScore,
      maxScore: query.maxScore ?? defaultLeadListQuery.maxScore,
      followUp: query.followUp ?? defaultLeadListQuery.followUp,
      sortBy: query.sortBy ?? defaultLeadListQuery.sortBy,
      sortOrder: query.sortOrder ?? defaultLeadListQuery.sortOrder,
    })
  )
  .refine((query) => query.minScore <= query.maxScore, {
    message: 'minScore must be less than or equal to maxScore',
    path: ['minScore'],
  });

/** Encodes the canonical query without importing server-only modules. */
export function encodeLeadListQuery(query: LeadListQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.statuses.length > 0) params.set('statuses', query.statuses.join(','));
  if (query.industries.length > 0) params.set('industries', query.industries.join(','));
  if (query.tags.length > 0) {
    params.set('tags', [...new Set(query.tags.map((tagId) => tagId.trim()))].join(','));
  }
  if (query.minScore !== defaultLeadListQuery.minScore) {
    params.set('minScore', query.minScore.toString());
  }
  if (query.maxScore !== defaultLeadListQuery.maxScore) {
    params.set('maxScore', query.maxScore.toString());
  }
  if (query.followUp !== defaultLeadListQuery.followUp) params.set('followUp', query.followUp);

  params.set('sortBy', query.sortBy);
  params.set('sortOrder', query.sortOrder);

  return params;
}

/** Parses and validates URL query parameters. Throws a ZodError for malformed input. */
export function parseLeadListQuery(searchParams: URLSearchParams): LeadListQuery {
  const value = (key: string) => searchParams.get(key) ?? undefined;

  return leadListQuerySchema.parse({
    status: value('status'),
    statuses: value('statuses'),
    industry: value('industry'),
    industries: value('industries'),
    tags: value('tags'),
    minScore: value('minScore'),
    maxScore: value('maxScore'),
    followUp: value('followUp'),
    sortBy: value('sortBy'),
    sortOrder: value('sortOrder'),
  });
}
