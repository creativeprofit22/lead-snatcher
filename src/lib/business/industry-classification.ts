import type { IndustryType } from '@/types';

type ClassifiedIndustryType = Exclude<IndustryType, 'other'>;

interface IndustryClassificationRule {
  industryType: ClassifiedIndustryType;
  tokens: readonly string[];
}

/**
 * Rules are evaluated in order so multi-category businesses classify consistently.
 * Tokens are exact after normalization; aliases must be added explicitly.
 */
const INDUSTRY_CLASSIFICATION_RULES: readonly IndustryClassificationRule[] = [
  {
    industryType: 'restaurant',
    tokens: [
      'restaurant',
      'cafe',
      'coffee',
      'coffee_shop',
      'bar',
      'bakery',
      'food',
      'meal_delivery',
      'meal_takeaway',
    ],
  },
  {
    industryType: 'salon',
    tokens: [
      'salon',
      'spa',
      'beauty',
      'beauty_salon',
      'barber',
      'barber_shop',
      'hair',
      'hair_care',
      'hair_salon',
      'nail_salon',
    ],
  },
  {
    industryType: 'fitness',
    tokens: [
      'gym',
      'fitness',
      'fitness_center',
      'yoga',
      'yoga_studio',
      'pilates',
      'pilates_studio',
    ],
  },
  {
    industryType: 'medical',
    tokens: [
      'dentist',
      'doctor',
      'clinic',
      'medical',
      'medical_clinic',
      'health',
      'hospital',
      'pharmacy',
      'physiotherapist',
    ],
  },
  {
    industryType: 'retail',
    tokens: [
      'store',
      'shop',
      'retail',
      'retail_store',
      'boutique',
      'market',
      'supermarket',
      'grocery_store',
      'shopping_mall',
    ],
  },
  {
    industryType: 'automotive',
    tokens: [
      'car',
      'car_dealer',
      'car_rental',
      'car_repair',
      'car_wash',
      'auto',
      'auto_dealer',
      'auto_repair',
      'auto_repair_shop',
      'automotive',
      'mechanic',
      'repair',
      'dealer',
    ],
  },
  {
    industryType: 'real_estate',
    tokens: [
      'real_estate',
      'real_estate_agent',
      'real_estate_agency',
      'property',
      'property_manager',
      'property_management_company',
      'realtor',
    ],
  },
  {
    industryType: 'professional_services',
    tokens: [
      'lawyer',
      'accountant',
      'accounting',
      'consultant',
      'insurance',
      'insurance_agency',
      'finance',
      'financial_advisor',
    ],
  },
];

function normalizeProviderToken(type: string): string {
  return type
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

export function detectIndustryType(types: readonly string[]): IndustryType {
  const providerTokens = new Set(types.map(normalizeProviderToken));

  for (const rule of INDUSTRY_CLASSIFICATION_RULES) {
    if (rule.tokens.some((token) => providerTokens.has(token))) {
      return rule.industryType;
    }
  }

  return 'other';
}
