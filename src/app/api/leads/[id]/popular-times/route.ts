import { NextRequest, NextResponse } from 'next/server';
import {
  scrapePopularTimes,
  toPopularTimesFailureBody,
  type PopularTimesData,
} from '@/lib/business/popular-times';
import { prisma } from '@/lib/db';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { HttpError, requireRouteUserId } from '@/lib/route-utils';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/leads/[id]/popular-times
 *
 * Scrape Popular Times for a saved lead, persist to the row, return data.
 * Honors `?force=true` to re-scrape even when cached data exists.
 *
 * On scrape failure: returns 502 with structured `{ error, reason }`.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const userId = await requireRouteUserId();
    const { id } = await context.params;
    const force = request.nextUrl.searchParams.get('force') === 'true';

    const lead = await prisma.lead.findFirst({
      where: { id, userId },
    });
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Cached reads cost no provider request and do not consume the scrape limit.
    if (!force && lead.popularTimesData && lead.popularTimesScrapedAt) {
      try {
        const cached = JSON.parse(lead.popularTimesData) as PopularTimesData;
        return NextResponse.json({
          data: cached,
          scrapedAt: lead.popularTimesScrapedAt.toISOString(),
          fromCache: true,
        });
      } catch {
        // Fall through and re-scrape if the cached blob is corrupt.
      }
    }

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`popular-times:${userId}:${ip}`, RATE_LIMITS.expensive);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Too many Popular Times requests. Please wait a moment.', reason: 'rate_limited' },
        { status: 429 }
      );
    }

    const query = [lead.name, lead.address].filter(Boolean).join(' ');
    const result = await scrapePopularTimes(query);

    if (!result.ok) {
      return NextResponse.json(toPopularTimesFailureBody(result.failure), { status: 502 });
    }

    const now = new Date();
    await prisma.lead.update({
      where: { id },
      data: {
        popularTimesData: JSON.stringify(result.data),
        popularTimesScrapedAt: now,
      },
    });

    return NextResponse.json({
      data: result.data,
      scrapedAt: now.toISOString(),
      fromCache: false,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error('Popular Times scrape error:', error);
    return NextResponse.json(
      { error: 'Server error during scrape', reason: 'server_error' },
      { status: 500 }
    );
  }
}
