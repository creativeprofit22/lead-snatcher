import { describe, expect, test } from 'vitest';

import type { IndustryType, ScrapedWebsiteData } from '@/types';
import { INDUSTRY_POLICIES } from './industry-policy';
import { generateOpportunities } from './opportunities';

function scrapedWebsite(overrides: Partial<ScrapedWebsiteData> = {}): ScrapedWebsiteData {
  return {
    url: 'https://example.com',
    isReachable: true,
    loadTimeMs: 250,
    techStack: ['React'],
    hasWordPress: false,
    hasShopify: false,
    hasSquarespace: false,
    hasWix: false,
    hasCustomSite: true,
    estimatedAge: 'recent',
    hasOnlineBooking: true,
    hasContactForm: true,
    hasLiveChat: true,
    hasNewsletter: true,
    hasEcommerce: false,
    hasBlog: true,
    emails: ['hello@example.com'],
    socialLinks: { instagram: 'https://instagram.com/example' },
    socialCount: 1,
    hasMobileViewport: true,
    isHttps: true,
    hasSSLIssues: false,
    hasModernDesign: true,
    imageCount: 10,
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
    scrapedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const expectedWithBooking: Record<IndustryType, string[]> = {
  restaurant: [
    'Online ordering system',
    'Digital menu with QR codes',
    'Food delivery platform integration',
    'Social media marketing for restaurants',
  ],
  salon: [
    'Client management software',
    'Loyalty program digitization',
    'SMS appointment reminders',
    'Before/after gallery for marketing',
  ],
  fitness: [
    'Member management and billing system',
    'Fitness app or member portal',
    'Personal trainer booking system',
    'Virtual class capabilities',
  ],
  medical: [
    'Patient portal development',
    'Telemedicine integration',
    'HIPAA-compliant website and forms',
    'Automated appointment reminders',
  ],
  retail: [
    'E-commerce website development',
    'Inventory management system',
    'Point of sale integration',
    'Customer loyalty program',
    'Local SEO optimization',
  ],
  automotive: [
    'Customer portal for service history',
    'Parts inventory system',
    'Automated service reminders',
    'Review management for auto shops',
  ],
  real_estate: [
    'Property listing website',
    'Virtual tour integration',
    'Lead capture system',
    'CRM implementation',
    'Email marketing automation',
  ],
  professional_services: [
    'Professional website development',
    'Client portal and document management',
    'Invoice and payment system',
    'Content marketing and blog setup',
  ],
  other: [
    'Professional website development',
    'Online presence optimization',
    'Social media marketing',
    'Review management',
    'Digital transformation consulting',
  ],
};

const expectedWithoutBooking: Partial<Record<IndustryType, string[]>> = {
  restaurant: [
    'Table reservation system',
    'Online ordering system',
    'Digital menu with QR codes',
    'Food delivery platform integration',
    'Social media marketing for restaurants',
  ],
  salon: [
    'Online appointment booking system',
    'Client management software',
    'Loyalty program digitization',
    'SMS appointment reminders',
    'Before/after gallery for marketing',
  ],
  fitness: [
    'Online class booking and scheduling',
    'Member management and billing system',
    'Fitness app or member portal',
    'Personal trainer booking system',
    'Virtual class capabilities',
  ],
  medical: [
    'Online appointment booking',
    'Patient portal development',
    'Telemedicine integration',
    'HIPAA-compliant website and forms',
    'Automated appointment reminders',
  ],
  automotive: [
    'Online service booking system',
    'Customer portal for service history',
    'Parts inventory system',
    'Automated service reminders',
    'Review management for auto shops',
  ],
  professional_services: [
    'Online consultation booking',
    'Professional website development',
    'Client portal and document management',
    'Invoice and payment system',
    'Content marketing and blog setup',
  ],
};

const allIndustries = Object.keys(expectedWithBooking) as IndustryType[];

describe('generateOpportunities', () => {
  test.each(allIndustries)(
    'locks reachable %s output with and without online booking',
    (industryType) => {
      const business = {
        website: 'https://example.com',
        phone: '555-0100',
        rating: 4.5,
        reviewCount: 100,
      };
      const withBooking = generateOpportunities(industryType, {
        ...business,
        scrapedData: scrapedWebsite({ hasOnlineBooking: true }),
      });
      const withoutBooking = generateOpportunities(industryType, {
        ...business,
        scrapedData: scrapedWebsite({ hasOnlineBooking: false }),
      });
      const expectedWithout =
        expectedWithoutBooking[industryType] ?? expectedWithBooking[industryType];

      expect(withBooking).toEqual(expectedWithBooking[industryType]);
      expect(withoutBooking).toEqual(expectedWithout);
    }
  );

  test('keeps issue order and caps a degraded-site result at the first eight opportunities', () => {
    const opportunities = generateOpportunities('restaurant', {
      website: 'http://example.com',
      phone: null,
      rating: 3.5,
      reviewCount: 10,
      scrapedData: scrapedWebsite({
        estimatedAge: 'ancient',
        hasMobileViewport: false,
        hasWordPress: true,
        hasModernDesign: false,
        hasOnlineBooking: false,
        hasLiveChat: false,
        hasNewsletter: false,
        hasBlog: false,
        socialLinks: {},
        socialCount: 0,
        isHttps: false,
      }),
    });

    expect(opportunities).toEqual([
      'Website redesign and modernization',
      'Modern UI/UX overhaul',
      'Mobile-responsive website redesign',
      'WordPress theme modernization',
      'Table reservation system',
      'Live chat integration for customer support',
      'Email marketing and newsletter setup',
      'Content marketing and blog setup',
    ]);
    expect(opportunities).toHaveLength(8);
  });

  test('keeps restaurant ordering distinct from its booking recommendation', () => {
    expect(
      generateOpportunities('restaurant', {
        website: 'https://example.com',
        phone: '555-0100',
        rating: 4.5,
        reviewCount: 100,
        scrapedData: scrapedWebsite({ hasOnlineBooking: false }),
      })
    ).toEqual(expectedWithoutBooking.restaurant);
  });

  test('keeps distinct IDs in the same category while removing an exact-ID duplicate', () => {
    const fitnessPolicy = INDUSTRY_POLICIES.fitness;
    const trainerBooking = fitnessPolicy.opportunities.find(
      (opportunity) => opportunity.id === 'fitness.trainer-booking'
    );
    const opportunities = generateOpportunities('fitness', {
      website: 'https://example.com',
      phone: '555-0100',
      rating: 4.5,
      reviewCount: 100,
      scrapedData: scrapedWebsite({ hasOnlineBooking: false }),
    });

    expect(trainerBooking?.category).toBe(fitnessPolicy.bookingRecommendation.category);
    expect(opportunities).toEqual(expectedWithoutBooking.fitness);
    expect(
      opportunities.filter((label) => label === fitnessPolicy.bookingRecommendation.label)
    ).toHaveLength(1);
  });

  test('recommends automotive booking when missing and omits it when present', () => {
    const business = {
      website: 'https://example.com',
      phone: '555-0100',
      rating: 4.5,
      reviewCount: 100,
    };

    expect(
      generateOpportunities('automotive', {
        ...business,
        scrapedData: scrapedWebsite({ hasOnlineBooking: false }),
      })
    ).toEqual(expectedWithoutBooking.automotive);
    expect(
      generateOpportunities('automotive', {
        ...business,
        scrapedData: scrapedWebsite({ hasOnlineBooking: true }),
      })
    ).toEqual(expectedWithBooking.automotive);
  });

  test('recommends professional-services booking without treating it as a scored industry', () => {
    expect(
      generateOpportunities('professional_services', {
        website: 'https://example.com',
        phone: '555-0100',
        rating: 4.5,
        reviewCount: 100,
        scrapedData: scrapedWebsite({ hasOnlineBooking: false }),
      })
    ).toEqual(expectedWithoutBooking.professional_services);
    expect(INDUSTRY_POLICIES.professional_services.bookingScored).toBe(false);
  });
});
