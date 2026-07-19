import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { scrapePopularTimes, type PopularTimesData } from '@/lib/business/popular-times';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/leads/[id]/popular-times
 *
 * Scrape Popular Times for a saved lead, persist to the row, return data.
 * Honors `?force=true` to re-scrape even when cached data exists.
 *
 * On scrape failure: returns 502 with structured `{ error, reason }` so
 * the UI can render a precise inline message (mode B).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const force = request.nextUrl.searchParams.get('force') === 'true';

    const lead = await prisma.lead.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Cached path — return existing data unless caller forced a refresh.
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

    const query = [lead.name, lead.address].filter(Boolean).join(' ');
    const result = await scrapePopularTimes(query);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.failure.message,
          reason: result.failure.reason,
        },
        { status: 502 }
      );
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
    console.error('Popular Times scrape error:', error);
    return NextResponse.json(
      { error: 'Server error during scrape', reason: 'server_error' },
      { status: 500 }
    );
  }
}
