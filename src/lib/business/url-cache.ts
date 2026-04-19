import { prisma } from '@/lib/db';

/**
 * Persistent URL-keyed cache for slow per-URL analyses (PageSpeed,
 * scraping). The same dentist showing up in two searches a week apart
 * doesn't pay the analysis cost twice.
 *
 * Storage is a single SQLite table (UrlAnalysisCache). Payload is
 * JSON.stringify'd. Lookups are uniquely keyed by (service, url) and
 * filtered by expiresAt at read time — expired rows are returned as
 * misses and overwritten on the next write.
 */

type Service = 'pagespeed' | 'scrape';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Normalize URLs so http://x.com, https://x.com/, https://x.com all hit one row. */
export function canonicalUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return url;
  if (!url.startsWith('http')) url = `https://${url}`;
  try {
    const u = new URL(url);
    u.protocol = 'https:';
    u.hash = '';
    // Strip trailing slash on root paths only — keeping subpath semantics intact.
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return url;
  }
}

export async function getCached<T>(
  service: Service,
  url: string
): Promise<T | null> {
  const canon = canonicalUrl(url);
  if (!canon) return null;
  try {
    const row = await prisma.urlAnalysisCache.findUnique({
      where: { service_url: { service, url: canon } },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return JSON.parse(row.payload) as T;
  } catch {
    // Cache misses must never fail the caller — fall through to live fetch.
    return null;
  }
}

export async function putCached<T>(
  service: Service,
  url: string,
  value: T,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<void> {
  const canon = canonicalUrl(url);
  if (!canon) return;
  const expiresAt = new Date(Date.now() + ttlMs);
  const payload = JSON.stringify(value);
  try {
    await prisma.urlAnalysisCache.upsert({
      where: { service_url: { service, url: canon } },
      create: { service, url: canon, payload, expiresAt },
      update: { payload, expiresAt },
    });
  } catch {
    // Cache write failures are non-fatal — search proceeds with live data.
  }
}

/**
 * Bulk lookup: takes a list of URLs, returns a Map of url → cached value
 * for any that are present and unexpired. Caller fetches the remainder
 * fresh and writes them back via putCached.
 */
export async function getCachedMany<T>(
  service: Service,
  urls: string[]
): Promise<Map<string, T>> {
  const result = new Map<string, T>();
  if (urls.length === 0) return result;
  const canonByOriginal = new Map(urls.map((u) => [u, canonicalUrl(u)]));
  const canons = Array.from(new Set(canonByOriginal.values())).filter(Boolean);
  if (canons.length === 0) return result;
  try {
    const rows = await prisma.urlAnalysisCache.findMany({
      where: {
        service,
        url: { in: canons },
        expiresAt: { gt: new Date() },
      },
    });
    const byCanon = new Map(rows.map((r) => [r.url, JSON.parse(r.payload) as T]));
    for (const [original, canon] of canonByOriginal) {
      const hit = byCanon.get(canon);
      if (hit !== undefined) result.set(original, hit);
    }
  } catch {
    // Treat as empty cache.
  }
  return result;
}
