import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { TasksWidget } from '@/components/crm/TasksWidget';
import { TasksDropdown } from '@/components/tasks/TasksDropdown';
import { CrmTasksProvider } from '@/lib/hooks/useCrmTasks';
import type { Task, TaskStats } from '@/types';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: successToast, error: errorToast },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function task(id: string, title: string): Task {
  return {
    id,
    title,
    description: null,
    type: 'follow_up',
    dueAt: '2099-07-26T14:00:00.000Z',
    priority: 'medium',
    completedAt: null,
    leadId: null,
    lead: null,
    createdAt: '2026-07-25T10:00:00.000Z',
  };
}

function stats(tasks: Task[], total = tasks.length): TaskStats {
  return {
    total,
    pending: tasks.length,
    completed: total - tasks.length,
    overdue: 0,
    dueToday: 0,
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('CRM tasks provider', () => {
  test('deduplicates the initial GET and synchronizes completions across the dropdown and widget', async () => {
    let pendingTasks = [task('task-1', 'Call Acme'), task('task-2', 'Email Beacon')];
    const total = pendingTasks.length;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/tasks?status=pending&include=stats' && method === 'GET') {
        return jsonResponse({ tasks: pendingTasks, stats: stats(pendingTasks, total) });
      }

      if (url.startsWith('/api/tasks/') && method === 'PATCH') {
        const taskId = url.slice('/api/tasks/'.length);
        pendingTasks = pendingTasks.filter((pendingTask) => pendingTask.id !== taskId);
        return jsonResponse({ task: { id: taskId } });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    render(
      <CrmTasksProvider fetcher={fetchMock as typeof fetch}>
        <section aria-label="Dropdown task surface">
          <TasksDropdown />
        </section>
        <section aria-label="Widget task surface">
          <TasksWidget onOpenSlideOver={vi.fn()} />
        </section>
      </CrmTasksProvider>
    );

    const dropdownSurface = screen.getByRole('region', { name: 'Dropdown task surface' });
    const widgetSurface = screen.getByRole('region', { name: 'Widget task surface' });

    await within(widgetSurface).findByText('Call Acme');
    expect(within(widgetSurface).getByText('(2)')).toBeTruthy();
    expect(within(dropdownSurface).getByRole('button', { name: 'Tasks, 2 pending' })).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([input, init]) => {
        return (
          requestUrl(input) === '/api/tasks?status=pending&include=stats' &&
          (init?.method ?? 'GET') === 'GET'
        );
      })
    ).toHaveLength(1);

    fireEvent.click(within(dropdownSurface).getByRole('button', { name: 'Tasks, 2 pending' }));
    expect(await within(dropdownSurface).findByText('Call Acme')).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([input, init]) => {
        return (
          requestUrl(input) === '/api/tasks?status=pending&include=stats' &&
          (init?.method ?? 'GET') === 'GET'
        );
      })
    ).toHaveLength(1);

    fireEvent.click(within(widgetSurface).getByRole('button', { name: 'Complete Call Acme' }));

    await waitFor(() => {
      expect(within(widgetSurface).queryByText('Call Acme')).toBeNull();
      expect(within(dropdownSurface).queryByText('Call Acme')).toBeNull();
      expect(within(widgetSurface).getByText('(1)')).toBeTruthy();
      expect(
        within(dropdownSurface).getByRole('button', { name: 'Tasks, 1 pending' })
      ).toBeTruthy();
    });

    fireEvent.click(within(dropdownSurface).getByRole('button', { name: 'Complete Email Beacon' }));

    await waitFor(() => {
      expect(within(widgetSurface).queryByText('Email Beacon')).toBeNull();
      expect(within(dropdownSurface).queryByText('Email Beacon')).toBeNull();
      expect(
        within(dropdownSurface).getByRole('button', { name: 'Tasks, 0 pending' })
      ).toBeTruthy();
      expect(within(dropdownSurface).getByText('No pending tasks')).toBeTruthy();
    });

    expect(successToast).toHaveBeenCalledTimes(2);
    expect(errorToast).not.toHaveBeenCalled();
  });

  test('preserves shared task data when completion fails', async () => {
    const pendingTasks = [task('task-1', 'Call Acme')];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/tasks?status=pending&include=stats' && method === 'GET') {
        return jsonResponse({ tasks: pendingTasks, stats: stats(pendingTasks) });
      }
      if (url === '/api/tasks/task-1' && method === 'PATCH') {
        return jsonResponse({ error: 'Failed' }, 500);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    render(
      <CrmTasksProvider fetcher={fetchMock as typeof fetch}>
        <TasksWidget onOpenSlideOver={vi.fn()} />
      </CrmTasksProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Complete Call Acme' }));

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Failed to complete task'));
    expect(screen.getByText('Call Acme')).toBeTruthy();
    expect(screen.getByText('(1)')).toBeTruthy();
    expect(successToast).not.toHaveBeenCalled();
  });
});
