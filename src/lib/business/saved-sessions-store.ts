import { prisma } from '@/lib/db';
import {
  decodePersistedSearchPayload,
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
interface SavedSessionBase {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedSessionReadySummary extends SavedSessionBase {
  status: 'ready';
  businessType: string;
  industry: string;
  city: string;
  country: string;
  resultCount: number;
}

export interface SavedSessionCorruptSummary extends SavedSessionBase {
  status: 'corrupt';
  message: string;
}

export type SavedSessionSummary = SavedSessionReadySummary | SavedSessionCorruptSummary;

export interface SavedSessionRecord extends SavedSessionReadySummary {
  payload: PersistedSearchPayload;
}

export type SavedSessionMember = SavedSessionRecord | SavedSessionCorruptSummary;

export const CORRUPT_SAVED_SESSION_MESSAGE =
  'Saved session data is corrupted and cannot be loaded.';

export async function createSavedSession(
  userId: string,
  name: string,
  payload: PersistedSearchPayload
): Promise<SavedSessionRecord> {
  const canonicalPayload = decodePersistedSearchPayload(payload);
  if (!canonicalPayload) throw new TypeError('Invalid persisted search payload');

  const row = await prisma.savedSearchSession.create({
    data: {
      userId,
      name: name.trim().slice(0, 120) || 'Untitled session',
      payload: JSON.stringify(canonicalPayload),
    },
  });
  return toRecord(row, canonicalPayload);
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
): Promise<SavedSessionMember | null> {
  const row = await prisma.savedSearchSession.findFirst({
    where: { id, userId },
  });
  if (!row) return null;
  const payload = parsePersistedSearchPayload(row.payload);
  if (!payload) return toCorruptSummary(row);
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
  if (!payload) return toCorruptSummary(row);
  return toReadySummary(row, payload);
}

function toReadySummary(row: Row, payload: PersistedSearchPayload): SavedSessionReadySummary {
  return {
    ...toBase(row),
    status: 'ready',
    businessType: payload.businessType,
    industry: payload.industry,
    city: payload.city,
    country: payload.country,
    resultCount: payload.results.length,
  };
}

function toCorruptSummary(row: Row): SavedSessionCorruptSummary {
  return {
    ...toBase(row),
    status: 'corrupt',
    message: CORRUPT_SAVED_SESSION_MESSAGE,
  };
}

function toBase(row: Row): SavedSessionBase {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRecord(row: Row, payload: PersistedSearchPayload): SavedSessionRecord {
  return {
    ...toReadySummary(row, payload),
    payload,
  };
}
