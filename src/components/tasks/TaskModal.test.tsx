import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Task } from '@/types';
import { TaskModal } from './TaskModal';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const task: Task = {
  id: 'task-1',
  title: 'Follow up',
  type: 'call',
  dueAt: '2026-07-25T09:00:00.000Z',
  priority: 'medium',
  leadId: 'lead-1',
  lead: { id: 'lead-1', name: 'Current Lead' },
  createdAt: '2026-07-24T09:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TaskModal lead assignment', () => {
  test('sends null when an existing task is changed to a standalone task', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ leads: [{ id: 'lead-1', name: 'Current Lead' }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ task: { ...task, leadId: null } }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskModal isOpen task={task} onClose={vi.fn()} onSave={vi.fn()} />);

    const leadSelect = await screen.findByDisplayValue('Current Lead');
    fireEvent.change(leadSelect, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Task' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1]?.[1];
    expect(request).toEqual(expect.objectContaining({ method: 'PATCH' }));
    expect(JSON.parse(request?.body as string)).toEqual(expect.objectContaining({ leadId: null }));
  });
});
