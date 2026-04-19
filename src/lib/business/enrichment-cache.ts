import { prisma } from '@/lib/db';
import type { DiscoveredSocials } from './enrichment';

/**
 * Persistent per-business enrichment cache. Keyed by Google Maps
 * place_id so the same lead in two searches doesn't re-spend
 * RapidAPI quota on web/social lookups.
 *
 * Storage: BusinessEnrichmentCache. Payload is JSON-serialized.
 * Lookups filter by expiresAt; expired rows are treated as misses
 * and overwritten on next write. Cache failures must never fail
 * the caller — the live endpoint always has a fallback path.
 */

export interface EnrichmentPayload {
  website?: string;
  socials?: DiscoveredSocials;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function getEnrichment(
  businessId: string
): Promise<EnrichmentPayload | null> {
  if (!businessId) return null;
  try {
    const row = await prisma.businessEnrichmentCache.findUnique({
      where: { businessId },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return JSON.parse(row.payload) as EnrichmentPayload;
  } catch {
    return null;
  }
}

export async function putEnrichment(
  businessId: string,
  value: EnrichmentPayload,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  if (!businessId) return;
  const expiresAt = new Date(Date.now() + ttlMs);
  const payload = JSON.stringify(value);
  try {
    await prisma.businessEnrichmentCache.upsert({
      where: { businessId },
      create: { businessId, payload, expiresAt },
      update: { payload, expiresAt },
    });
  } catch {
    // Non-fatal.
  }
}

/**
 * Bulk lookup for a set of businessIds. Returns a Map of id → payload
 * for any unexpired hits. Caller fetches the rest live.
 */
export async function getEnrichmentMany(
  businessIds: string[]
): Promise<Map<string, EnrichmentPayload>> {
  const result = new Map<string, EnrichmentPayload>();
  const ids = businessIds.filter(Boolean);
  if (ids.length === 0) return result;
  try {
    const rows = await prisma.businessEnrichmentCache.findMany({
      where: {
        businessId: { in: ids },
        expiresAt: { gt: new Date() },
      },
    });
    for (const row of rows) {
      result.set(row.businessId, JSON.parse(row.payload) as EnrichmentPayload);
    }
  } catch {
    // Empty cache on failure.
  }
  return result;
}
