import type { TaskStats } from '@/types';

export type TaskDayStatus = 'completed' | 'overdue' | 'today' | 'upcoming';

interface TaskDateFields {
  dueAt: Date | string;
  completedAt?: Date | string | null;
}

/**
 * "Today" follows the local calendar of the runtime evaluating the task.
 * Lead Snatcher is a local app, so the server and browser default to the host machine's timezone.
 */
export function getTaskDayBoundaries(now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const date = now.getDate();

  return {
    startOfToday: new Date(year, month, date),
    startOfTomorrow: new Date(year, month, date + 1),
    startOfNextWeek: new Date(year, month, date + 7),
  };
}

export function getTaskDayStatus(
  dueAt: Date | string,
  isCompleted: boolean,
  now: Date
): TaskDayStatus {
  if (isCompleted) return 'completed';

  const dueDate = dueAt instanceof Date ? dueAt : new Date(dueAt);
  const { startOfToday, startOfTomorrow } = getTaskDayBoundaries(now);

  if (dueDate < startOfToday) return 'overdue';
  if (dueDate < startOfTomorrow) return 'today';
  return 'upcoming';
}

export function calculateTaskStats(tasks: TaskDateFields[], now: Date): TaskStats {
  const stats: TaskStats = {
    total: tasks.length,
    pending: 0,
    completed: 0,
    overdue: 0,
    dueToday: 0,
  };

  for (const task of tasks) {
    const status = getTaskDayStatus(task.dueAt, Boolean(task.completedAt), now);

    if (status === 'completed') {
      stats.completed += 1;
      continue;
    }

    stats.pending += 1;
    if (status === 'overdue') stats.overdue += 1;
    if (status === 'today') stats.dueToday += 1;
  }

  return stats;
}
