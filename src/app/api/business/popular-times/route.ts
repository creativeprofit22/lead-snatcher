import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { scrapePopularTimes } from '@/lib/business/popular-times';

/**
 * POST /api/business/popular-times
 *
 * Search-time foot-traffic scrape — no DB write. Used by per-card "Fetch
 * Foot Traffic" button on the search results screen, where the business
 * is not yet a saved Lead. Caching happens in client state for the search
 * session; persistence happens at Save Lead time if the user opts in.
 */

const bodySchema = z.object({
  name: z.string().min(1).max(500),
  address: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
    const parsed = bodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      );
    }

    const { name, address } = parsed.data;
    const query = [name, address].filter(Boolean).join(' ');

    const result = await scrapePopularTimes(query);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.failure.message, reason: result.failure.reason },
        { status: 502 }
      );
    }

    return NextResponse.json({
      data: result.data,
      scrapedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Popular Times search-time scrape error:', error);
    return NextResponse.json(
      { error: 'Server error during scrape', reason: 'server_error' },
      { status: 500 }
    );
  }
}
