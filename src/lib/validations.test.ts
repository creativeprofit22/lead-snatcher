import { describe, expect, test } from 'vitest';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/constants';
import { businessEnrichSchema, businessSearchSchema, createTaskSchema } from '@/lib/validations';

describe('country defaults', () => {
  test('uses the canonical US default for search and enrichment validation', () => {
    const search = businessSearchSchema.parse({ businessType: 'restaurant', city: 'Chicago' });
    const enrichment = businessEnrichSchema.parse({
      city: 'Chicago',
      leads: [
        {
          businessId: 'business-1',
          name: 'Example Business',
          needsWebsite: true,
          needsSocials: false,
        },
      ],
    });

    expect(DEFAULT_COUNTRY_CODE).toBe('us');
    expect(search.country).toBe(DEFAULT_COUNTRY_CODE);
    expect(enrichment.country).toBe(DEFAULT_COUNTRY_CODE);
    expect(COUNTRIES[0]?.code).toBe(DEFAULT_COUNTRY_CODE);
  });
});

describe('task validation', () => {
  test('accepts null when creating an unassigned task', () => {
    const task = createTaskSchema.parse({
      title: 'Standalone follow-up',
      dueAt: '2026-07-25T09:00:00.000Z',
      leadId: null,
    });

    expect(task.leadId).toBeNull();
  });
});
