import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { createSavedSession, listSavedSessions } from '@/lib/business/saved-sessions-store';
import type { PersistedSearchPayload } from '@/lib/business/search-snapshot';

/**
 * /api/business/saved-sessions — list + create endpoints.
 *
 *  GET  → list all saved sessions for the current user (summary only,
 *         no payload — consumers fetch by id for the full data).
 *  POST → create a new named session from a durable search payload plus a
 *         `name` field.
 *
 * Delete + fetch-by-id live at /[id]/route.ts so the URL structure mirrors
 * typical REST collection + member semantics.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const sessions = await listSavedSessions(session.user.id);
  return Response.json({ sessions });
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

  const incoming = body as Partial<PersistedSearchPayload> & { name?: string };
  if (
    !incoming ||
    typeof incoming.name !== 'string' ||
    !incoming.name.trim() ||
    !Array.isArray(incoming.results) ||
    typeof incoming.industry !== 'string' ||
    typeof incoming.city !== 'string' ||
    typeof incoming.country !== 'string'
  ) {
    return new Response(
      JSON.stringify({
        error: 'Payload must include non-empty name, results[], industry, city, country',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const record = await createSavedSession(session.user.id, incoming.name, {
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

  return Response.json({ session: record });
}
