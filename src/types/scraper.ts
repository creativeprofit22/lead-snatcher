export interface SocialLinks {
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
  tiktok?: string;
}

export interface MarketingSignals {
  hasGoogleAds: boolean;
  hasFacebookAds: boolean;
  hasGoogleAnalytics: boolean;
  hasBingAds: boolean;
  hasHotjar: boolean;
  hasOtherAds: boolean;
  detectedPlatforms: string[];
}

export interface WebsiteQualitySignals {
  hasTableLayout: boolean;
  wordCount: number;
  hasAnyForm: boolean;
  hasSchemaOrg: boolean;
  hasOpenGraph: boolean;
  hasDeprecatedTags: boolean;
  deprecatedTagsFound: string[];
  hasFixedPixelWidth: boolean;
  hasLangAttribute: boolean;
  jqueryVersion: string | null;
  isOldJquery: boolean;
  templateFingerprint: string | null;
}

interface ScrapedWebsiteDataBase {
  url: string;
  isReachable: boolean;
  loadTimeMs: number;

  title?: string;
  description?: string;
  language?: string;

  techStack: string[];
  hasWordPress: boolean;
  hasShopify: boolean;
  hasSquarespace: boolean;
  hasWix: boolean;
  hasCustomSite: boolean;

  copyrightYear?: number;
  lastModified?: string;
  estimatedAge: 'new' | 'recent' | 'outdated' | 'ancient' | 'unknown';

  hasOnlineBooking: boolean;
  hasContactForm: boolean;
  hasLiveChat: boolean;
  hasNewsletter: boolean;
  hasEcommerce: boolean;
  hasBlog: boolean;

  emails: string[];
  socialLinks: SocialLinks;
  socialCount: number;

  hasMobileViewport: boolean;
  isHttps: boolean;
  hasSSLIssues: boolean;

  hasModernDesign: boolean;
  imageCount: number;
  hasVideo: boolean;

  marketingSignals: MarketingSignals;
  hasMarketingBudget: boolean;

  error?: string;
  scrapedAt: string;
}

/** Exact shape emitted by a fresh website scrape. */
export interface FreshScrapedWebsiteData extends ScrapedWebsiteDataBase {
  qualitySignals: WebsiteQualitySignals;
}

/**
 * Serialized scrape data read from caches or other persisted sources.
 * Older payloads can predate the quality-signals addition.
 */
export interface PersistedScrapedWebsiteData extends ScrapedWebsiteDataBase {
  qualitySignals?: WebsiteQualitySignals;
}

/** Backward-compatible shared name for persisted or freshly scraped data. */
export type ScrapedWebsiteData = PersistedScrapedWebsiteData;
