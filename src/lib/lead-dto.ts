import type { Lead as PrismaLead, Tag as PrismaTag } from '@/generated/prisma/client';
import { scoreBreakdownSchema } from '@/lib/business/score-breakdown-contract';
import { parseLeadStatus } from '@/lib/lead-status';
import type { IndustryType, Lead, Tag } from '@/types';

type PersistedLead = PrismaLead & {
  tags?: Array<{ tag: PrismaTag }>;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseScoreBreakdown(value: string | null) {
  const result = scoreBreakdownSchema.safeParse(parseJson<unknown>(value, null));

  return result.success ? result.data : null;
}
function toTagDto(tag: PrismaTag): Tag {
  return {
    id: tag.id,
    name: tag.name,
    color: tag.color,
    createdAt: tag.createdAt.toISOString(),
  };
}

/** The sole serializer for persisted leads returned by the API. */
export function toLeadDto(lead: PersistedLead): Lead {
  return {
    id: lead.id,
    placeId: lead.placeId,
    name: lead.name,
    address: lead.address,
    phone: lead.phone,
    website: lead.website,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    industryType: lead.industryType as IndustryType,
    photoUrl: lead.photoUrl,
    mapsUrl: lead.mapsUrl,
    leadScore: lead.leadScore,
    scoreBreakdown: parseScoreBreakdown(lead.scoreBreakdown),
    status: parseLeadStatus(lead.status),
    notes: lead.notes,
    opportunities: parseJson<string[]>(lead.opportunities, []),
    lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    savedAt: lead.savedAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    tags: (lead.tags ?? []).map(({ tag }) => toTagDto(tag)),
    popularTimesData: lead.popularTimesData,
    popularTimesScrapedAt: lead.popularTimesScrapedAt?.toISOString() ?? null,
  };
}
