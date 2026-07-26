const SOCIAL_PROFILE_DOMAINS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'linkedin.com',
  'youtube.com',
] as const;

/**
 * Preserves the legacy case-insensitive substring policy used by scoring and opportunities.
 * Deceptive hosts and query-string mentions still match pending a later hostname-policy decision.
 */
export function isSocialProfileUrl(value: string): boolean {
  const normalizedValue = value.toLowerCase();
  return SOCIAL_PROFILE_DOMAINS.some((domain) => normalizedValue.includes(domain));
}
