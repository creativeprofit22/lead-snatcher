import { describe, expect, test } from 'vitest';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/constants';
import {
  businessEnrichSchema,
  businessSearchSchema,
  createTagSchema,
  createTaskSchema,
  updateTagSchema,
} from '@/lib/validations';

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

describe('tag validation', () => {
  const color = '#3b82f6';

  test('rejects whitespace-only names', () => {
    expect(createTagSchema.safeParse({ name: '   ', color }).success).toBe(false);
    expect(updateTagSchema.safeParse({ name: '\t\n' }).success).toBe(false);
  });

  test('normalizes surrounding whitespace', () => {
    expect(createTagSchema.parse({ name: '  Priority  ', color }).name).toBe('Priority');
    expect(updateTagSchema.parse({ name: '\tPriority\n' }).name).toBe('Priority');
  });

  test('applies the length limit after trimming', () => {
    const maximumLengthName = 'a'.repeat(100);
    const overLengthName = 'a'.repeat(101);

    expect(createTagSchema.parse({ name: ` ${maximumLengthName} `, color }).name).toBe(
      maximumLengthName
    );
    expect(updateTagSchema.parse({ name: ` ${maximumLengthName} ` }).name).toBe(maximumLengthName);
    expect(createTagSchema.safeParse({ name: ` ${overLengthName} `, color }).success).toBe(false);
    expect(updateTagSchema.safeParse({ name: ` ${overLengthName} ` }).success).toBe(false);
  });
});
