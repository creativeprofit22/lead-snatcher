import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { parseLeadListQuery } from '@/lib/crm-lead-query';
import { createLeadSchema } from '@/lib/validations';
import {
  parseRouteBody,
  parseRouteQuery,
  requireRouteUserId,
  routeErrorResponse,
} from '@/lib/route-utils';
import { toLeadDto } from '@/lib/lead-dto';

// GET - Fetch user's leads with optional filters
export async function GET(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const { searchParams } = new URL(request.url);
    const { statuses, industries, tags, minScore, maxScore, followUp, sortBy, sortOrder } =
      parseRouteQuery(searchParams, parseLeadListQuery);

    // Build where clause
    const where: Record<string, unknown> = {
      userId,
    };

    if (statuses.length > 0) {
      where.status = { in: statuses };
    }

    if (minScore > 0 || maxScore < 100) {
      where.leadScore = { gte: minScore, lte: maxScore };
    }

    if (industries.length > 0) {
      where.industryType = { in: industries };
    }

    // Follow-up filter
    if (followUp !== 'all') {
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
    if (tags.length > 0) {
      where.tags = {
        some: {
          tagId: { in: tags },
        },
      };
    }

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      include: {
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
