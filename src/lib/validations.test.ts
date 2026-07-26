import { describe, expect, test } from 'vitest';
import { API_KEY_MAX_LENGTH } from '@/lib/api-key-services';
import { createScoreBreakdown } from '@/lib/business/score-breakdown-contract';
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from '@/lib/constants';
import {
  businessEnrichSchema,
  businessSearchSchema,
  createLeadSchema,
  createTagSchema,
  createTaskSchema,
  saveApiKeySchema,
  updateTagSchema,
  updateTaskSchema,
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

describe('API key validation', () => {
  test('rejects whitespace-only keys', () => {
    expect(saveApiKeySchema.safeParse({ service: 'rapidapi', key: ' \t\n ' }).success).toBe(false);
  });

  test('normalizes surrounding whitespace before validation', () => {
    expect(saveApiKeySchema.parse({ service: 'rapidapi', key: '  secret-key  ' }).key).toBe(
      'secret-key'
    );
  });

  test('accepts 500 characters after trimming', () => {
    const key = 'a'.repeat(API_KEY_MAX_LENGTH);

    expect(saveApiKeySchema.parse({ service: 'pagespeed', key: ` ${key} ` }).key).toBe(key);
  });

  test('rejects 501 characters', () => {
    const key = 'a'.repeat(API_KEY_MAX_LENGTH + 1);

    expect(saveApiKeySchema.safeParse({ service: 'rapidapi', key }).success).toBe(false);
  });

  test.each(['youtube', 'openrouter', 'mailchimp'])('rejects unsupported service %s', (service) => {
    expect(saveApiKeySchema.safeParse({ service, key: 'secret-key' }).success).toBe(false);
  });
});

describe('business search validation', () => {
  const requiredFields = { businessType: 'restaurant', city: 'Chicago' };

  test('accepts city-centroid searches without coordinates', () => {
    const parsed = businessSearchSchema.parse(requiredFields);

    expect(parsed.searchLat).toBeUndefined();
    expect(parsed.searchLng).toBeUndefined();
    expect(parsed.zoneLabel).toBeUndefined();
  });

  test('accepts targeted searches with both coordinates and a zone label', () => {
    expect(
      businessSearchSchema.parse({
        ...requiredFields,
        searchLat: 41.881_832,
        searchLng: -87.623_177,
        zoneLabel: 'The Loop',
      })
    ).toMatchObject({
      searchLat: 41.881_832,
      searchLng: -87.623_177,
      zoneLabel: 'The Loop',
    });
  });

  test.each([
    ['latitude only', { searchLat: 41.881_832 }, ['searchLng']],
    ['longitude only', { searchLng: -87.623_177 }, ['searchLat']],
  ])('rejects %s with the stable coordinate-pair issue first', (_case, coordinates, path) => {
    const result = businessSearchSchema.safeParse({ ...requiredFields, ...coordinates });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected coordinate validation to fail');
    expect(result.error.issues[0]).toMatchObject({
      code: 'custom',
      message: 'searchLat and searchLng must be provided together',
      path,
    });
  });

  test('rejects a zone label without targeted coordinates', () => {
    const result = businessSearchSchema.safeParse({
      ...requiredFields,
      zoneLabel: 'The Loop',
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected zone label validation to fail');
    expect(result.error.issues[0]).toMatchObject({
      code: 'custom',
      message: 'zoneLabel requires searchLat and searchLng',
      path: ['zoneLabel'],
    });
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

  test('trims task titles and rejects visually blank titles', () => {
    expect(
      createTaskSchema.parse({ title: '  Follow up  ', dueAt: '2026-07-25T09:00:00Z' }).title
    ).toBe('Follow up');
    expect(
      createTaskSchema.safeParse({ title: '   ', dueAt: '2026-07-25T09:00:00Z' }).success
    ).toBe(false);
    expect(updateTaskSchema.safeParse({ title: '\t\n' }).success).toBe(false);
  });

  test.each(['not-a-date', '2026-02-30T09:00:00Z'])(`rejects invalid due date %s`, (dueAt) => {
    expect(createTaskSchema.safeParse({ title: 'Follow up', dueAt }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ dueAt }).success).toBe(false);
  });

  test('accepts UTC-offset ISO due dates', () => {
    const dueAt = '2026-07-25T09:00:00+05:30';

    expect(createTaskSchema.parse({ title: 'Follow up', dueAt }).dueAt).toBe(dueAt);
    expect(updateTaskSchema.parse({ dueAt }).dueAt).toBe(dueAt);
  });

  test('allows PATCH fields to be omitted and completedAt to be null', () => {
    expect(updateTaskSchema.parse({})).toEqual({});
    expect(updateTaskSchema.parse({ completedAt: null })).toEqual({ completedAt: null });
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

describe('create lead score breakdown validation', () => {
  const requiredLeadFields = { placeId: 'place-1', name: 'Acme Dental' };

  test('accepts a complete current record and recalculates its canonical totals', () => {
    const currentScoreBreakdown = createScoreBreakdown({
      noWebsite: 45,
      noOnlineBooking: 8,
      qualityChips: ['No website'],
      hasMarketingBudget: true,
      marketingPlatforms: ['Google Ads'],
    });

    expect(
      createLeadSchema.parse({
        ...requiredLeadFields,
        scoreBreakdown: { ...currentScoreBreakdown, rawTotal: 999, total: 999 },
      }).scoreBreakdown
    ).toEqual(currentScoreBreakdown);
  });

  test('normalizes a known legacy partial record with canonical array and boolean defaults', () => {
    const scoreBreakdown = createLeadSchema.parse({
      ...requiredLeadFields,
      // Legacy persisted/search output used +20 and omitted the rest of the contract.
      scoreBreakdown: { noWebsite: 20 },
    }).scoreBreakdown;

    expect(scoreBreakdown).toEqual(createScoreBreakdown({ noWebsite: 20 }));
    expect(scoreBreakdown).toMatchObject({
      qualityChips: [],
      hasMarketingBudget: false,
      marketingPlatforms: [],
      rawTotal: 20,
      total: 20,
    });
  });

  test('strips unknown score keys before persistence', () => {
    const parsed = createLeadSchema.parse({
      ...requiredLeadFields,
      scoreBreakdown: { noWebsite: 20, futureSignal: 9 },
    });

    expect(parsed.scoreBreakdown).toEqual(createScoreBreakdown({ noWebsite: 20 }));
    expect(parsed.scoreBreakdown).not.toHaveProperty('futureSignal');
  });

  test('accepts a capped lead score with an over-cap raw breakdown for saving', () => {
    const scoreBreakdown = createScoreBreakdown({ noWebsite: 100, noPhone: 5 });
    const parsed = createLeadSchema.parse({
      ...requiredLeadFields,
      leadScore: scoreBreakdown.total,
      scoreBreakdown,
    });

    expect(parsed.leadScore).toBe(100);
    expect(parsed.scoreBreakdown).toMatchObject({ rawTotal: 105, total: 100 });
    expect(
      createLeadSchema.safeParse({
        ...requiredLeadFields,
        leadScore: 101,
        scoreBreakdown,
      }).success
    ).toBe(false);
  });

  test.each([
    ['numeric field', { noWebsite: '20' }],
    ['array field', { qualityChips: 'No website' }],
    ['boolean field', { hasMarketingBudget: 'true' }],
  ])('rejects a malformed %s', (_field, scoreBreakdown) => {
    expect(createLeadSchema.safeParse({ ...requiredLeadFields, scoreBreakdown }).success).toBe(
      false
    );
  });
});
