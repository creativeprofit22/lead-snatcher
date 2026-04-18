import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getCachedApiKey, setCachedApiKey } from '@/lib/cache';

/**
 * Fetch the user's PageSpeed Insights API key.
 *
 * Resolution order: in-memory cache → DB (decrypted) → PAGESPEED_API_KEY env.
 * Returns undefined when no key is configured — PageSpeed analysis is
 * optional, so the search continues without it instead of erroring.
 */
export async function getPageSpeedKey(userId: string): Promise<string | undefined> {
  const cached = getCachedApiKey(userId, 'pagespeed');
  if (cached) return cached;

  const record = await prisma.apiKey.findUnique({
    where: { userId_service: { userId, service: 'pagespeed' } },
  });

  if (record) {
    try {
      const decrypted = decrypt(record.key);
      setCachedApiKey(userId, 'pagespeed', decrypted);
      return decrypted;
    } catch {
      // Stale encryption — fall through to env fallback so search still works.
    }
  }

  return process.env.PAGESPEED_API_KEY || undefined;
}
