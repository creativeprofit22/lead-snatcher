import { z } from 'zod';
import { createSavedSession, listSavedSessions } from '@/lib/business/saved-sessions-store';
import { decodePersistedSearchPayload } from '@/lib/business/search-snapshot';
import {
  HttpError,
  parseRouteBody,
  requireRouteUserId,
  routeErrorResponse,
} from '@/lib/route-utils';

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

const savedSessionRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Name must be at most 120 characters'),
  })
  .passthrough();

export async function GET() {
  try {
    const userId = await requireRouteUserId();
    const sessions = await listSavedSessions(userId);

    return Response.json({ sessions });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch saved sessions');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const body = await parseRouteBody(request, savedSessionRequestSchema);
    const payload = decodePersistedSearchPayload(body, Date.now());

    if (!payload) {
      throw new HttpError('Payload must include a valid durable search snapshot', 400);
    }

    const record = await createSavedSession(userId, body.name, payload);
    return Response.json({ session: record });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to create saved session');
  }
}
