import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  deleteSavedSession,
  getSavedSession,
} from '@/lib/business/saved-sessions-store';

/**
 * /api/business/saved-sessions/[id] — single-session endpoints.
 *
 *  GET    → fetch the full payload (results + zones + density) for a saved
 *           session so the client can hydrate results view state from it.
 *  DELETE → remove a saved session.
 *
 * Both enforce user scoping — another user's cuid returns 404.
 */

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { id } = await params;
  const record = await getSavedSession(session.user.id, id);
  if (!record) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return Response.json({ session: record });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { id } = await params;
  const ok = await deleteSavedSession(session.user.id, id);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return Response.json({ ok: true });
}
