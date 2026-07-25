import { afterEach, describe, expect, test } from 'vitest';
import { calculateTaskStats, getTaskDayBoundaries, getTaskDayStatus } from './task-day';

const originalTimezone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimezone;
});

describe('task calendar-day rules', () => {
  test('classifies pending and completed tasks by local calendar day', () => {
    const now = new Date(2026, 6, 25, 14, 0);
    const tasks = [
      { dueAt: new Date(2026, 6, 24, 16, 0) },
      { dueAt: new Date(2026, 6, 25, 10, 0) },
      { dueAt: new Date(2026, 6, 25, 18, 0) },
      { dueAt: new Date(2026, 6, 26, 9, 0) },
      { dueAt: new Date(2026, 6, 24, 9, 0), completedAt: new Date(2026, 6, 24, 12, 0) },
    ];

    expect(
      tasks.map((task) => getTaskDayStatus(task.dueAt, Boolean(task.completedAt), now))
    ).toEqual(['overdue', 'today', 'today', 'upcoming', 'completed']);
    expect(calculateTaskStats(tasks, now)).toEqual({
      total: 5,
      pending: 4,
      completed: 1,
      overdue: 1,
      dueToday: 2,
    });
  });

  test('constructs the next local midnight across a daylight-saving boundary', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 2, 8, 12, 0);

    const { startOfToday, startOfTomorrow } = getTaskDayBoundaries(now);

    expect(startOfToday.getHours()).toBe(0);
    expect(startOfTomorrow.getHours()).toBe(0);
    expect(startOfToday.getDate()).toBe(8);
    expect(startOfTomorrow.getDate()).toBe(9);
    expect(startOfTomorrow.getTime() - startOfToday.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});
