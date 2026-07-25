import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { TasksWidget } from '@/components/crm/TasksWidget';
import { LeadDetailModal } from '@/components/leads/LeadDetailModal';
import { TaskSlideOver } from '@/components/tasks/TaskSlideOver';
import { TasksDropdown } from '@/components/tasks/TasksDropdown';
import { CrmTasksProvider } from '@/lib/hooks/useCrmTasks';
import type { Lead, Task, TaskStats } from '@/types';

const { errorToast } = vi.hoisted(() => ({
  errorToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: errorToast },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function task(id: string, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title,
    description: overrides.description ?? null,
    type: overrides.type ?? 'follow_up',
    dueAt: overrides.dueAt ?? '2099-07-26T14:00:00.000Z',
    priority: overrides.priority ?? 'medium',
    completedAt: overrides.completedAt ?? null,
    leadId: overrides.leadId ?? null,
    lead: overrides.lead ?? null,
    createdAt: overrides.createdAt ?? '2026-07-25T10:00:00.000Z',
  };
}

function taskStats(tasks: Task[]): TaskStats {
  const pendingTasks = tasks.filter((currentTask) => !currentTask.completedAt);
  return {
    total: tasks.length,
    pending: pendingTasks.length,
    completed: tasks.length - pendingTasks.length,
    overdue: 0,
    dueToday: 0,
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

interface MutationGate {
  promise: Promise<boolean>;
  resolve: (successful: boolean) => void;
}

function createMutationGate(): MutationGate {
  let resolve!: (successful: boolean) => void;
  const promise = new Promise<boolean>((gateResolve) => {
    resolve = gateResolve;
  });
  return { promise, resolve };
}

function createTaskApi(initialTasks: Task[]) {
  let tasks = initialTasks;
  let createdTaskNumber = 0;
  let nextMutationGate: MutationGate | null = null;
  let mutationCount = 0;

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url === '/api/tasks?status=pending&include=stats') {
      return jsonResponse({
        tasks: tasks.filter((currentTask) => !currentTask.completedAt),
        stats: taskStats(tasks),
      });
    }

    if (method === 'GET' && url === '/api/tasks?status=all') {
      return jsonResponse({ tasks });
    }

    if (method === 'GET' && url.startsWith('/api/tasks?leadId=')) {
      const leadId = new URLSearchParams(url.split('?')[1]).get('leadId');
      return jsonResponse({ tasks: tasks.filter((currentTask) => currentTask.leadId === leadId) });
    }

    if (method === 'GET' && url.startsWith('/api/leads?')) {
      return jsonResponse({ leads: [{ id: 'lead-1', name: 'Acme Dental' }] });
    }

    if (method === 'GET' && url === '/api/leads/lead-1/contact') {
      return jsonResponse({ contactLogs: [] });
    }

    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
      mutationCount += 1;
      const gate = nextMutationGate;
      nextMutationGate = null;
      if (gate && !(await gate.promise)) {
        return jsonResponse({ error: 'Mutation failed' }, 500);
      }

      if (method === 'POST' && url === '/api/tasks') {
        const body = JSON.parse(init?.body as string) as Partial<Task>;
        const createdTask = task(`created-${++createdTaskNumber}`, body.title ?? 'Created task', {
          description: body.description ?? null,
          type: body.type,
          dueAt: body.dueAt,
          priority: body.priority,
          leadId: body.leadId ?? null,
          lead: body.leadId ? { id: body.leadId, name: 'Acme Dental' } : null,
        });
        tasks = [...tasks, createdTask];
        return jsonResponse({ task: createdTask });
      }

      const taskId = url.slice('/api/tasks/'.length);
      if (method === 'PATCH') {
        const body = JSON.parse(init?.body as string) as Omit<Partial<Task>, 'completedAt'> & {
          completedAt?: string | null;
        };
        let updatedTask: Task | undefined;
        tasks = tasks.map((currentTask) => {
          if (currentTask.id !== taskId) return currentTask;

          const nextTask: Task = {
            ...currentTask,
            ...body,
            completedAt:
              body.completedAt === undefined ? currentTask.completedAt : body.completedAt,
          };
          updatedTask = nextTask;
          return nextTask;
        });
        return jsonResponse({ task: updatedTask });
      }

      tasks = tasks.filter((currentTask) => currentTask.id !== taskId);
      return jsonResponse({ message: 'Task deleted' });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  return {
    fetchMock,
    get mutationCount() {
      return mutationCount;
    },
    pauseNextMutation() {
      if (nextMutationGate) throw new Error('A mutation is already paused');
      nextMutationGate = createMutationGate();
      return nextMutationGate;
    },
  };
}

const lead: Lead = {
  id: 'lead-1',
  placeId: 'place-1',
  name: 'Acme Dental',
  address: '123 Main Street',
  phone: null,
  website: null,
  rating: null,
  reviewCount: null,
  industryType: 'medical',
  photoUrl: null,
  mapsUrl: null,
  leadScore: 50,
  scoreBreakdown: null,
  status: 'new',
  notes: null,
  opportunities: [],
  lastContactedAt: null,
  nextFollowUpAt: null,
  savedAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
  tags: [],
  popularTimesData: null,
  popularTimesScrapedAt: null,
};

async function waitForMutationCount(api: ReturnType<typeof createTaskApi>, expected: number) {
  await waitFor(() => expect(api.mutationCount).toBe(expected));
}

function renderSharedTaskSurfaces(
  children: React.ReactNode,
  api: ReturnType<typeof createTaskApi>
) {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('fetch', api.fetchMock);
  return render(
    <CrmTasksProvider fetcher={api.fetchMock as typeof fetch}>
      <section aria-label="Pending task widget">
        <TasksWidget onOpenSlideOver={vi.fn()} />
      </section>
      <section aria-label="Pending task dropdown">
        <TasksDropdown />
      </section>
      <section aria-label="Task overlay">{children}</section>
    </CrmTasksProvider>
  );
}

async function expectPendingCount(count: number) {
  const dropdown = screen.getByRole('region', { name: 'Pending task dropdown' });
  await waitFor(() => {
    expect(within(dropdown).getByRole('button', { name: `Tasks, ${count} pending` })).toBeTruthy();
  });
}

function openDropdown() {
  const dropdown = screen.getByRole('region', { name: 'Pending task dropdown' });
  const trigger = within(dropdown).getByRole('button', { name: /Tasks, \d+ pending/ });
  if (trigger.getAttribute('aria-expanded') === 'false') fireEvent.click(trigger);
  return dropdown;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('task overlay shared invalidation', () => {
  test('TaskSlideOver publishes create, edit, complete, reopen, and delete only after success', async () => {
    const api = createTaskApi([
      task('baseline', 'Baseline pending'),
      task('completed', 'Completed follow-up', { completedAt: '2026-07-25T12:00:00.000Z' }),
    ]);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    renderSharedTaskSurfaces(<TaskSlideOver isOpen onClose={vi.fn()} />, api);

    const widget = screen.getByRole('region', { name: 'Pending task widget' });
    const overlay = screen.getByRole('region', { name: 'Task overlay' });
    await within(widget).findByText('Baseline pending');
    await within(overlay).findByText('Completed follow-up');
    await expectPendingCount(1);

    const failedCreate = api.pauseNextMutation();
    fireEvent.click(within(overlay).getByRole('button', { name: 'Add New Task' }));
    fireEvent.change(within(overlay).getByLabelText(/^Title/), {
      target: { value: 'Rejected task' },
    });
    fireEvent.click(within(overlay).getByRole('button', { name: 'Create Task' }));
    await waitForMutationCount(api, 1);
    expect(within(widget).queryByText('Rejected task')).toBeNull();
    await expectPendingCount(1);
    failedCreate.resolve(false);
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Mutation failed'));
    expect(within(widget).queryByText('Rejected task')).toBeNull();
    await expectPendingCount(1);

    const createGate = api.pauseNextMutation();
    fireEvent.change(within(overlay).getByLabelText(/^Title/), {
      target: { value: 'Created task' },
    });
    fireEvent.click(within(overlay).getByRole('button', { name: 'Create Task' }));
    await waitForMutationCount(api, 2);
    expect(within(widget).queryByText('Created task')).toBeNull();
    createGate.resolve(true);
    await within(widget).findByText('Created task');
    await expectPendingCount(2);

    const dropdown = openDropdown();
    expect(await within(dropdown).findByText('Created task')).toBeTruthy();

    const editGate = api.pauseNextMutation();
    fireEvent.click(within(overlay).getByRole('button', { name: 'Edit Created task' }));
    fireEvent.change(within(overlay).getByLabelText(/^Title/), {
      target: { value: 'Edited task' },
    });
    fireEvent.click(within(overlay).getByRole('button', { name: 'Update Task' }));
    await waitForMutationCount(api, 3);
    expect(within(widget).getByText('Created task')).toBeTruthy();
    expect(within(widget).queryByText('Edited task')).toBeNull();
    editGate.resolve(true);
    await within(widget).findByText('Edited task');
    await waitFor(() => expect(within(widget).queryByText('Created task')).toBeNull());
    expect(await within(dropdown).findByText('Edited task')).toBeTruthy();

    const completeGate = api.pauseNextMutation();
    fireEvent.click(within(overlay).getByRole('button', { name: 'Complete Edited task' }));
    await waitForMutationCount(api, 4);
    expect(within(widget).getByText('Edited task')).toBeTruthy();
    completeGate.resolve(true);
    await waitFor(() => expect(within(widget).queryByText('Edited task')).toBeNull());
    await expectPendingCount(1);

    const reopenGate = api.pauseNextMutation();
    fireEvent.click(await within(overlay).findByRole('button', { name: 'Reopen Edited task' }));
    await waitForMutationCount(api, 5);
    expect(within(widget).queryByText('Edited task')).toBeNull();
    reopenGate.resolve(true);
    await within(widget).findByText('Edited task');
    await expectPendingCount(2);

    const deleteGate = api.pauseNextMutation();
    fireEvent.click(await within(overlay).findByRole('button', { name: 'Delete Edited task' }));
    await waitForMutationCount(api, 6);
    expect(within(widget).getByText('Edited task')).toBeTruthy();
    deleteGate.resolve(true);
    await waitFor(() => expect(within(widget).queryByText('Edited task')).toBeNull());
    await expectPendingCount(1);
    await waitFor(() => expect(within(dropdown).queryByText('Edited task')).toBeNull());
  });

  test('LeadDetailModal publishes modal saves, complete, reopen, and delete only after success', async () => {
    const api = createTaskApi([
      task('baseline-lead', 'Baseline lead task', {
        leadId: lead.id,
        lead: { id: lead.id, name: lead.name },
      }),
      task('completed-lead', 'Completed lead task', {
        leadId: lead.id,
        lead: { id: lead.id, name: lead.name },
        completedAt: '2026-07-25T12:00:00.000Z',
      }),
    ]);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    renderSharedTaskSurfaces(
      <LeadDetailModal lead={lead} isOpen onClose={vi.fn()} onUpdate={vi.fn()} />,
      api
    );

    const widget = screen.getByRole('region', { name: 'Pending task widget' });
    const overlay = screen.getByRole('region', { name: 'Task overlay' });
    await within(widget).findByText('Baseline lead task');
    fireEvent.click(await within(overlay).findByRole('button', { name: 'Tasks (1)' }));
    await within(overlay).findByText('Completed lead task');
    await expectPendingCount(1);

    const failedCreate = api.pauseNextMutation();
    fireEvent.click(within(overlay).getByRole('button', { name: 'Add Task for Acme Dental' }));
    fireEvent.change(within(overlay).getByPlaceholderText('e.g., Call about proposal'), {
      target: { value: 'Rejected lead task' },
    });
    fireEvent.click(within(overlay).getByRole('button', { name: 'Create Task' }));
    await waitForMutationCount(api, 1);
    expect(within(widget).queryByText('Rejected lead task')).toBeNull();
    failedCreate.resolve(false);
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Mutation failed'));
    expect(within(widget).queryByText('Rejected lead task')).toBeNull();
    await expectPendingCount(1);

    const createGate = api.pauseNextMutation();
    fireEvent.change(within(overlay).getByPlaceholderText('e.g., Call about proposal'), {
      target: { value: 'Created lead task' },
    });
    fireEvent.click(within(overlay).getByRole('button', { name: 'Create Task' }));
    await waitForMutationCount(api, 2);
    expect(within(widget).queryByText('Created lead task')).toBeNull();
    createGate.resolve(true);
    await within(widget).findByText('Created lead task');
    await expectPendingCount(2);

    const dropdown = openDropdown();
    expect(await within(dropdown).findByText('Created lead task')).toBeTruthy();

    const editGate = api.pauseNextMutation();
    fireEvent.click(within(overlay).getByRole('button', { name: 'Edit Created lead task' }));
    fireEvent.change(within(overlay).getByPlaceholderText('e.g., Call about proposal'), {
      target: { value: 'Edited lead task' },
    });
    fireEvent.click(within(overlay).getByRole('button', { name: 'Update Task' }));
    await waitForMutationCount(api, 3);
    expect(within(widget).getByText('Created lead task')).toBeTruthy();
    editGate.resolve(true);
    await within(widget).findByText('Edited lead task');
    await waitFor(() => expect(within(widget).queryByText('Created lead task')).toBeNull());
    expect(await within(dropdown).findByText('Edited lead task')).toBeTruthy();

    const completeGate = api.pauseNextMutation();
    fireEvent.click(within(overlay).getByRole('button', { name: 'Complete Edited lead task' }));
    await waitForMutationCount(api, 4);
    expect(within(widget).getByText('Edited lead task')).toBeTruthy();
    completeGate.resolve(true);
    await waitFor(() => expect(within(widget).queryByText('Edited lead task')).toBeNull());
    await expectPendingCount(1);

    const reopenGate = api.pauseNextMutation();
    fireEvent.click(
      await within(overlay).findByRole('button', { name: 'Reopen Edited lead task' })
    );
    await waitForMutationCount(api, 5);
    expect(within(widget).queryByText('Edited lead task')).toBeNull();
    reopenGate.resolve(true);
    await within(widget).findByText('Edited lead task');
    await expectPendingCount(2);

    const deleteGate = api.pauseNextMutation();
    fireEvent.click(
      await within(overlay).findByRole('button', { name: 'Delete Edited lead task' })
    );
    await waitForMutationCount(api, 6);
    expect(within(widget).getByText('Edited lead task')).toBeTruthy();
    deleteGate.resolve(true);
    await waitFor(() => expect(within(widget).queryByText('Edited lead task')).toBeNull());
    await expectPendingCount(1);
    await waitFor(() => expect(within(dropdown).queryByText('Edited lead task')).toBeNull());
  }, 15_000);
});
