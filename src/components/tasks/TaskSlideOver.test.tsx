import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Task } from '@/types';
import { TaskSlideOver } from './TaskSlideOver';

const { invalidateCrmTasks, toastError, toastSuccess } = vi.hoisted(() => ({
  invalidateCrmTasks: vi.fn(async () => undefined),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('@/lib/hooks/useCrmTasks', () => ({
  useCrmTasks: () => ({ invalidate: invalidateCrmTasks }),
}));
vi.mock('./TaskList', async () => {
  const { TaskItem } = await import('./TaskItem');

  return {
    TaskList: ({
      tasks,
      onComplete,
      onEdit,
      onDelete,
    }: {
      tasks: Task[];
      onComplete: (taskId: string, completed: boolean) => Promise<void>;
      onEdit: (task: Task) => void;
      onDelete: (taskId: string) => void;
    }) => {
      const loadedTask = tasks[0];
      return loadedTask ? (
        <>
          <TaskItem task={loadedTask} onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} />
          <button onClick={() => onEdit(loadedTask)}>Edit loaded task</button>
        </>
      ) : null;
    },
  };
});

const task: Task = {
  id: 'task-1',
  title: 'Follow up',
  description: 'Original notes',
  type: 'call',
  dueAt: '2026-07-25T09:00:00.000Z',
  priority: 'medium',
  completedAt: null,
  leadId: 'lead-1',
  lead: { id: 'lead-1', name: 'Current Lead' },
  createdAt: '2026-07-24T09:00:00.000Z',
};

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function createEditorFetch(initialTasks: Task[] = []) {
  let tasks = initialTasks;

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url.startsWith('/api/leads')) {
      return {
        ok: true,
        json: async () => ({
          leads: [
            { id: 'lead-1', name: 'Current Lead' },
            { id: 'lead-2', name: 'Next Lead' },
          ],
        }),
      } as Response;
    }
    if (method === 'GET' && url.startsWith('/api/tasks?')) {
      return { ok: true, json: async () => ({ tasks }) } as Response;
    }
    if (method === 'POST') {
      const body = JSON.parse(init?.body as string) as Partial<Task>;
      const createdTask = { ...task, ...body, id: 'created-task', leadId: body.leadId ?? null };
      tasks = [...tasks, createdTask];
      return { ok: true, json: async () => ({ task: createdTask }) } as Response;
    }
    if (method === 'PATCH') {
      const body = JSON.parse(init?.body as string) as Partial<Task>;
      const updatedTask = { ...task, ...body, leadId: body.leadId ?? null };
      tasks = tasks.map((currentTask) => (currentTask.id === task.id ? updatedTask : currentTask));
      return { ok: true, json: async () => ({ task: updatedTask }) } as Response;
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

function SlideOverHarness() {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open tasks
      </button>
      <TaskSlideOver isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TaskSlideOver task editing', () => {
  test('uses tomorrow at 09:00 defaults and loads leads only when the editor opens', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 25, 12, 0, 0));
    const fetchMock = createEditorFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskSlideOver isOpen onClose={vi.fn()} />);
    await vi.runAllTimersAsync();
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).startsWith('/api/leads'))).toBe(
      false
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add New Task' }));
    expect((screen.getByLabelText(/^Due Date/) as HTMLInputElement).value).toBe('2026-07-26T09:00');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('other');
    expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('medium');

    await vi.runAllTimersAsync();
    expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).startsWith('/api/leads'))).toBe(
      true
    );
  });

  test('creates a task with the same canonical payload as TaskModal', async () => {
    const fetchMock = createEditorFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskSlideOver isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add New Task' }));

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: '  New follow up  ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  Notes  ' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'email' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText(/^Due Date/), {
      target: { value: '2026-07-27T14:30' },
    });
    await screen.findByRole('option', { name: 'Next Lead' });
    fireEvent.change(screen.getByLabelText('Link to Lead'), { target: { value: 'lead-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true);
    });
    const mutation = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(mutation?.[0]).toBe('/api/tasks');
    expect(JSON.parse(mutation?.[1]?.body as string)).toEqual({
      title: 'New follow up',
      description: 'Notes',
      type: 'email',
      dueAt: new Date('2026-07-27T14:30').toISOString(),
      priority: 'high',
      leadId: 'lead-2',
    });
  });

  test('edits a task and sends null when its lead is unassigned', async () => {
    const fetchMock = createEditorFetch([task]);
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskSlideOver isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit loaded task' }));
    const leadSelect = await screen.findByDisplayValue('Current Lead');
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Updated follow up' } });
    fireEvent.change(leadSelect, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Task' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const mutation = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(mutation?.[0]).toBe('/api/tasks/task-1');
    expect(JSON.parse(mutation?.[1]?.body as string)).toEqual(
      expect.objectContaining({ title: 'Updated follow up', leadId: null })
    );
  });

  test('sends null when an existing description is cleared', async () => {
    const fetchMock = createEditorFetch([task]);
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskSlideOver isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit loaded task' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Task' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
      expect(invalidateCrmTasks).toHaveBeenCalledTimes(1);
    });
    const mutation = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(JSON.parse(mutation?.[1]?.body as string)).toEqual(
      expect.objectContaining({ description: null })
    );
  });

  test('resets the draft when the editor is cancelled', () => {
    vi.stubGlobal('fetch', createEditorFetch());
    render(<TaskSlideOver isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add New Task' }));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Discard me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add New Task' }));

    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('');
  });

  test.each([
    ['backdrop', () => fireEvent.click(screen.getByTestId('task-slide-over-backdrop'))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['header close', () => fireEvent.click(screen.getByRole('button', { name: 'Close tasks' }))],
  ])('resets the editor after %s close and reopen', (_closePath, closePanel) => {
    vi.stubGlobal('fetch', createEditorFetch());
    render(<SlideOverHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Add New Task' }));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Discard me' } });
    closePanel();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open tasks' }));
    expect(screen.getByRole('button', { name: 'Add New Task' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add New Task' }));
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('');
  });

  test.each([
    [
      'non-OK response',
      async () => ({ ok: false, json: async () => ({ error: 'Request failed' }) }) as Response,
    ],
    [
      'rejected fetch',
      async () => {
        throw new Error('Network unavailable');
      },
    ],
  ] as const)('rolls completion back after a %s and allows retrying', async (_case, failOnce) => {
    let patchAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);

      if (init?.method === 'PATCH') {
        patchAttempts += 1;
        if (patchAttempts === 1) return failOnce();
        return { ok: true, json: async () => ({ task: { ...task, completedAt: new Date() } }) };
      }
      if (url.startsWith('/api/leads')) {
        return { ok: true, json: async () => ({ leads: [] }) };
      }
      return { ok: true, json: async () => ({ tasks: [task] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskSlideOver isOpen onClose={vi.fn()} />);

    const completeButton = await screen.findByRole('button', { name: 'Complete Follow up' });
    fireEvent.click(completeButton);

    expect(completeButton.getAttribute('aria-pressed')).toBe('true');
    expect(completeButton.hasAttribute('disabled')).toBe(true);

    await waitFor(() => {
      expect(completeButton.getAttribute('aria-pressed')).toBe('false');
      expect(completeButton.hasAttribute('disabled')).toBe(false);
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Failed to complete task');
    expect(invalidateCrmTasks).not.toHaveBeenCalled();

    fireEvent.click(completeButton);

    await waitFor(() => {
      expect(patchAttempts).toBe(2);
      expect(completeButton.getAttribute('aria-pressed')).toBe('true');
      expect(completeButton.hasAttribute('disabled')).toBe(false);
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Task completed');
    expect(invalidateCrmTasks).toHaveBeenCalledTimes(1);
  });

  test('ignores an older all-task response after a successful mutation refresh', async () => {
    let resolveInitialTasks!: (response: Response) => void;
    const initialTasksResponse = new Promise<Response>((resolve) => {
      resolveInitialTasks = resolve;
    });
    let allTaskRequests = 0;
    const newerTask = { ...task, id: 'task-newer', title: 'Newer task' };
    const olderTask = { ...task, id: 'task-older', title: 'Older task' };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/leads')) {
        return { ok: true, json: async () => ({ leads: [] }) } as Response;
      }
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ task: newerTask }) } as Response;
      }
      if (url === '/api/tasks?status=all') {
        allTaskRequests += 1;
        if (allTaskRequests === 1) return initialTasksResponse;
        return { ok: true, json: async () => ({ tasks: [newerTask] }) } as Response;
      }
      throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskSlideOver isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add New Task' }));
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: newerTask.title },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    expect(await screen.findByText(newerTask.title)).toBeTruthy();
    await act(async () => {
      resolveInitialTasks({
        ok: true,
        json: async () => ({ tasks: [olderTask] }),
      } as Response);
    });

    await waitFor(() => {
      expect(screen.getByText(newerTask.title)).toBeTruthy();
      expect(screen.queryByText(olderTask.title)).toBeNull();
    });
  });
});
