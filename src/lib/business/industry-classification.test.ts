import { describe, expect, test } from 'vitest';

import type { IndustryType } from '@/types';
import { detectIndustryType } from './industry-classification';

const industryCases: ReadonlyArray<{
  industryType: IndustryType;
  providerTypes: string[];
}> = [
  { industryType: 'restaurant', providerTypes: ['restaurant'] },
  { industryType: 'salon', providerTypes: ['beauty_salon'] },
  { industryType: 'fitness', providerTypes: ['fitness_center'] },
  { industryType: 'medical', providerTypes: ['medical_clinic'] },
  { industryType: 'retail', providerTypes: ['retail_store'] },
  { industryType: 'automotive', providerTypes: ['car_repair'] },
  { industryType: 'real_estate', providerTypes: ['real_estate_agency'] },
  { industryType: 'professional_services', providerTypes: ['insurance_agency'] },
  { industryType: 'other', providerTypes: ['point_of_interest', 'establishment'] },
];

const collisionCases: ReadonlyArray<{
  expected: IndustryType;
  providerType: string;
}> = [
  { providerType: 'barber_shop', expected: 'salon' },
  { providerType: 'bar', expected: 'restaurant' },
  { providerType: 'car', expected: 'automotive' },
  { providerType: 'repair', expected: 'automotive' },
  { providerType: 'car_repair', expected: 'automotive' },
  { providerType: 'market', expected: 'retail' },
  { providerType: 'supermarket', expected: 'retail' },
  { providerType: 'real_estate_agent', expected: 'real_estate' },
  { providerType: 'real_estate_agency', expected: 'real_estate' },
  { providerType: 'property_management_company', expected: 'real_estate' },
  { providerType: 'carpet_store', expected: 'other' },
  { providerType: 'computer_repair_service', expected: 'other' },
  { providerType: 'marketing_agency', expected: 'other' },
];

describe('detectIndustryType', () => {
  test.each(industryCases)(
    'classifies $industryType provider types',
    ({ industryType, providerTypes }) => {
      expect(detectIndustryType(providerTypes)).toBe(industryType);
    }
  );

  test.each(collisionCases)(
    'classifies $providerType as $expected without substring collisions',
    ({ expected, providerType }) => {
      expect(detectIndustryType([providerType])).toBe(expected);
    }
  );

  test.each([
    {
      providerTypes: ['barber_shop', 'bar'],
      expected: 'restaurant',
      reason: 'restaurant precedes salon',
    },
    {
      providerTypes: ['lawyer', 'real_estate_agency'],
      expected: 'real_estate',
      reason: 'real estate precedes professional services',
    },
    {
      providerTypes: ['medical_clinic', 'car_repair'],
      expected: 'medical',
      reason: 'medical precedes automotive',
    },
  ])(
    'uses rule precedence when $reason regardless of provider order',
    ({ providerTypes, expected }) => {
      expect(detectIndustryType(providerTypes)).toBe(expected);
      expect(detectIndustryType([...providerTypes].reverse())).toBe(expected);
    }
  );

  test('normalizes provider token casing, whitespace, and separators', () => {
    expect(detectIndustryType(['  BARBER-SHOP  '])).toBe('salon');
  });
});
