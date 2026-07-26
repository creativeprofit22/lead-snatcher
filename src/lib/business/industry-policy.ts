import type { IndustryType } from '@/types';

export type OpportunityCategory =
  | 'booking'
  | 'communications'
  | 'commerce'
  | 'content'
  | 'customer-management'
  | 'marketing'
  | 'operations'
  | 'reputation'
  | 'search'
  | 'website';

export type OpportunityId = `${string}.${string}`;

export interface OpportunityDefinition {
  readonly id: OpportunityId;
  readonly category: OpportunityCategory;
  readonly label: string;
}

export interface IndustryPolicy {
  readonly bookingScored: boolean;
  readonly bookingRecommendation: OpportunityDefinition | null;
  readonly opportunities: readonly OpportunityDefinition[];
}

const restaurantBooking = {
  id: 'restaurant.table-reservations',
  category: 'booking',
  label: 'Table reservation system',
} as const satisfies OpportunityDefinition;

const salonBooking = {
  id: 'salon.appointment-booking',
  category: 'booking',
  label: 'Online appointment booking system',
} as const satisfies OpportunityDefinition;

const fitnessBooking = {
  id: 'fitness.class-booking',
  category: 'booking',
  label: 'Online class booking and scheduling',
} as const satisfies OpportunityDefinition;

const medicalBooking = {
  id: 'medical.appointment-booking',
  category: 'booking',
  label: 'Online appointment booking',
} as const satisfies OpportunityDefinition;

const automotiveBooking = {
  id: 'automotive.service-booking',
  category: 'booking',
  label: 'Online service booking system',
} as const satisfies OpportunityDefinition;

const professionalServicesBooking = {
  id: 'professional-services.consultation-booking',
  category: 'booking',
  label: 'Online consultation booking',
} as const satisfies OpportunityDefinition;

export const INDUSTRY_POLICIES = {
  restaurant: {
    bookingScored: true,
    bookingRecommendation: restaurantBooking,
    opportunities: [
      {
        id: 'restaurant.online-ordering',
        category: 'commerce',
        label: 'Online ordering system',
      },
      {
        id: 'restaurant.digital-menu',
        category: 'commerce',
        label: 'Digital menu with QR codes',
      },
      restaurantBooking,
      {
        id: 'restaurant.delivery-integration',
        category: 'commerce',
        label: 'Food delivery platform integration',
      },
      {
        id: 'restaurant.social-marketing',
        category: 'marketing',
        label: 'Social media marketing for restaurants',
      },
    ],
  },
  salon: {
    bookingScored: true,
    bookingRecommendation: salonBooking,
    opportunities: [
      salonBooking,
      {
        id: 'salon.client-management',
        category: 'customer-management',
        label: 'Client management software',
      },
      {
        id: 'salon.loyalty-program',
        category: 'customer-management',
        label: 'Loyalty program digitization',
      },
      {
        id: 'salon.appointment-reminders',
        category: 'communications',
        label: 'SMS appointment reminders',
      },
      {
        id: 'salon.before-after-gallery',
        category: 'marketing',
        label: 'Before/after gallery for marketing',
      },
    ],
  },
  fitness: {
    bookingScored: true,
    bookingRecommendation: fitnessBooking,
    opportunities: [
      {
        id: 'fitness.member-management',
        category: 'customer-management',
        label: 'Member management and billing system',
      },
      fitnessBooking,
      {
        id: 'fitness.member-portal',
        category: 'customer-management',
        label: 'Fitness app or member portal',
      },
      {
        id: 'fitness.trainer-booking',
        category: 'booking',
        label: 'Personal trainer booking system',
      },
      {
        id: 'fitness.virtual-classes',
        category: 'commerce',
        label: 'Virtual class capabilities',
      },
    ],
  },
  medical: {
    bookingScored: true,
    bookingRecommendation: medicalBooking,
    opportunities: [
      {
        id: 'medical.patient-portal',
        category: 'customer-management',
        label: 'Patient portal development',
      },
      medicalBooking,
      {
        id: 'medical.telemedicine',
        category: 'commerce',
        label: 'Telemedicine integration',
      },
      {
        id: 'medical.hipaa-website',
        category: 'website',
        label: 'HIPAA-compliant website and forms',
      },
      {
        id: 'medical.appointment-reminders',
        category: 'communications',
        label: 'Automated appointment reminders',
      },
    ],
  },
  retail: {
    bookingScored: false,
    bookingRecommendation: null,
    opportunities: [
      {
        id: 'retail.ecommerce-website',
        category: 'commerce',
        label: 'E-commerce website development',
      },
      {
        id: 'retail.inventory-management',
        category: 'operations',
        label: 'Inventory management system',
      },
      {
        id: 'retail.point-of-sale',
        category: 'operations',
        label: 'Point of sale integration',
      },
      {
        id: 'retail.loyalty-program',
        category: 'customer-management',
        label: 'Customer loyalty program',
      },
      { id: 'search.local-seo', category: 'search', label: 'Local SEO optimization' },
    ],
  },
  automotive: {
    bookingScored: true,
    bookingRecommendation: automotiveBooking,
    opportunities: [
      automotiveBooking,
      {
        id: 'automotive.service-history-portal',
        category: 'customer-management',
        label: 'Customer portal for service history',
      },
      {
        id: 'automotive.parts-inventory',
        category: 'operations',
        label: 'Parts inventory system',
      },
      {
        id: 'automotive.service-reminders',
        category: 'communications',
        label: 'Automated service reminders',
      },
      {
        id: 'automotive.review-management',
        category: 'reputation',
        label: 'Review management for auto shops',
      },
    ],
  },
  real_estate: {
    bookingScored: false,
    bookingRecommendation: null,
    opportunities: [
      {
        id: 'real-estate.property-listings',
        category: 'website',
        label: 'Property listing website',
      },
      {
        id: 'real-estate.virtual-tours',
        category: 'marketing',
        label: 'Virtual tour integration',
      },
      {
        id: 'real-estate.lead-capture',
        category: 'customer-management',
        label: 'Lead capture system',
      },
      {
        id: 'customer-management.crm',
        category: 'customer-management',
        label: 'CRM implementation',
      },
      {
        id: 'marketing.email-automation',
        category: 'marketing',
        label: 'Email marketing automation',
      },
    ],
  },
  professional_services: {
    bookingScored: false,
    bookingRecommendation: professionalServicesBooking,
    opportunities: [
      {
        id: 'website.professional',
        category: 'website',
        label: 'Professional website development',
      },
      professionalServicesBooking,
      {
        id: 'professional-services.client-portal',
        category: 'customer-management',
        label: 'Client portal and document management',
      },
      {
        id: 'professional-services.invoicing',
        category: 'operations',
        label: 'Invoice and payment system',
      },
      {
        id: 'content.blog',
        category: 'content',
        label: 'Content marketing and blog setup',
      },
    ],
  },
  other: {
    bookingScored: false,
    bookingRecommendation: null,
    opportunities: [
      {
        id: 'website.professional',
        category: 'website',
        label: 'Professional website development',
      },
      {
        id: 'marketing.online-presence',
        category: 'marketing',
        label: 'Online presence optimization',
      },
      {
        id: 'marketing.social-media',
        category: 'marketing',
        label: 'Social media marketing',
      },
      {
        id: 'reputation.management',
        category: 'reputation',
        label: 'Review management',
      },
      {
        id: 'operations.digital-transformation',
        category: 'operations',
        label: 'Digital transformation consulting',
      },
    ],
  },
} as const satisfies Record<IndustryType, IndustryPolicy>;
