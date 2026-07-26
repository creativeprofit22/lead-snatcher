import { prisma } from '@/lib/db';
import {
  comparePersistedSearchPayloads,
  decodePersistedSearchPayload,
  parsePersistedSearchPayload,
  type PersistedSearchPayload,
} from '@/lib/business/search-snapshot';

/**
 * Cross-session "resume last search" store. One row per user — a newer
 * immutable snapshot replaces the previous entry. Enrichment state is not stored here.
 */
export async function putLastSearch(
  userId: string,
  payload: PersistedSearchPayload
): Promise<PersistedSearchPayload> {
  const canonicalPayload = decodePersistedSearchPayload(payload);
  if (!canonicalPayload) throw new TypeError('Invalid persisted search payload');

  return prisma.$transaction(async (transaction) => {
    const currentRow = await transaction.lastSearchSession.findUnique({ where: { userId } });
    const currentPayload = currentRow ? parsePersistedSearchPayload(currentRow.payload) : null;

    if (currentPayload && comparePersistedSearchPayloads(currentPayload, canonicalPayload) >= 0) {
      return currentPayload;
    }

    const serialized = JSON.stringify(canonicalPayload);
    await transaction.lastSearchSession.upsert({
      where: { userId },
      create: { userId, payload: serialized },
      update: { payload: serialized },
    });
    return canonicalPayload;
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
