import { describe, expect, test } from 'vitest';
import { KANBAN_LEAD_STATUSES, LEAD_STATUS_METADATA, LEAD_STATUS_VALUES } from '@/lib/lead-status';
import { leadStatusSchema } from '@/lib/validations';

describe('lead status contract', () => {
  test('defines metadata for every canonical status and no others', () => {
    expect(Object.keys(LEAD_STATUS_METADATA)).toEqual([...LEAD_STATUS_VALUES]);

    for (const status of LEAD_STATUS_VALUES) {
      expect(LEAD_STATUS_METADATA[status]).toMatchObject({
        label: expect.any(String),
        badgeClassName: expect.any(String),
        kanbanOrder: expect.any(Number),
        kanbanVisible: expect.any(Boolean),
        terminal: expect.any(Boolean),
        pipeline: expect.any(Boolean),
      });
    }
  });

  test.each(LEAD_STATUS_VALUES)('accepts canonical status %s in validation', (status) => {
    expect(leadStatusSchema.parse(status)).toBe(status);
  });

  test('keeps every visible status in a unique Kanban stage', () => {
    const kanbanStatuses = KANBAN_LEAD_STATUSES.map((status) => status.id);

    expect(kanbanStatuses).toEqual([...LEAD_STATUS_VALUES]);
    expect(new Set(kanbanStatuses).size).toBe(LEAD_STATUS_VALUES.length);
  });
});
