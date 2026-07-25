import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createLeadSchema, leadStatusSchema, industryTypeSchema } from '@/lib/validations';
import { parseRouteBody, requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';
import { toLeadDto } from '@/lib/lead-dto';
import type { LeadStatus, IndustryType } from '@/types';

// GET - Fetch user's leads with optional filters
export async function GET(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const { searchParams } = new URL(request.url);

    // Single status (legacy) or multi-status
    const status = searchParams.get('status') as LeadStatus | null;
    const statuses = searchParams.get('statuses'); // comma-separated

    // Score range
    const minScore = searchParams.get('minScore');
    const maxScore = searchParams.get('maxScore');

    // Industry filter (single or multi)
    const industry = searchParams.get('industry');
    const industries = searchParams.get('industries'); // comma-separated

    // Follow-up filter
    const followUp = searchParams.get('followUp'); // 'today' | 'overdue' | 'this_week'

    // Tags filter
    const tags = searchParams.get('tags'); // comma-separated tag IDs

    // Sorting - whitelist allowed fields to prevent injection
    const ALLOWED_SORT_FIELDS = [
      'savedAt',
      'leadScore',
      'name',
      'status',
      'lastContactedAt',
      'nextFollowUpAt',
      'updatedAt',
    ];
    const requestedSortBy = searchParams.get('sortBy') || 'savedAt';
    const sortBy = ALLOWED_SORT_FIELDS.includes(requestedSortBy) ? requestedSortBy : 'savedAt';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    // Build where clause
    const where: Record<string, unknown> = {
      userId,
    };

    // Multi-status filter — validate each value against the enum
    if (statuses) {
      const statusList = statuses
        .split(',')
        .filter((s) => leadStatusSchema.safeParse(s).success) as LeadStatus[];
      if (statusList.length > 0) where.status = { in: statusList };
    } else if (status) {
      if (leadStatusSchema.safeParse(status).success) where.status = status;
    }

    // Score range filter
    if (minScore || maxScore) {
      where.leadScore = {};
      if (minScore) (where.leadScore as Record<string, number>).gte = parseInt(minScore);
      if (maxScore) (where.leadScore as Record<string, number>).lte = parseInt(maxScore);
    }

    // Multi-industry filter — validate each value against the enum
    if (industries) {
      const industryList = industries
        .split(',')
        .filter((s) => industryTypeSchema.safeParse(s).success) as IndustryType[];
      if (industryList.length > 0) where.industryType = { in: industryList };
    } else if (industry) {
      if (industryTypeSchema.safeParse(industry).success) where.industryType = industry;
    }

    // Follow-up filter
    if (followUp) {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
      const endOfWeek = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);

      switch (followUp) {
        case 'today':
          where.nextFollowUpAt = {
            gte: startOfDay,
            lte: endOfDay,
          };
          break;
        case 'overdue':
          where.nextFollowUpAt = {
            lt: startOfDay,
            not: null,
          };
          break;
        case 'this_week':
          where.nextFollowUpAt = {
            gte: startOfDay,
            lte: endOfWeek,
          };
          break;
      }
    }

    // Tags filter - leads must have at least one of the specified tags
    if (tags) {
      const tagIds = tags.split(',');
      where.tags = {
        some: {
          tagId: { in: tagIds },
        },
      };
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      include: {
        contactLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    return NextResponse.json({ leads: leads.map(toLeadDto) });
  } catch (error) {
    console.error('Get leads error:', error);
    return routeErrorResponse(error, 'Failed to fetch leads');
  }
}

// POST - Save a new lead
export async function POST(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const {
      placeId,
      name,
      address,
      phone,
      website,
      rating,
      reviewCount,
      industryType,
      photoUrl,
      mapsUrl,
      leadScore,
      scoreBreakdown,
      opportunities,
      popularTimesData,
      popularTimesScrapedAt,
    } = await parseRouteBody(request, createLeadSchema);

    // Check if already saved
    const existing = await prisma.lead.findUnique({
      where: {
        userId_placeId: {
          userId,
          placeId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'This business is already saved', leadId: existing.id },
        { status: 409 }
      );
    }

    // Create lead
    const lead = await prisma.lead.create({
      data: {
        userId,
        placeId,
        name,
        address,
        phone,
        website,
        rating,
        reviewCount,
        industryType: industryType || 'other',
        photoUrl,
        mapsUrl,
        leadScore: leadScore || 0,
        scoreBreakdown: scoreBreakdown ? JSON.stringify(scoreBreakdown) : null,
        opportunities: opportunities ? JSON.stringify(opportunities) : '[]',
        status: 'new',
        popularTimesData: popularTimesData ?? undefined,
        popularTimesScrapedAt: popularTimesScrapedAt ? new Date(popularTimesScrapedAt) : undefined,
      },
      include: {
        tags: { include: { tag: true } },
      },
    });

    return NextResponse.json({ lead: toLeadDto(lead), message: 'Lead saved successfully' });
  } catch (error) {
    console.error('Save lead error:', error);
    return routeErrorResponse(error, 'Failed to save lead');
  }
}
