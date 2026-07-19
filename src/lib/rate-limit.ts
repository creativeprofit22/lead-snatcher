/**
 * Simple in-memory rate limiter for API routes
 * For production with multiple instances, use Redis-based rate limiting
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

// Allow the Node.js process to exit without waiting for this timer
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

/**
 * Check rate limit for a given key (usually userId or IP)
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // If no entry or window expired, start fresh
  if (!entry || entry.resetTime < now) {
    const resetTime = now + config.windowMs;
    rateLimitStore.set(key, { count: 1, resetTime });
    return { success: true, remaining: config.maxRequests - 1, resetTime };
  }

  // Check if limit exceeded
  if (entry.count >= config.maxRequests) {
    return { success: false, remaining: 0, resetTime: entry.resetTime };
  }

  // Increment count
  entry.count++;
  return { success: true, remaining: config.maxRequests - entry.count, resetTime: entry.resetTime };
}

/**
 * Extract client IP from request headers.
 * Prefers the first address in x-forwarded-for (set by trusted reverse proxies),
 * then x-real-ip, then falls back to a static key.
 * The static fallback means all direct connections share one bucket — still
 * rate-limited, just not per-client. This is safer than trusting a header
 * an attacker can freely set when there's no reverse proxy in front.
 */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    // Take the first (leftmost) IP — this is the client IP when the
    // proxy chain is trusted. Stripping later entries prevents an
    // attacker from injecting extra IPs to shift the trusted one.
    const firstIp = xff.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // Fallback: all connections without a proxy header share one bucket.
  // This is intentionally conservative — better to over-rate-limit than
  // to let attackers bypass by omitting headers.
  return 'direct-connection';
}

// Preset configurations for different route types
export const RATE_LIMITS = {
  // Expensive operations (LLM calls, transcript extraction)
  expensive: { maxRequests: 10, windowMs: 60000 }, // 10 per minute
  // Standard API calls
  standard: { maxRequests: 60, windowMs: 60000 }, // 60 per minute
  // Auth operations (prevent brute force)
  auth: { maxRequests: 5, windowMs: 60000 }, // 5 per minute
  // Search operations
  search: { maxRequests: 10, windowMs: 60000 }, // 10 per minute
  // Enrichment (per-lead RapidAPI lookups). Generous because the user
  // explicitly opts in per card; each invocation is at most 2 calls.
  // Cap protects against accidental batch-select-all + fire.
  enrich: { maxRequests: 120, windowMs: 60000 }, // 120 calls/min (~60 leads)
} as const;
