import { prisma } from '@/lib/db';
import {
  parsePersistedSearchPayload,
  type PersistedSearchPayload,
} from '@/lib/business/search-snapshot';

/**
 * Explicit, named, permanent saved search sessions. User names and pins
 * a snapshot of their current results; persists until manually deleted.
 *
 * Distinct from last-search-store.ts (auto-saved, single-slot). Enrichment
 * state is dropped from the payload — cheap to re-derive via the
 * BusinessEnrichmentCache on reload, and keeps each saved row lean.
 */
export interface SavedSessionSummary {
  id: string;
  name: string;
  industry: string;
  city: string;
  country: string;
  resultCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSessionRecord extends SavedSessionSummary {
  payload: PersistedSearchPayload;
}

export async function createSavedSession(
  userId: string,
  name: string,
  payload: PersistedSearchPayload
): Promise<SavedSessionRecord> {
  const row = await prisma.savedSearchSession.create({
    data: {
      userId,
      name: name.trim().slice(0, 120) || 'Untitled session',
      payload: JSON.stringify(payload),
    },
  });
  return toRecord(row, payload);
}

export async function listSavedSessions(userId: string): Promise<SavedSessionSummary[]> {
  const rows = await prisma.savedSearchSession.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((row) => {
    const payload = parsePersistedSearchPayload(row.payload);
    return toSummary(row, payload);
  });
}

export async function getSavedSession(
  userId: string,
  id: string
): Promise<SavedSessionRecord | null> {
  const row = await prisma.savedSearchSession.findFirst({
    where: { id, userId },
  });
  if (!row) return null;
  const payload = parsePersistedSearchPayload(row.payload);
  if (!payload) return null;
  return toRecord(row, payload);
}

export async function deleteSavedSession(userId: string, id: string): Promise<boolean> {
  // findFirst+delete to enforce user scoping — users can only delete
  // their own sessions, not anyone else's cuid.
  const row = await prisma.savedSearchSession.findFirst({
    where: { id, userId },
  });
  if (!row) return false;
  await prisma.savedSearchSession.delete({ where: { id: row.id } });
  return true;
}

// ---- helpers ----

type Row = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: Row, payload: PersistedSearchPayload | null): SavedSessionSummary {
  return {
    id: row.id,
    name: row.name,
    industry: payload?.industry ?? 'other',
    city: payload?.city ?? '',
    country: payload?.country ?? 'us',
    resultCount: payload?.results?.length ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRecord(row: Row, payload: PersistedSearchPayload): SavedSessionRecord {
  return {
    ...toSummary(row, payload),
    payload,
  };
}
