import { prisma } from '@/lib/db';
import type { CachedSearch } from '@/lib/search-cache';

/**
 * Cross-session "resume last search" store. One row per user — a new
 * search overwrites the previous entry. Enrichment state is NOT stored
 * here (it's cheap to re-derive since `BusinessEnrichmentCache` already
 * caches results for 7d); keeping the payload small.
 */

type PersistablePayload = Omit<
  CachedSearch,
  'enrichStatusMap' | 'enrichResultMap' | 'selectedForEnrich'
>;

export async function putLastSearch(
  userId: string,
  payload: PersistablePayload
): Promise<void> {
  const serialized = JSON.stringify(payload);
  await prisma.lastSearchSession.upsert({
    where: { userId },
    create: { userId, payload: serialized },
    update: { payload: serialized },
  });
}

export interface LastSearchRecord {
  payload: PersistablePayload;
  updatedAt: Date;
}

export async function getLastSearch(
  userId: string
): Promise<LastSearchRecord | null> {
  const row = await prisma.lastSearchSession.findUnique({
    where: { userId },
  });
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as PersistablePayload;
    return { payload, updatedAt: row.updatedAt };
  } catch {
    // Corrupt JSON — treat as missing so the user gets a clean state.
    return null;
  }
}

export async function clearLastSearch(userId: string): Promise<void> {
  await prisma.lastSearchSession
    .delete({ where: { userId } })
    .catch(() => {
      // Already gone — dismissing a nonexistent card is fine.
    });
}
