import { describe, expect, test } from 'vitest';

import {
  formatLeadDetailTimestamp,
  parseFollowUpDate,
  serializeFollowUpInputToIso,
} from './LeadDetailModal.dates';

describe('parseFollowUpDate', () => {
  test.each([null, undefined, '', '   '])('returns no value for %j', (value) => {
    expect(parseFollowUpDate(value)).toBeNull();
  });

  test('parses a date-only value as a local date', () => {
    expect(parseFollowUpDate('2026-07-19')).toEqual({
      inputValue: '2026-07-19',
      displayValue: new Date(2026, 6, 19).toLocaleDateString(),
    });
  });

  test('uses an ISO timestamp date for the input and the parsed timestamp for display', () => {
    const timestamp = '2026-07-19T15:30:00.000Z';

    expect(parseFollowUpDate(timestamp)).toEqual({
      inputValue: '2026-07-19',
      displayValue: new Date(timestamp).toLocaleDateString(),
    });
  });

  test('uses the source date for an offset timestamp input and the instant for display', () => {
    const timestamp = '2026-07-19T23:30:00-07:00';

    expect(parseFollowUpDate(timestamp)).toEqual({
      inputValue: '2026-07-19',
      displayValue: new Date(timestamp).toLocaleDateString(),
    });
  });

  test.each([
    'not-a-date',
    '2026-07-19 15:30:00.000Z',
    '2026-07-19Tnot-a-time',
    '2026-13-01',
    '2026-02-30',
    '2026-02-30T15:30:00.000Z',
  ])('returns no value for malformed or impossible input %s', (value) => {
    expect(parseFollowUpDate(value)).toBeNull();
  });
});

describe('serializeFollowUpInputToIso', () => {
  test('serializes a date input at noon UTC', () => {
    expect(serializeFollowUpInputToIso('2026-07-19')).toBe('2026-07-19T12:00:00.000Z');
  });

  test('serializes an empty input as null', () => {
    expect(serializeFollowUpInputToIso('')).toBeNull();
  });
});

describe('formatLeadDetailTimestamp', () => {
  test('formats a timestamp with the lead-detail en-US options', () => {
    const timestamp = '2026-07-20T10:15:00.000Z';

    expect(formatLeadDetailTimestamp(timestamp)).toBe(
      new Date(timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    );
  });
});
