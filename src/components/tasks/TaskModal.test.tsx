import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Task } from '@/types';
import { TaskModal } from './TaskModal';

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

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

function createEditorFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith('/api/leads')) {
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

    const body = JSON.parse(init?.body as string) as Partial<Task>;
    return {
      ok: true,
      json: async () => ({ task: { ...task, ...body, leadId: body.leadId ?? null } }),
    } as Response;
  });
}

function ModalHarness() {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open task modal
      </button>
      <TaskModal isOpen={isOpen} onClose={() => setIsOpen(false)} onSave={vi.fn()} />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TaskModal editor', () => {
  test('creates a task with the canonical payload and tomorrow-at-09:00 defaults', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 25, 12, 0, 0));
    const fetchMock = createEditorFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskModal isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    expect((screen.getByLabelText(/^Due Date/) as HTMLInputElement).value).toBe('2026-07-26T09:00');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('other');
    expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('medium');

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: '  New follow up  ' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  Notes  ' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'email' } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText(/^Due Date/), {
      target: { value: '2026-07-27T14:30' },
    });

    await vi.runAllTimersAsync();
    fireEvent.change(screen.getByLabelText('Link to Lead'), { target: { value: 'lead-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await vi.runAllTimersAsync();

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
    const fetchMock = createEditorFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskModal isOpen task={task} onClose={vi.fn()} onSave={vi.fn()} />);

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
    const fetchMock = createEditorFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskModal isOpen task={task} onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Task' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const mutation = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(JSON.parse(mutation?.[1]?.body as string)).toEqual(
      expect.objectContaining({ description: null })
    );
  });

  test('handles Escape without closing a parent dialog', () => {
    vi.stubGlobal('fetch', createEditorFetch());
    const closeTaskEditor = vi.fn();
    const closeParentDialog = vi.fn();
    document.addEventListener('keydown', closeParentDialog);
    render(<TaskModal isOpen onClose={closeTaskEditor} onSave={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    document.removeEventListener('keydown', closeParentDialog);

    expect(closeTaskEditor).toHaveBeenCalledOnce();
    expect(closeParentDialog).not.toHaveBeenCalled();
  });

  test.each([
    ['backdrop', () => fireEvent.click(screen.getByTestId('task-modal-backdrop'))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    [
      'header close',
      () => fireEvent.click(screen.getByRole('button', { name: 'Close task editor' })),
    ],
  ])('resets the draft after %s close and reopen', async (_closePath, closeEditor) => {
    vi.stubGlobal('fetch', createEditorFetch());
    render(<ModalHarness />);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Discard me' } });
    closeEditor();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open task modal' }));
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('');
  });
});
