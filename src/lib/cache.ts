import { LRUCache } from 'lru-cache';

// API Key cache - stores decrypted API keys in memory for 15 minutes
// This prevents repeated database queries for the same API key
const apiKeyCache = new LRUCache<string, string>({
  max: 500, // Max 500 entries (user+service combinations)
  ttl: 1000 * 60 * 15, // 15 minutes TTL
});

/**
 * Get cached API key or return null if not cached
 */
export function getCachedApiKey(userId: string, service: string): string | null {
  const cacheKey = `${userId}:${service}`;
  return apiKeyCache.get(cacheKey) ?? null;
}

/**
 * Cache an API key
 */
export function setCachedApiKey(userId: string, service: string, key: string): void {
  const cacheKey = `${userId}:${service}`;
  apiKeyCache.set(cacheKey, key);
}

/**
 * Invalidate cached API key (call when user updates their key)
 */
export function invalidateCachedApiKey(userId: string, service: string): void {
  const cacheKey = `${userId}:${service}`;
  apiKeyCache.delete(cacheKey);
}

/**
 * Invalidate all cached API keys for a user
 */
export function invalidateAllCachedApiKeys(userId: string): void {
  const services = ['youtube', 'rapidapi', 'openrouter'];
  for (const service of services) {
    const cacheKey = `${userId}:${service}`;
    apiKeyCache.delete(cacheKey);
  }
}
