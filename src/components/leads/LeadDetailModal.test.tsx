import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ContactLogEntry, Lead, LeadStatus, Task } from '@/types';
import { LeadDetailModal } from './LeadDetailModal';

const { invalidateCrmTasks, toastError, toastSuccess } = vi.hoisted(() => ({
  invalidateCrmTasks: vi.fn(async () => undefined),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('@/lib/hooks/useCrmTasks', () => ({
  useCrmTasks: () => ({ invalidate: invalidateCrmTasks }),
}));
vi.mock('@/components/crm', () => ({ StatusBadge: () => null }));
vi.mock('@/components/tasks', async () => {
  const { TaskItem } = await import('@/components/tasks/TaskItem');

  return {
    TaskList: ({
      tasks,
      isLoading,
      onComplete,
      onEdit,
      onDelete,
      showCompleted,
    }: {
      tasks: Task[];
      isLoading?: boolean;
      onComplete: (taskId: string, completed: boolean) => Promise<void>;
      onEdit: (task: Task) => void;
      onDelete: (taskId: string) => void;
      showCompleted?: boolean;
    }) => (
      <section aria-label="Task list">
        <p>Task loading: {isLoading ? 'yes' : 'no'}</p>
        <p>Show completed: {showCompleted ? 'yes' : 'no'}</p>
        {tasks.map((task) => (
          <div key={task.id}>
            <TaskItem task={task} onComplete={onComplete} onEdit={onEdit} onDelete={onDelete} />
          </div>
        ))}
      </section>
    ),
    TaskModal: ({
      isOpen,
      onClose,
      onSave,
      task,
      leadId,
      leadName,
    }: {
      isOpen: boolean;
      onClose: () => void;
      onSave: (task: Task) => void | Promise<void>;
      task?: Task | null;
      leadId?: string;
      leadName?: string;
    }) =>
      isOpen ? (
        <div role="dialog" aria-label={task ? `Task modal: ${task.title}` : 'Task modal: new task'}>
          <p>
            Assigned lead: {leadName} ({leadId})
          </p>
          <button
            onClick={() => {
              onSave(task ?? ({} as Task));
              onClose();
            }}
          >
            Save task
          </button>
          <button onClick={onClose}>Close task modal</button>
        </div>
      ) : null,
  };
});
vi.mock('./LeadScoreBadge', () => ({ LeadScoreBadge: () => null }));
vi.mock('./OpportunitiesList', () => ({ OpportunitiesList: () => null }));
vi.mock('./StatusSelector', () => ({
  StatusSelector: ({
    value,
    onChange,
  }: {
    value: LeadStatus;
    onChange: (status: LeadStatus) => void;
  }) => (
    <label>
      Lead status
      <select value={value} onChange={(event) => onChange(event.target.value as LeadStatus)}>
        <option value="new">New</option>
        <option value="won">Won</option>
      </select>
    </label>
  ),
}));

const baseLead: Lead = {
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
  notes: 'Existing notes',
  opportunities: [],
  lastContactedAt: null,
  nextFollowUpAt: null,
  savedAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
  tags: [],
  popularTimesData: null,
  popularTimesScrapedAt: null,
};

const contactLog: ContactLogEntry = {
  id: 'contact-1',
  type: 'call',
  summary: 'Discussed the proposal',
  outcome: 'positive',
  createdAt: '2026-07-20T10:00:00.000Z',
};

const pendingTask: Task = {
  id: 'task-pending',
  title: 'Call Acme',
  description: null,
  type: 'call',
  dueAt: '2026-08-01T09:00:00.000Z',
  priority: 'high',
  completedAt: null,
  leadId: null,
  lead: null,
  createdAt: '2026-07-20T09:00:00.000Z',
};

const completedTask: Task = {
  id: 'task-completed',
  title: 'Send proposal',
  description: null,
  type: 'email',
  dueAt: '2026-07-21T09:00:00.000Z',
  priority: 'medium',
  completedAt: '2026-07-21T10:00:00.000Z',
  leadId: null,
  lead: null,
  createdAt: '2026-07-20T09:00:00.000Z',
};

function mockResponse(data: unknown = {}, ok = true): Response {
  return { ok, json: async () => data } as Response;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

interface StubApiOptions {
  contactLogs?: ContactLogEntry[];
  tasks?: Task[];
  mutation?: (url: string, init: RequestInit) => Response | Promise<Response>;
}

function stubApi({ contactLogs = [], tasks = [], mutation }: StubApiOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (method === 'GET' && url === '/api/leads/lead-1/contact') {
      return mockResponse({ contactLogs });
    }
    if (method === 'GET' && url === '/api/tasks?leadId=lead-1&status=all') {
      return mockResponse({ tasks });
    }
    if (mutation) return mutation(url, init ?? {});

    return mockResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderModal({
  lead = baseLead,
  isOpen = true,
  onClose = vi.fn<() => void>(),
  onUpdate = vi.fn<(updatedLead: Lead) => void>(),
}: {
  lead?: Lead;
  isOpen?: boolean;
  onClose?: () => void;
  onUpdate?: (updatedLead: Lead) => void;
} = {}) {
  const view = render(
    <LeadDetailModal lead={lead} isOpen={isOpen} onClose={onClose} onUpdate={onUpdate} />
  );
  return { ...view, lead, onClose, onUpdate };
}

function renderFollowUpDate(
  nextFollowUpAt: string | null,
  onUpdate = vi.fn<(updatedLead: Lead) => void>()
) {
  const lead = { ...baseLead, nextFollowUpAt };
  const { container, getByRole } = render(
    <LeadDetailModal lead={lead} isOpen onClose={vi.fn()} onUpdate={onUpdate} />
  );
  const input = container.querySelector<HTMLInputElement>('input[type="date"]');
  if (!input) throw new Error('Follow-up date input was not rendered');

  return { container, getByRole, input, onUpdate };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('LeadDetailModal characterization', () => {
  test('loads contacts and tasks eagerly, labels tabs exactly, and switches every view', async () => {
    const fetchMock = stubApi({
      contactLogs: [contactLog],
      tasks: [pendingTask, completedTask],
    });
    renderModal();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Contacts (1)' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Tasks (1)' })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/contact');
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks?leadId=lead-1&status=all');

    expect((screen.getByRole('combobox', { name: 'Lead status' }) as HTMLSelectElement).value).toBe(
      'new'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Contacts (1)' }));
    expect(screen.getByText('Discussed the proposal')).toBeTruthy();
    expect(screen.getByText('positive')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tasks (1)' }));
    expect(screen.getByRole('region', { name: 'Task list' })).toBeTruthy();
    expect(screen.getByText('Task loading: no')).toBeTruthy();
    expect(screen.getByText('Show completed: yes')).toBeTruthy();
    expect(screen.getByText('Call Acme')).toBeTruthy();
    expect(screen.getByText('Send proposal')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(
      (screen.getByPlaceholderText('Add notes about this lead...') as HTMLTextAreaElement).value
    ).toBe('Existing notes');

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Follow-up Date')).toBeTruthy();
  });

  test('shows activity loading, empty, closed-form, and open-form states', async () => {
    let resolveContacts!: (response: Response) => void;
    const contactsResponse = new Promise<Response>((resolve) => {
      resolveContacts = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/leads/lead-1/contact') return contactsResponse;
      return mockResponse({ tasks: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: 'Contacts (0)' }));
    expect(screen.getByRole('button', { name: 'Add Contact Log' })).toBeTruthy();
    expect(screen.queryByText('No contact history yet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add Contact Log' }));
    expect(screen.getByText('New Contact Log')).toBeTruthy();
    expect(screen.getByDisplayValue('Phone Call')).toBeTruthy();
    expect(screen.getByDisplayValue('Neutral')).toBeTruthy();
    expect((screen.getByPlaceholderText('What happened?') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Add Log' }) as HTMLButtonElement).disabled).toBe(
      true
    );

    await act(async () => resolveContacts(mockResponse({ contactLogs: [] })));

    expect(await screen.findByText('No contact history yet')).toBeTruthy();
    expect(screen.getByText('New Contact Log')).toBeTruthy();
  });

  test('preserves the activity draft across tabs and the active activity view across close/reopen', async () => {
    stubApi();
    const { rerender, onClose, onUpdate } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Contacts (0)' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Contacts (0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact Log' }));
    fireEvent.change(screen.getByDisplayValue('Phone Call'), { target: { value: 'email' } });
    fireEvent.change(screen.getByDisplayValue('Neutral'), { target: { value: 'positive' } });
    fireEvent.change(screen.getByPlaceholderText('What happened?'), {
      target: { value: 'Draft survives navigation' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contacts (0)' }));
    expect(screen.getByDisplayValue('Email')).toBeTruthy();
    expect(screen.getByDisplayValue('Positive')).toBeTruthy();
    expect((screen.getByPlaceholderText('What happened?') as HTMLTextAreaElement).value).toBe(
      'Draft survives navigation'
    );

    rerender(
      <LeadDetailModal lead={baseLead} isOpen={false} onClose={onClose} onUpdate={onUpdate} />
    );
    expect(screen.queryByText('Acme Dental')).toBeNull();
    rerender(<LeadDetailModal lead={baseLead} isOpen onClose={onClose} onUpdate={onUpdate} />);

    expect(screen.getByText('New Contact Log')).toBeTruthy();
    expect((screen.getByPlaceholderText('What happened?') as HTMLTextAreaElement).value).toBe(
      'Draft survives navigation'
    );
    expect(screen.getByDisplayValue('Email')).toBeTruthy();
    expect(screen.getByDisplayValue('Positive')).toBeTruthy();
  });

  test('wires StatusSelector and saves exact status and notes payloads with current onUpdate values', async () => {
    const fetchMock = stubApi();
    const onUpdate = vi.fn();
    renderModal({ onUpdate });

    fireEvent.change(screen.getByRole('combobox', { name: 'Lead status' }), {
      target: { value: 'won' },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'won' }),
      });
    });
    expect(onUpdate).toHaveBeenCalledWith({ ...baseLead, status: 'won' });

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    const notesInput = screen.getByPlaceholderText('Add notes about this lead...');
    const saveNotesButton = screen.getByRole('button', { name: 'Save Notes' });
    expect((saveNotesButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(notesInput, { target: { value: 'Updated notes' } });
    expect((saveNotesButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveNotesButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Updated notes' }),
      });
    });
    expect(onUpdate).toHaveBeenCalledWith({ ...baseLead, notes: 'Updated notes' });
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  test('posts the exact contact-log body and reports the client-generated contact time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-25T12:34:56.000Z'));
    const createdLog: ContactLogEntry = {
      ...contactLog,
      id: 'contact-created',
      type: 'email',
      summary: 'Reached the decision maker',
    };
    const fetchMock = stubApi({
      mutation: (url, init) => {
        if (url === '/api/leads/lead-1/contact' && init.method === 'POST') {
          return mockResponse({ contactLog: createdLog });
        }
        return mockResponse();
      },
    });
    const onUpdate = vi.fn();
    renderModal({ onUpdate });

    fireEvent.click(screen.getByRole('button', { name: 'Contacts (0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact Log' }));
    fireEvent.change(screen.getByDisplayValue('Phone Call'), { target: { value: 'email' } });
    fireEvent.change(screen.getByDisplayValue('Neutral'), { target: { value: 'positive' } });
    fireEvent.change(screen.getByPlaceholderText('What happened?'), {
      target: { value: 'Reached the decision maker' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Log' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'email',
          summary: 'Reached the decision maker',
          outcome: 'positive',
        }),
      });
    });
    expect(onUpdate).toHaveBeenCalledWith({
      ...baseLead,
      lastContactedAt: '2026-07-25T12:34:56.000Z',
    });
    expect(screen.getByText('Reached the decision maker')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Contact Log' })).toBeTruthy();
  });

  test('sends exact complete and reopen bodies and refreshes tasks after both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-25T12:34:56.000Z'));
    const fetchMock = stubApi({ tasks: [pendingTask, completedTask] });
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks (1)' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Tasks (1)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Complete Call Acme' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-pending', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedAt: '2026-07-25T12:34:56.000Z' }),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reopen Send proposal' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-completed', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completedAt: null }),
      });
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            input === '/api/tasks?leadId=lead-1&status=all' && (init?.method ?? 'GET') === 'GET'
        )
      ).toHaveLength(3);
      expect(invalidateCrmTasks).toHaveBeenCalledTimes(2);
    });
  });

  test.each([
    ['non-OK response', () => mockResponse({}, false)],
    ['rejected fetch', () => Promise.reject(new Error('Network unavailable'))],
  ] as const)('rolls completion back after a %s and allows retrying', async (_case, failOnce) => {
    let completionAttempts = 0;
    const fetchMock = stubApi({
      tasks: [pendingTask],
      mutation: (url, init) => {
        if (url === '/api/tasks/task-pending' && init.method === 'PATCH') {
          completionAttempts += 1;
          if (completionAttempts === 1) return failOnce();
        }
        return mockResponse();
      },
    });
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks (1)' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Tasks (1)' }));

    const completeButton = screen.getByRole('button', { name: 'Complete Call Acme' });
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
      expect(completionAttempts).toBe(2);
      expect(completeButton.getAttribute('aria-pressed')).toBe('true');
      expect(completeButton.hasAttribute('disabled')).toBe(false);
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Task completed');
    expect(invalidateCrmTasks).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          input === '/api/tasks?leadId=lead-1&status=all' && (init?.method ?? 'GET') === 'GET'
      )
    ).toHaveLength(2);
  });

  test('cancels or confirms deletion and refreshes only after a successful confirmed delete', async () => {
    const fetchMock = stubApi({ tasks: [pendingTask] });
    const confirmMock = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirmMock);
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks (1)' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Tasks (1)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete Call Acme' }));
    expect(confirmMock).toHaveBeenCalledWith('Delete this task?');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Call Acme' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-pending', { method: 'DELETE' });
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            input === '/api/tasks?leadId=lead-1&status=all' && (init?.method ?? 'GET') === 'GET'
        )
      ).toHaveLength(2);
      expect(invalidateCrmTasks).toHaveBeenCalledTimes(1);
    });
    const deleteRequest = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')?.[1];
    expect(deleteRequest?.body).toBeUndefined();
  });

  test('wires TaskList and TaskModal for edit, add, close, save, and refresh', async () => {
    const fetchMock = stubApi({ tasks: [pendingTask, completedTask] });
    renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks (1)' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Tasks (1)' }));

    expect(screen.getByRole('region', { name: 'Task list' })).toBeTruthy();
    expect(screen.getByText('Show completed: yes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Call Acme' }));
    expect(screen.getByRole('dialog', { name: 'Task modal: Call Acme' })).toBeTruthy();
    expect(screen.getByText('Assigned lead: Acme Dental (lead-1)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close task modal' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add Task for Acme Dental' }));
    expect(screen.getByRole('dialog', { name: 'Task modal: new task' })).toBeTruthy();
    expect(screen.getByText('Assigned lead: Acme Dental (lead-1)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([input, init]) =>
            input === '/api/tasks?leadId=lead-1&status=all' && (init?.method ?? 'GET') === 'GET'
        )
      ).toHaveLength(2);
      expect(invalidateCrmTasks).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('reports a non-OK completion without applying updates or refreshing tasks', async () => {
    const fetchMock = stubApi({
      tasks: [pendingTask],
      mutation: () => mockResponse({}, false),
    });
    const onUpdate = vi.fn();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    const { container } = renderModal({ onUpdate });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks (1)' })).toBeTruthy());

    fireEvent.change(screen.getByRole('combobox', { name: 'Lead status' }), {
      target: { value: 'won' },
    });
    const followUpInput = container.querySelector<HTMLInputElement>('input[type="date"]');
    if (!followUpInput) throw new Error('Follow-up date input was not rendered');
    fireEvent.change(followUpInput, { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.change(screen.getByPlaceholderText('Add notes about this lead...'), {
      target: { value: 'Unsaved notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }));

    fireEvent.click(screen.getByRole('button', { name: 'Contacts (0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact Log' }));
    fireEvent.change(screen.getByPlaceholderText('What happened?'), {
      target: { value: 'Unsaved contact' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Log' }));

    fireEvent.click(screen.getByRole('button', { name: 'Tasks (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete Call Acme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Call Acme' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
      ).toHaveLength(6);
    });
    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError).toHaveBeenCalledWith('Failed to complete task');
    expect(toastError).toHaveBeenCalledWith('Failed to delete task');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          input === '/api/tasks?leadId=lead-1&status=all' && (init?.method ?? 'GET') === 'GET'
      )
    ).toHaveLength(1);
    expect(invalidateCrmTasks).not.toHaveBeenCalled();
  });

  test('reports rejected mutations with the current operation-specific errors', async () => {
    const fetchMock = stubApi({
      tasks: [pendingTask],
      mutation: async () => {
        throw new Error('Network unavailable');
      },
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );
    const { container } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tasks (1)' })).toBeTruthy());

    fireEvent.change(screen.getByRole('combobox', { name: 'Lead status' }), {
      target: { value: 'won' },
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to update status'));

    const followUpInput = container.querySelector<HTMLInputElement>('input[type="date"]');
    if (!followUpInput) throw new Error('Follow-up date input was not rendered');
    fireEvent.change(followUpInput, { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to save follow-up'));

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.change(screen.getByPlaceholderText('Add notes about this lead...'), {
      target: { value: 'Rejected notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to save notes'));

    fireEvent.click(screen.getByRole('button', { name: 'Contacts (0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact Log' }));
    fireEvent.change(screen.getByPlaceholderText('What happened?'), {
      target: { value: 'Rejected contact' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Log' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to add contact log'));

    fireEvent.click(screen.getByRole('button', { name: 'Tasks (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete Call Acme' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to complete task'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Call Acme' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to delete task'));

    expect(toastError.mock.calls.map(([message]) => message)).toEqual([
      'Failed to update status',
      'Failed to save follow-up',
      'Failed to save notes',
      'Failed to add contact log',
      'Failed to complete task',
      'Failed to delete task',
    ]);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
    ).toHaveLength(6);
    expect(invalidateCrmTasks).not.toHaveBeenCalled();
  });

  test('ignores an older lead-task response after a modal save refresh', async () => {
    let resolveInitialTasks!: (response: Response) => void;
    const initialTasksResponse = new Promise<Response>((resolve) => {
      resolveInitialTasks = resolve;
    });
    let taskRequests = 0;
    const newerTask = { ...pendingTask, id: 'task-newer', title: 'Newer lead task' };
    const olderTask = { ...pendingTask, id: 'task-older', title: 'Older lead task' };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url === '/api/leads/lead-1/contact') {
        return mockResponse({ contactLogs: [] });
      }
      if (url === '/api/tasks?leadId=lead-1&status=all') {
        taskRequests += 1;
        if (taskRequests === 1) return initialTasksResponse;
        return mockResponse({ tasks: [newerTask] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Tasks (0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Task for Acme Dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));

    expect(await screen.findByText(newerTask.title)).toBeTruthy();
    await act(async () => {
      resolveInitialTasks(mockResponse({ tasks: [olderTask] }));
    });

    await waitFor(() => {
      expect(screen.getByText(newerTask.title)).toBeTruthy();
      expect(screen.queryByText(olderTask.title)).toBeNull();
    });
  });
});

describe('LeadDetailModal follow-up date safety', () => {
  test('renders a null follow-up date as empty', () => {
    const { container, input } = renderFollowUpDate(null);

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('Currently set:');
  });

  test('renders an empty follow-up date as empty', () => {
    const { container, input } = renderFollowUpDate('');

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('Currently set:');
  });

  test('preserves a valid date-only follow-up value and display', () => {
    const { container, input } = renderFollowUpDate('2026-07-19');
    const expectedDisplay = new Date(2026, 6, 19).toLocaleDateString();

    expect(input.value).toBe('2026-07-19');
    expect(container.textContent).toContain(`Currently set: ${expectedDisplay}`);
  });

  test('preserves a valid ISO timestamp date and display', () => {
    const timestamp = '2026-07-19T15:30:00.000Z';
    const { container, input } = renderFollowUpDate(timestamp);

    expect(input.value).toBe('2026-07-19');
    expect(container.textContent).toContain(
      `Currently set: ${new Date(timestamp).toLocaleDateString()}`
    );
  });

  test('ignores a malformed follow-up date without crashing', () => {
    const { container, input } = renderFollowUpDate('not-a-date');

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('Currently set:');
    expect(container.textContent).not.toContain('Invalid Date');
  });

  test('saves a date-only follow-up as the agreed ISO timestamp', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve({ ok: init?.method === 'PATCH' } as Response)
    );
    const { getByRole, input, onUpdate } = renderFollowUpDate(null);

    fireEvent.change(input, { target: { value: '2026-07-19' } });
    fireEvent.click(getByRole('button', { name: 'Set' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leads/lead-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ nextFollowUpAt: '2026-07-19T12:00:00.000Z' }),
        })
      );
    });
    expect(onUpdate).toHaveBeenCalledWith({
      ...baseLead,
      nextFollowUpAt: '2026-07-19T12:00:00.000Z',
    });
  });

  test('clears a follow-up with null', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve({ ok: init?.method === 'PATCH' } as Response)
    );
    const { getByRole, input, onUpdate } = renderFollowUpDate('2026-07-19T12:00:00.000Z');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(getByRole('button', { name: 'Set' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leads/lead-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ nextFollowUpAt: null }),
        })
      );
    });
    expect(onUpdate).toHaveBeenCalledWith({ ...baseLead, nextFollowUpAt: null });
  });
});
