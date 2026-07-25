import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { putLastSearch, getLastSearch, clearLastSearch } from '@/lib/business/last-search-store';
import type { PersistedSearchPayload } from '@/lib/business/search-snapshot';

/**
 * /api/business/last-search — the cross-session "resume last search" store.
 *
 *  GET    → returns the user's last persisted search (or null)
 *  POST   → upserts the user's durable search snapshot
 *  DELETE → clears the user's last search (fired when the resume card is
 *           dismissed or the user explicitly wants a fresh home screen)
 *
 * Auth-gated. The client-side localStorage cache (search-cache.ts) is
 * the primary fast path; this endpoint is the fallback when the user
 * lands on the app from a fresh tab / another device / after the 2h
 * localStorage TTL has elapsed.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const record = await getLastSearch(session.user.id);
  if (!record) {
    return Response.json({ data: null });
  }

  return Response.json({
    data: {
      ...record.payload,
      updatedAt: record.updatedAt.toISOString(),
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Minimal shape check — the endpoint remains intentionally permissive
  // about nested search results. Strip browser-only and unexpected fields
  // before writing the canonical durable payload.
  const incoming = body as Partial<PersistedSearchPayload>;
  if (
    !incoming ||
    !Array.isArray(incoming.results) ||
    typeof incoming.industry !== 'string' ||
    typeof incoming.city !== 'string' ||
    typeof incoming.country !== 'string'
  ) {
    return new Response(
      JSON.stringify({
        error: 'Payload must include results[], industry, city, country',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  await putLastSearch(session.user.id, {
    results: incoming.results,
    industry: incoming.industry,
    city: incoming.city,
    country: incoming.country,
    timestamp: incoming.timestamp ?? Date.now(),
    zones: incoming.zones,
    zoneBbox: incoming.zoneBbox,
    singleZone: incoming.singleZone,
    focusedZoneId: incoming.focusedZoneId,
    marketDensity: incoming.marketDensity,
  });

  return Response.json({ ok: true });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await clearLastSearch(session.user.id);
  return Response.json({ ok: true });
}
