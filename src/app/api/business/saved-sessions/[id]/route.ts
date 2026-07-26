import { deleteSavedSession, getSavedSession } from '@/lib/business/saved-sessions-store';
import { requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';

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

export async function GET(_request: Request, { params }: Params) {
  try {
    const userId = await requireRouteUserId();
    const { id } = await params;
    const record = await getSavedSession(userId, id);

    if (!record) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return Response.json({ session: record });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch saved session');
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const userId = await requireRouteUserId();
    const { id } = await params;
    const deleted = await deleteSavedSession(userId, id);

    if (!deleted) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to delete saved session');
  }
}
