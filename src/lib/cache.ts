import { LRUCache } from 'lru-cache';
import type { ApiKeyService } from '@/lib/api-key-services';

// API Key cache - stores decrypted API keys in memory for 15 minutes
// This prevents repeated database queries for the same API key
const apiKeyCache = new LRUCache<string, string>({
  max: 500, // Max 500 entries (user+service combinations)
  ttl: 1000 * 60 * 15, // 15 minutes TTL
});

interface ApiKeyLoadState {
  activeLoads: number;
  generation: number;
}

// Entries exist only while a key has one or more in-flight loads.
const apiKeyLoadStates = new Map<string, ApiKeyLoadState>();

function createApiKeyCacheKey(userId: string, service: ApiKeyService): string {
  return `${userId}:${service}`;
}

/**
 * Get a cached API key or load it without allowing an overlapping invalidation
 * to restore a stale value.
 */
export async function getOrLoadCachedApiKey(
  userId: string,
  service: ApiKeyService,
  loader: () => Promise<string | undefined>
): Promise<string | undefined> {
  const cacheKey = createApiKeyCacheKey(userId, service);
  const cached = apiKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const loadState = apiKeyLoadStates.get(cacheKey) ?? { activeLoads: 0, generation: 0 };
  loadState.activeLoads += 1;
  apiKeyLoadStates.set(cacheKey, loadState);
  const generation = loadState.generation;

  try {
    const loaded = await loader();

    if (loaded && generation === loadState.generation) {
      apiKeyCache.set(cacheKey, loaded);
    }

    return loaded;
  } finally {
    loadState.activeLoads -= 1;
    if (loadState.activeLoads === 0 && apiKeyLoadStates.get(cacheKey) === loadState) {
      apiKeyLoadStates.delete(cacheKey);
    }
  }
}

/**
 * Invalidate a cached API key and any load that started before this call.
 */
export function invalidateCachedApiKey(userId: string, service: ApiKeyService): void {
  const cacheKey = createApiKeyCacheKey(userId, service);
  const loadState = apiKeyLoadStates.get(cacheKey);
  if (loadState) {
    loadState.generation += 1;
  }
  apiKeyCache.delete(cacheKey);
}
