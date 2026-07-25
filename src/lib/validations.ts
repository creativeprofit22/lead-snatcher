import { z } from 'zod';
import { DEFAULT_COUNTRY_CODE } from '@/lib/constants';

// ─── Shared enums ───────────────────────────────────────────────

export const leadStatusSchema = z.enum([
  'new',
  'contacted',
  'called',
  'proposal_sent',
  'negotiating',
  'won',
  'lost',
  'not_interested',
]);

export const industryTypeSchema = z.enum([
  'restaurant',
  'salon',
  'fitness',
  'medical',
  'retail',
  'automotive',
  'real_estate',
  'professional_services',
  'other',
]);

export const contactTypeSchema = z.enum(['email', 'call', 'meeting', 'note']);
export const contactOutcomeSchema = z.enum(['positive', 'negative', 'neutral']);

export const taskTypeSchema = z.enum(['call', 'email', 'meeting', 'follow_up', 'other']);
export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

export const apiKeyServiceSchema = z.enum(['youtube', 'rapidapi', 'openrouter', 'pagespeed']);

// ─── Route schemas ──────────────────────────────────────────────

// POST /api/admin/invite
export const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().max(200).optional(),
});

// POST /api/auth/set-password
export const setPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/\d/, 'Password must include a number'),
});

// POST /api/business/search
export const businessSearchSchema = z.object({
  businessType: z.string().min(1, 'Business type is required'),
  city: z.string().min(1, 'City is required'),
  country: z.string().min(2).max(5).default(DEFAULT_COUNTRY_CODE),
  limit: z.number().int().min(1).max(50).default(20),
  deepAnalysis: z.boolean().default(false),
  // Optional zone-targeted rescan: skip city geocoding and aim the Maps
  // search + area score at these exact coords instead.
  searchLat: z.number().min(-90).max(90).optional(),
  searchLng: z.number().min(-180).max(180).optional(),
  zoneLabel: z.string().max(200).optional(),
});

// POST /api/business/enrich
export const businessEnrichSchema = z.object({
  // Businesses to enrich. Each item carries its own name/city/country
  // because enrichment searches the open web — we don't want to fetch
  // from the DB search row (which might be from a different search).
  leads: z
    .array(
      z.object({
        businessId: z.string().min(1, 'businessId is required'),
        name: z.string().min(1).max(500),
        // Whether each target actually needs to run. Client-computed
        // from previewEnrichment to avoid redundant calls.
        needsWebsite: z.boolean(),
        needsSocials: z.boolean(),
      })
    )
    .min(1, 'At least one lead is required')
    .max(50, 'Max 50 leads per request'),
  city: z.string().min(1).max(200),
  country: z.string().min(2).max(5).default(DEFAULT_COUNTRY_CODE),
});

// POST /api/leads
export const createLeadSchema = z.object({
  placeId: z.string().min(1, 'Place ID is required'),
  name: z.string().min(1, 'Name is required').max(500),
  address: z.string().max(1000).nullish(),
  phone: z.string().max(100).nullish(),
  website: z.string().max(2000).nullish(),
  rating: z.number().min(0).max(5).nullish(),
  reviewCount: z.number().int().min(0).nullish(),
  industryType: industryTypeSchema.default('other'),
  photoUrl: z.string().max(2000).nullish(),
  mapsUrl: z.string().max(2000).nullish(),
  leadScore: z.number().int().min(0).max(100).default(0),
  scoreBreakdown: z
    .record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]))
    .nullish(),
  opportunities: z.array(z.string()).nullish(),
  /** Optional: pre-scraped Popular Times data from search-time enrichment. */
  popularTimesData: z.string().max(50_000).nullish(),
  popularTimesScrapedAt: z.string().datetime().nullish(),
});

// PATCH /api/leads/[id]
export const updateLeadSchema = z.object({
  status: leadStatusSchema.optional(),
  notes: z.string().max(10000).nullish(),
  nextFollowUpAt: z.string().datetime().nullish(),
});

// POST /api/leads/[id]/contact
export const createContactLogSchema = z.object({
  type: contactTypeSchema,
  summary: z.string().min(1, 'Summary is required').max(2000),
  outcome: contactOutcomeSchema.optional(),
});

// POST /api/leads/[id]/tags
export const addTagToLeadSchema = z.object({
  tagId: z.preprocess(
    (value) => (typeof value === 'string' ? value : ''),
    z.string().trim().min(1, 'Tag ID is required')
  ),
});

// PATCH /api/leads/bulk
const bulkLeadIdsSchema = z
  .array(z.string().trim().min(1, 'Lead IDs cannot be empty'))
  .min(1, 'At least one lead ID is required')
  .refine((leadIds) => new Set(leadIds).size === leadIds.length, {
    message: 'Lead IDs must be unique',
  });

export const bulkUpdateLeadsSchema = z.discriminatedUnion('action', [
  z.object({
    leadIds: bulkLeadIdsSchema,
    action: z.literal('status'),
    status: leadStatusSchema,
    tagId: z.never().optional(),
  }),
  z.object({
    leadIds: bulkLeadIdsSchema,
    action: z.literal('add_tag'),
    status: z.never().optional(),
    tagId: z.string().trim().min(1, 'Tag ID is required'),
  }),
]);

// DELETE /api/leads/bulk
export const bulkDeleteLeadsSchema = z.object({
  leadIds: z.array(z.string()).min(1, 'At least one lead ID is required'),
});

// POST /api/settings (API keys)
export const saveApiKeySchema = z.object({
  service: apiKeyServiceSchema,
  key: z.string().min(1, 'API key is required').max(500),
});

const tagNameSchema = z.string().trim().min(1, 'Name is required').max(100);
const tagColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format. Use hex (e.g., #3b82f6)');

// POST /api/tags
export const createTagSchema = z.object({
  name: tagNameSchema,
  color: tagColorSchema,
});

// PATCH /api/tags/[id]
export const updateTagSchema = z.object({
  name: tagNameSchema.optional(),
  color: tagColorSchema.optional(),
});

// POST /api/tasks
export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  description: z.string().max(5000).nullish(),
  type: taskTypeSchema.default('other'),
  dueAt: z.string().min(1, 'Due date is required'),
  priority: taskPrioritySchema.default('medium'),
  leadId: z.string().nullish(),
});

// PATCH /api/tasks/[id]
export const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).nullish(),
  type: taskTypeSchema.optional(),
  dueAt: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  completedAt: z.string().datetime().nullish(),
  leadId: z.string().nullable().optional(),
});
