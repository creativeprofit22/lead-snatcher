import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TasksWidget } from '@/components/crm/TasksWidget';
import { calculateTaskStats } from '@/lib/business/task-day';
import type { Task } from '@/types';
import { TaskItem } from './TaskItem';
import { TaskList } from './TaskList';
import { TasksDropdown } from './TasksDropdown';

const { useCrmTasksMock } = vi.hoisted(() => ({
  useCrmTasksMock: vi.fn(),
}));

vi.mock('@/lib/hooks/useCrmTasks', () => ({
  useCrmTasks: useCrmTasksMock,
}));

const now = new Date(2026, 6, 25, 14, 0);

function createTask(id: string, title: string, dueAt: Date, completedAt?: Date): Task {
  return {
    id,
    title,
    description: null,
    type: 'follow_up',
    dueAt: dueAt.toISOString(),
    priority: 'medium',
    completedAt: completedAt?.toISOString() ?? null,
    leadId: null,
    lead: null,
    createdAt: new Date(2026, 6, 20, 9, 0).toISOString(),
  };
}

const allTasks = [
  createTask('yesterday', 'Yesterday', new Date(2026, 6, 24, 16, 0)),
  createTask('earlier-today', 'Earlier today', new Date(2026, 6, 25, 10, 0)),
  createTask('later-today', 'Later today', new Date(2026, 6, 25, 18, 0)),
  createTask('tomorrow', 'Tomorrow', new Date(2026, 6, 26, 9, 0)),
  createTask(
    'completed',
    'Completed yesterday',
    new Date(2026, 6, 24, 9, 0),
    new Date(2026, 6, 24, 12, 0)
  ),
];
const pendingTasks = allTasks.filter((task) => !task.completedAt);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  useCrmTasksMock.mockReturnValue({
    tasks: pendingTasks,
    stats: calculateTaskStats(allTasks, now),
    loading: false,
    error: null,
    completingTaskIds: new Set<string>(),
    refetch: vi.fn().mockResolvedValue(undefined),
    completeTask: vi.fn().mockResolvedValue(true),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('task day status surfaces', () => {
  test('keeps sections, row colors, and overdue counts aligned', () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);

    render(
      <>
        <section aria-label="Task list surface">
          <TaskList
            tasks={allTasks}
            showCompleted
            onComplete={onComplete}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
          />
        </section>
        <section aria-label="Task item surface">
          <TaskItem
            task={allTasks[1]!}
            onComplete={onComplete}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
          />
        </section>
        <section aria-label="Dropdown surface">
          <TasksDropdown />
        </section>
        <section aria-label="Widget surface">
          <TasksWidget onOpenSlideOver={vi.fn()} />
        </section>
      </>
    );

    const taskList = screen.getByRole('region', { name: 'Task list surface' });
    expect(within(taskList).getByRole('heading', { name: 'Overdue (1)' })).toBeTruthy();
    expect(within(taskList).getByRole('heading', { name: 'Today (2)' })).toBeTruthy();
    expect(within(taskList).getByRole('heading', { name: 'Upcoming (1)' })).toBeTruthy();
    expect(within(taskList).getByRole('heading', { name: 'Completed (1)' })).toBeTruthy();

    const taskItem = screen.getByRole('region', { name: 'Task item surface' });
    const taskItemDueDate = within(taskItem).getByText(/^Today,/);
    expect(taskItemDueDate.className).toContain('text-orange-400');
    expect(taskItemDueDate.className).not.toContain('text-red-400');

    const dropdown = screen.getByRole('region', { name: 'Dropdown surface' });
    fireEvent.click(within(dropdown).getByRole('button', { name: 'Tasks, 4 pending' }));
    expect(within(dropdown).getByText('1 overdue')).toBeTruthy();
    const dropdownTodayTitle = within(dropdown).getByText('Earlier today');
    expect(dropdownTodayTitle.nextElementSibling?.className).toContain('text-orange-400');

    const widget = screen.getByRole('region', { name: 'Widget surface' });
    expect(within(widget).getByText('(4)')).toBeTruthy();
    expect(within(widget).getByText('1 overdue')).toBeTruthy();
    const widgetTodayTitle = within(widget).getByText('Earlier today');
    const widgetTodayDate = widgetTodayTitle.nextElementSibling?.querySelector('span');
    expect(widgetTodayDate?.className).toContain('text-orange-400');
  });
});
