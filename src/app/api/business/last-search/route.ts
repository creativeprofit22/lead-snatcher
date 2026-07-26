import { z } from 'zod';
import { putLastSearch, getLastSearch } from '@/lib/business/last-search-store';
import { decodePersistedSearchPayload } from '@/lib/business/search-snapshot';
import {
  HttpError,
  parseRouteBody,
  requireRouteUserId,
  routeErrorResponse,
} from '@/lib/route-utils';

/**
 * /api/business/last-search — the reconciled cross-session last-search store.
 *
 *  GET  → returns the user's accepted snapshot (or null)
 *  POST → accepts the newer of the submitted and currently stored snapshots
 *
 * Auth-gated. The browser cache remains the fast hydration path, while this
 * endpoint reconciles every visit so another device's newer snapshot is visible.
 */

const searchSnapshotRequestSchema = z.unknown();

export async function GET() {
  try {
    const userId = await requireRouteUserId();
    const record = await getLastSearch(userId);

    if (!record) {
      return Response.json({ data: null });
    }

    return Response.json({
      data: {
        ...record.payload,
        // Resume age is the immutable search creation time on every storage path.
        updatedAt: new Date(record.payload.timestamp).toISOString(),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch last search');
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const body = await parseRouteBody(request, searchSnapshotRequestSchema);
    const payload = decodePersistedSearchPayload(body, Date.now());

    if (!payload) {
      throw new HttpError('Payload must be a valid durable search snapshot', 400);
    }

    const accepted = await putLastSearch(userId, payload);
    return Response.json({
      ok: true,
      data: {
        ...accepted,
        updatedAt: new Date(accepted.timestamp).toISOString(),
      },
    });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to save last search');
  }
}
