import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scrapePopularTimes, toPopularTimesFailureBody } from '@/lib/business/popular-times';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { HttpError, parseRouteBody, requireRouteUserId } from '@/lib/route-utils';

/**
 * POST /api/business/popular-times
 *
 * Search-time foot-traffic scrape with no database write. There is no current
 * first-party UI caller, so this route remains compatibility-only until
 * deployed request history can be checked.
 */

const bodySchema = z.object({
  name: z.string().min(1).max(500),
  address: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const userId = await requireRouteUserId();
    const { name, address } = await parseRouteBody(request, bodySchema);
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`popular-times:${userId}:${ip}`, RATE_LIMITS.expensive);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: 'Too many Popular Times requests. Please wait a moment.', reason: 'rate_limited' },
        { status: 429 }
      );
    }

    const query = [name, address].filter(Boolean).join(' ');
    const result = await scrapePopularTimes(query);
    if (!result.ok) {
      return NextResponse.json(toPopularTimesFailureBody(result.failure), { status: 502 });
    }

    return NextResponse.json({
      data: result.data,
      scrapedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error('Popular Times search-time scrape error:', error);
    return NextResponse.json(
      { error: 'Server error during scrape', reason: 'server_error' },
      { status: 500 }
    );
  }
}
