import type {
  FreshScrapedWebsiteData,
  MarketingSignals,
  SocialLinks,
  WebsiteQualitySignals,
} from '@/types/scraper';

type OptionalMetadata = Partial<
  Pick<FreshScrapedWebsiteData, 'title' | 'description' | 'language' | 'copyrightYear'>
>;

export type ScraperExtractedData = OptionalMetadata &
  Pick<
    FreshScrapedWebsiteData,
    | 'techStack'
    | 'hasWordPress'
    | 'hasShopify'
    | 'hasSquarespace'
    | 'hasWix'
    | 'hasCustomSite'
    | 'estimatedAge'
    | 'hasOnlineBooking'
    | 'hasContactForm'
    | 'hasLiveChat'
    | 'hasNewsletter'
    | 'hasEcommerce'
    | 'hasBlog'
    | 'emails'
    | 'socialLinks'
    | 'socialCount'
    | 'hasMobileViewport'
    | 'hasModernDesign'
    | 'imageCount'
    | 'hasVideo'
    | 'marketingSignals'
    | 'hasMarketingBudget'
    | 'qualitySignals'
  >;

const TECH_PATTERNS: Record<string, RegExp[]> = {
  WordPress: [/wp-content/i, /wp-includes/i, /wordpress/i],
  Shopify: [/cdn\.shopify/i, /shopify/i],
  Squarespace: [/squarespace/i, /sqsp/i],
  Wix: [/wix\.com/i, /wixstatic/i],
  Webflow: [/webflow/i],
  React: [/react/i, /_next/i, /nextjs/i],
  Vue: [/vue\.js/i, /nuxt/i],
  Angular: [/angular/i, /ng-/i],
  Bootstrap: [/bootstrap/i],
  TailwindCSS: [/tailwind/i],
  jQuery: [/jquery/i],
};

const BOOKING_PATTERNS = [
  /book\s*(now|online|appointment)/i,
  /reserv(e|ation)/i,
  /schedule/i,
  /termin/i,
  /buchung/i,
  /calendly/i,
  /acuity/i,
  /booksy/i,
  /fresha/i,
  /treatwell/i,
];

const ECOMMERCE_PATTERNS = [
  /add.to.cart/i,
  /shopping.cart/i,
  /checkout/i,
  /buy.now/i,
  /shop/i,
  /warenkorb/i,
  /kaufen/i,
];

const CHAT_PATTERNS = [
  /intercom/i,
  /drift/i,
  /crisp/i,
  /tawk/i,
  /zendesk/i,
  /livechat/i,
  /hubspot/i,
  /tidio/i,
];

const MARKETING_SIGNALS = {
  googleAds: [
    /googlesyndication\.com/i,
    /googleadservices\.com/i,
    /adsbygoogle/i,
    /google_ad_client/i,
    /googleads\.g\.doubleclick/i,
  ],
  facebookAds: [/connect\.facebook\.net/i, /fbq\s*\(/i, /facebook\.com\/tr/i, /meta.*pixel/i],
  googleAnalytics: [
    /googletagmanager\.com/i,
    /google-analytics\.com/i,
    /gtag\s*\(/i,
    /analytics\.js/i,
  ],
  bingAds: [/bat\.bing\.com/i, /clarity\.ms/i],
  hotjar: [/hotjar\.com/i, /static\.hotjar\.com/i],
  otherAds: [
    /doubleclick\.net/i,
    /adroll\.com/i,
    /criteo/i,
    /taboola/i,
    /outbrain/i,
    /linkedin\.com\/px/i,
    /snap\.licdn\.com/i,
    /tiktok\.com\/i18n\/pixel/i,
    /ads-twitter\.com/i,
  ],
} as const;

const NEWSLETTER_PATTERNS = [
  /newsletter/i,
  /subscribe/i,
  /mailchimp/i,
  /klaviyo/i,
  /convertkit/i,
  /abonnieren/i,
];

const TEMPLATE_FINGERPRINTS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: 'Wix', patterns: [/wix\.com/i, /wixstatic/i, /_wixCIDX/i] },
  { label: 'GoDaddy Sites', patterns: [/godaddysites\.com/i, /img1\.wsimg\.com/i] },
  { label: 'Weebly', patterns: [/weebly\.com/i, /editmysite/i] },
  { label: 'Google Business Site', patterns: [/business\.site/i, /sites\.google\.com/i] },
  { label: 'Jimdo', patterns: [/jimdo(site)?\.com/i, /jimstatic/i] },
];

const DEPRECATED_TAG_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: '<marquee>', pattern: /<marquee\b/i },
  { label: '<center>', pattern: /<center\b/i },
  { label: '<font>', pattern: /<font\b/i },
  { label: 'bgcolor=', pattern: /\sbgcolor\s*=/i },
];

function createInitialExtractedData(): ScraperExtractedData {
  return {
    techStack: [],
    hasWordPress: false,
    hasShopify: false,
    hasSquarespace: false,
    hasWix: false,
    hasCustomSite: true,
    estimatedAge: 'unknown',
    hasOnlineBooking: false,
    hasContactForm: false,
    hasLiveChat: false,
    hasNewsletter: false,
    hasEcommerce: false,
    hasBlog: false,
    emails: [],
    socialLinks: {},
    socialCount: 0,
    hasMobileViewport: false,
    hasModernDesign: false,
    imageCount: 0,
    hasVideo: false,
    marketingSignals: {
      hasGoogleAds: false,
      hasFacebookAds: false,
      hasGoogleAnalytics: false,
      hasBingAds: false,
      hasHotjar: false,
      hasOtherAds: false,
      detectedPlatforms: [],
    },
    hasMarketingBudget: false,
    qualitySignals: {
      hasTableLayout: false,
      wordCount: 0,
      hasAnyForm: false,
      hasSchemaOrg: false,
      hasOpenGraph: false,
      hasDeprecatedTags: false,
      deprecatedTagsFound: [],
      hasFixedPixelWidth: false,
      hasLangAttribute: false,
      jqueryVersion: null,
      isOldJquery: false,
      templateFingerprint: null,
    },
  };
}

/** Extracts deterministic scraper-owned signals from HTML. */
export function extractWebsiteData(html: string, currentYear: number): ScraperExtractedData {
  const result = createInitialExtractedData();

  extractBasicInfo(html, result);
  detectTechStack(html, result);
  detectFeatures(html, result);
  extractEmails(html, result);
  extractSocialLinks(html, result);
  detectDesignQuality(html, result);
  estimateWebsiteAge(html, currentYear, result);
  detectMarketingSignals(html, result);
  detectQualitySignals(html, result);

  return result;
}

function extractBasicInfo(html: string, result: ScraperExtractedData): void {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) result.title = titleMatch[1].trim();

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch?.[1]) result.description = descMatch[1].trim();

  const langMatch = html.match(/<html[^>]+lang=["']([^"']+)["']/i);
  if (langMatch?.[1]) result.language = langMatch[1].split('-')[0] ?? langMatch[1];

  result.hasMobileViewport = /viewport/i.test(html) && /width=device-width/i.test(html);
}

function detectTechStack(html: string, result: ScraperExtractedData): void {
  const detectedTech: string[] = [];

  for (const [tech, patterns] of Object.entries(TECH_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(html))) {
      detectedTech.push(tech);
      if (tech === 'WordPress') result.hasWordPress = true;
      if (tech === 'Shopify') result.hasShopify = true;
      if (tech === 'Squarespace') result.hasSquarespace = true;
      if (tech === 'Wix') result.hasWix = true;
    }
  }

  result.techStack = detectedTech;
  result.hasCustomSite =
    !result.hasWordPress && !result.hasShopify && !result.hasSquarespace && !result.hasWix;
}

function detectFeatures(html: string, result: ScraperExtractedData): void {
  result.hasOnlineBooking = BOOKING_PATTERNS.some((pattern) => pattern.test(html));
  result.hasContactForm =
    /<form[^>]*>/i.test(html) &&
    (/contact/i.test(html) || /email/i.test(html) || /message/i.test(html));
  result.hasLiveChat = CHAT_PATTERNS.some((pattern) => pattern.test(html));
  result.hasNewsletter = NEWSLETTER_PATTERNS.some((pattern) => pattern.test(html));
  result.hasEcommerce = ECOMMERCE_PATTERNS.some((pattern) => pattern.test(html));
  result.hasBlog = /blog/i.test(html) || /artikel/i.test(html) || /news/i.test(html);
}

function extractEmails(html: string, result: ScraperExtractedData): void {
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = html.match(emailPattern) || [];
  const junkPatterns = [
    /noreply/i,
    /no-reply/i,
    /example\.com/i,
    /domain\.com/i,
    /email\.com$/i,
    /test@/i,
    /user@/i,
    /info@example/i,
    /your-?email/i,
    /name@/i,
    /sentry/i,
    /webpack/i,
    /wixpress/i,
    /wix\.com/i,
    /wordpress/i,
    /schema\.org/i,
    /sentry\.io/i,
    /placeholder/i,
    /sample/i,
    /\.png$/i,
    /\.jpg$/i,
    /\.jpeg$/i,
    /\.gif$/i,
    /\.svg$/i,
    /\.webp$/i,
    /\.js$/i,
    /\.css$/i,
    /\.woff/i,
    /\.ttf$/i,
    /protection@/i,
    /abuse@/i,
    /postmaster@/i,
    /mailer-daemon/i,
    /changeme/i,
    /yourname/i,
    /youremail/i,
    /someone@/i,
  ];

  result.emails = [...new Set(matches)]
    .filter((email) => !junkPatterns.some((pattern) => pattern.test(email)))
    .slice(0, 5);
}

function extractSocialLinks(html: string, result: ScraperExtractedData): void {
  const socialPatterns: Record<keyof SocialLinks, RegExp> = {
    facebook: /href=["']([^"']*facebook\.com[^"']*)["']/gi,
    instagram: /href=["']([^"']*instagram\.com[^"']*)["']/gi,
    twitter: /href=["']([^"']*(?:twitter\.com|x\.com)[^"']*)["']/gi,
    linkedin: /href=["']([^"']*linkedin\.com[^"']*)["']/gi,
    youtube: /href=["']([^"']*youtube\.com[^"']*)["']/gi,
    tiktok: /href=["']([^"']*tiktok\.com[^"']*)["']/gi,
  };

  let count = 0;
  for (const [platform, pattern] of Object.entries(socialPatterns)) {
    const match = pattern.exec(html);
    if (match) {
      result.socialLinks[platform as keyof SocialLinks] = match[1];
      count++;
    }
  }
  result.socialCount = count;
}

function detectDesignQuality(html: string, result: ScraperExtractedData): void {
  const modernIndicators = [
    /tailwind/i,
    /bootstrap/i,
    /material/i,
    /chakra/i,
    /styled-components/i,
    /css-in-js/i,
    /flex/i,
    /grid/i,
  ];
  result.hasModernDesign = modernIndicators.some((pattern) => pattern.test(html));

  const imgMatches = html.match(/<img/gi);
  result.imageCount = imgMatches ? imgMatches.length : 0;
  result.hasVideo =
    /<video/i.test(html) || /youtube\.com\/embed/i.test(html) || /vimeo/i.test(html);
}

function estimateWebsiteAge(html: string, currentYear: number, result: ScraperExtractedData): void {
  const copyrightPatterns = [
    /©\s*(\d{4})/,
    /copyright\s*(\d{4})/i,
    /&copy;\s*(\d{4})/,
    /(\d{4})\s*©/,
  ];

  for (const pattern of copyrightPatterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const year = parseInt(match[1], 10);
      if (year >= 2000 && year <= currentYear) {
        result.copyrightYear = year;
        break;
      }
    }
  }

  if (result.copyrightYear) {
    const age = currentYear - result.copyrightYear;
    if (age <= 1) result.estimatedAge = 'new';
    else if (age <= 3) result.estimatedAge = 'recent';
    else if (age <= 6) result.estimatedAge = 'outdated';
    else result.estimatedAge = 'ancient';
  }
}

function detectMarketingSignals(html: string, result: ScraperExtractedData): void {
  const signals: MarketingSignals = result.marketingSignals;
  const platforms: string[] = [];

  signals.hasGoogleAds = MARKETING_SIGNALS.googleAds.some((pattern) => pattern.test(html));
  if (signals.hasGoogleAds) platforms.push('Google Ads');

  signals.hasFacebookAds = MARKETING_SIGNALS.facebookAds.some((pattern) => pattern.test(html));
  if (signals.hasFacebookAds) platforms.push('Facebook Ads');

  signals.hasGoogleAnalytics = MARKETING_SIGNALS.googleAnalytics.some((pattern) =>
    pattern.test(html)
  );
  if (signals.hasGoogleAnalytics) platforms.push('Google Analytics');

  signals.hasBingAds = MARKETING_SIGNALS.bingAds.some((pattern) => pattern.test(html));
  if (signals.hasBingAds) platforms.push('Bing Ads');

  signals.hasHotjar = MARKETING_SIGNALS.hotjar.some((pattern) => pattern.test(html));
  if (signals.hasHotjar) platforms.push('Hotjar');

  signals.hasOtherAds = MARKETING_SIGNALS.otherAds.some((pattern) => pattern.test(html));
  if (signals.hasOtherAds) platforms.push('Other Ad Networks');

  signals.detectedPlatforms = platforms;
  result.hasMarketingBudget =
    signals.hasGoogleAds || signals.hasFacebookAds || signals.hasBingAds || signals.hasOtherAds;
}

function detectQualitySignals(html: string, result: ScraperExtractedData): void {
  const quality: WebsiteQualitySignals = result.qualitySignals;
  const tableOpens = (html.match(/<table\b/gi) || []).length;
  const hasFlexOrGrid =
    /display\s*:\s*(flex|grid)/i.test(html) || /\bclass\s*=\s*"[^"]*(flex|grid)\b/i.test(html);
  quality.hasTableLayout = tableOpens >= 2 && !hasFlexOrGrid;

  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  quality.wordCount = stripped.split(/\s+/).filter((word) => word.length > 1).length;

  quality.hasAnyForm = /<form\b/i.test(html);
  quality.hasSchemaOrg =
    /<script[^>]+type=["']application\/ld\+json["']/i.test(html) || /schema\.org/i.test(html);
  quality.hasOpenGraph = /<meta[^>]+property=["']og:/i.test(html);

  const foundDeprecated: string[] = [];
  for (const { label, pattern } of DEPRECATED_TAG_PATTERNS) {
    if (pattern.test(html)) foundDeprecated.push(label);
  }

  const fixedWidthMatches =
    html.match(/(width\s*=\s*["']?\d{3,4}["']?|width\s*:\s*\d{3,4}\s*px)/gi) || [];
  quality.hasFixedPixelWidth = fixedWidthMatches.length >= 3;
  quality.deprecatedTagsFound = foundDeprecated;
  quality.hasDeprecatedTags = foundDeprecated.length > 0;
  quality.hasLangAttribute = /<html[^>]+\blang\s*=/i.test(html);

  const jqueryMatch =
    html.match(/jquery[-/.](\d+)\.(\d+)(?:\.(\d+))?/i) ||
    html.match(/jquery@(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (jqueryMatch?.[1] && jqueryMatch[2]) {
    const major = parseInt(jqueryMatch[1], 10);
    const minor = parseInt(jqueryMatch[2], 10);
    quality.jqueryVersion = `${jqueryMatch[1]}.${jqueryMatch[2]}${jqueryMatch[3] ? `.${jqueryMatch[3]}` : ''}`;
    quality.isOldJquery = major < 2 || (major === 2 && minor === 0);
  }

  for (const { label, patterns } of TEMPLATE_FINGERPRINTS) {
    if (patterns.some((pattern) => pattern.test(html))) {
      quality.templateFingerprint = label;
      break;
    }
  }
}
