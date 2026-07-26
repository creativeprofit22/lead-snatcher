import type { IndustryType, ScrapedWebsiteData } from '@/types';
import { INDUSTRY_POLICIES, type OpportunityDefinition } from './industry-policy';
import { isSocialProfileUrl } from './social-profile-url';

export { detectIndustryType } from './industry-classification';

interface BusinessData {
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  types?: string[];
  scrapedData?: ScrapedWebsiteData | null;
}

const opportunity = (
  id: OpportunityDefinition['id'],
  category: OpportunityDefinition['category'],
  label: string
): OpportunityDefinition => ({ id, category, label });

// Base opportunities based on what's missing
const BASE_OPPORTUNITIES = {
  noWebsite: [
    opportunity('website.design-development', 'website', 'Website design and development'),
    opportunity('search.google-business-profile', 'search', 'Google Business Profile optimization'),
    opportunity('search.basic-seo', 'search', 'Basic SEO setup'),
  ],
  socialOnlyWebsite: [
    opportunity(
      'website.replace-social-profile',
      'website',
      'Professional website to replace social media presence'
    ),
    opportunity(
      'communications.domain-email',
      'communications',
      'Custom domain and professional email setup'
    ),
    opportunity(
      'marketing.brand-presence',
      'marketing',
      'Brand identity and online presence upgrade'
    ),
  ],
  hasWebsite: [
    opportunity('search.seo-audit', 'search', 'SEO audit and optimization'),
    opportunity('website.redesign', 'website', 'Website redesign and modernization'),
    opportunity('website.speed-mobile', 'website', 'Website speed and mobile optimization'),
    opportunity('website.conversion-optimization', 'website', 'Conversion rate optimization'),
  ],
  noPhone: [
    opportunity('communications.phone-system', 'communications', 'Business phone system setup'),
    opportunity(
      'communications.call-routing',
      'communications',
      'Professional phone number and call routing'
    ),
  ],
  lowRating: [
    opportunity(
      'reputation.rating-improvement',
      'reputation',
      'Reputation management and review improvement'
    ),
    opportunity(
      'operations.service-improvement',
      'operations',
      'Customer feedback and service improvement consulting'
    ),
  ],
  lowReviews: [
    opportunity(
      'reputation.review-generation',
      'reputation',
      'Review generation and management system'
    ),
    opportunity('reputation.feedback-automation', 'reputation', 'Customer feedback automation'),
  ],
} as const;

/**
 * Generate business opportunities based on industry and current state.
 * Enhanced with scraped website data for more specific recommendations.
 */
export function generateOpportunities(
  industryType: IndustryType,
  business: BusinessData
): string[] {
  const opportunities: OpportunityDefinition[] = [];
  const scraped = business.scrapedData;
  const industryPolicy = INDUSTRY_POLICIES[industryType];

  // 1. Website-based opportunities
  if (!business.website) {
    opportunities.push(...BASE_OPPORTUNITIES.noWebsite);
  } else if (isSocialProfileUrl(business.website)) {
    opportunities.push(...BASE_OPPORTUNITIES.socialOnlyWebsite);
  } else {
    // Has website - check scraped data for specific issues
    if (scraped?.isReachable) {
      // Outdated website
      if (scraped.estimatedAge === 'outdated' || scraped.estimatedAge === 'ancient') {
        opportunities.push(
          opportunity('website.redesign', 'website', 'Website redesign and modernization')
        );
        opportunities.push(opportunity('website.modern-ui', 'website', 'Modern UI/UX overhaul'));
      }

      // No mobile viewport
      if (!scraped.hasMobileViewport) {
        opportunities.push(
          opportunity('website.mobile-responsive', 'website', 'Mobile-responsive website redesign')
        );
      }

      // Old tech stack
      if (scraped.hasWordPress && !scraped.hasModernDesign) {
        opportunities.push(
          opportunity('website.wordpress-modernization', 'website', 'WordPress theme modernization')
        );
      }

      if (!scraped.hasOnlineBooking && industryPolicy.bookingRecommendation) {
        opportunities.push(industryPolicy.bookingRecommendation);
      }

      if (!scraped.hasLiveChat) {
        opportunities.push(
          opportunity(
            'communications.live-chat',
            'communications',
            'Live chat integration for customer support'
          )
        );
      }

      if (!scraped.hasNewsletter) {
        opportunities.push(
          opportunity(
            'marketing.email-newsletter',
            'marketing',
            'Email marketing and newsletter setup'
          )
        );
      }

      if (!scraped.hasBlog) {
        opportunities.push(
          opportunity('content.blog', 'content', 'Content marketing and blog setup')
        );
      }

      // No social links on website
      if (scraped.socialCount === 0) {
        opportunities.push(
          opportunity(
            'marketing.website-social-links',
            'marketing',
            'Social media integration on website'
          )
        );
      }

      // No HTTPS
      if (!scraped.isHttps) {
        opportunities.push(
          opportunity('website.ssl-security', 'website', 'SSL certificate and security upgrade')
        );
      }
    } else {
      // Website exists but couldn't be scraped - generic recommendations
      opportunities.push(...BASE_OPPORTUNITIES.hasWebsite);
    }
  }

  // 2. Communication opportunities
  if (!business.phone) {
    opportunities.push(...BASE_OPPORTUNITIES.noPhone);
  }

  // 3. Reputation opportunities
  if (business.rating && business.rating < 4.0) {
    opportunities.push(...BASE_OPPORTUNITIES.lowRating);
  } else if (!business.reviewCount || business.reviewCount < 50) {
    opportunities.push(...BASE_OPPORTUNITIES.lowReviews);
  }

  // 4. Industry-specific opportunities
  const hasConfirmedBooking = scraped?.isReachable === true && scraped.hasOnlineBooking;
  for (const industryOpportunity of industryPolicy.opportunities) {
    if (
      hasConfirmedBooking &&
      industryOpportunity.id === industryPolicy.bookingRecommendation?.id
    ) {
      continue;
    }

    opportunities.push(industryOpportunity);
  }

  // Exact IDs remove repeated recommendations without suppressing related opportunities.
  const uniqueOpportunities: OpportunityDefinition[] = [];
  const seenIds = new Set<OpportunityDefinition['id']>();
  for (const candidate of opportunities) {
    if (!seenIds.has(candidate.id)) {
      seenIds.add(candidate.id);
      uniqueOpportunities.push(candidate);
    }
  }

  return uniqueOpportunities.slice(0, 8).map((candidate) => candidate.label);
}
