import { prisma } from '@/lib/db';
import {
  parsePersistedSearchPayload,
  type PersistedSearchPayload,
} from '@/lib/business/search-snapshot';

/**
 * Cross-session "resume last search" store. One row per user — a new
 * search overwrites the previous entry. Enrichment state is NOT stored
 * here (it's cheap to re-derive since `BusinessEnrichmentCache` already
 * caches results for 7d); keeping the payload small.
 */
export async function putLastSearch(
  userId: string,
  payload: PersistedSearchPayload
): Promise<void> {
  const serialized = JSON.stringify(payload);
  await prisma.lastSearchSession.upsert({
    where: { userId },
    create: { userId, payload: serialized },
    update: { payload: serialized },
  });
}

export interface LastSearchRecord {
  payload: PersistedSearchPayload;
  updatedAt: Date;
}

export async function getLastSearch(userId: string): Promise<LastSearchRecord | null> {
  const row = await prisma.lastSearchSession.findUnique({
    where: { userId },
  });
  if (!row) return null;
  const payload = parsePersistedSearchPayload(row.payload);
  if (!payload) return null;
  return { payload, updatedAt: row.updatedAt };
}

export async function clearLastSearch(userId: string): Promise<void> {
  await prisma.lastSearchSession.delete({ where: { userId } }).catch(() => {
    // Already gone — dismissing a nonexistent card is fine.
  });
}
