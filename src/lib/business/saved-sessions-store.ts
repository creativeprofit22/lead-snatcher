import { prisma } from '@/lib/db';
import type { CachedSearch } from '@/lib/search-cache';

/**
 * Explicit, named, permanent saved search sessions. User names and pins
 * a snapshot of their current results; persists until manually deleted.
 *
 * Distinct from last-search-store.ts (auto-saved, single-slot). Enrichment
 * state is dropped from the payload — cheap to re-derive via the
 * BusinessEnrichmentCache on reload, and keeps each saved row lean.
 */

type PersistablePayload = Omit<
  CachedSearch,
  'enrichStatusMap' | 'enrichResultMap' | 'selectedForEnrich'
>;

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
  payload: PersistablePayload;
}

export async function createSavedSession(
  userId: string,
  name: string,
  payload: PersistablePayload
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
    const payload = parsePayload(row.payload);
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
  const payload = parsePayload(row.payload);
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

function parsePayload(raw: string): PersistablePayload | null {
  try {
    return JSON.parse(raw) as PersistablePayload;
  } catch {
    return null;
  }
}

type Row = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(row: Row, payload: PersistablePayload | null): SavedSessionSummary {
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

function toRecord(row: Row, payload: PersistablePayload): SavedSessionRecord {
  return {
    ...toSummary(row, payload),
    payload,
  };
}
