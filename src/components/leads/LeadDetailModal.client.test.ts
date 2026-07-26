import { afterEach, describe, expect, test, vi } from 'vitest';

import type { ContactLogEntry, Lead, Task } from '@/types';
import {
  createLeadContactLog,
  deleteLeadTask,
  fetchAllLeadTasks,
  fetchLeadContactLogs,
  patchLeadEditableFields,
  setLeadTaskCompletion,
} from './LeadDetailModal.client';

const contactLog: ContactLogEntry = {
  id: 'contact-1',
  type: 'email',
  summary: 'Sent the proposal',
  outcome: 'positive',
  createdAt: '2026-07-25T10:00:00.000Z',
};

const task: Task = {
  id: 'task-1',
  title: 'Call Acme',
  description: null,
  type: 'call',
  dueAt: '2026-07-26T10:00:00.000Z',
  priority: 'high',
  completedAt: null,
  leadId: null,
  lead: null,
  createdAt: '2026-07-25T10:00:00.000Z',
};

const lead: Lead = {
  id: 'lead-1',
  placeId: 'place-1',
  name: 'Acme Dental',
  address: null,
  phone: null,
  website: null,
  rating: null,
  reviewCount: null,
  industryType: 'medical',
  photoUrl: null,
  mapsUrl: null,
  leadScore: 50,
  scoreBreakdown: null,
  status: 'contacted',
  notes: 'Call next week',
  opportunities: [],
  lastContactedAt: '2026-07-25T12:00:00.000Z',
  nextFollowUpAt: '2026-08-01T12:00:00.000Z',
  savedAt: '2026-07-25T10:00:00.000Z',
  updatedAt: '2026-07-25T12:00:00.000Z',
  tags: [],
  popularTimesData: null,
  popularTimesScrapedAt: null,
};

function response(data: unknown, ok = true): Response {
  return { ok, json: vi.fn().mockResolvedValue(data) } as unknown as Response;
}

function stubResponse(data: unknown, ok = true) {
  const jsonMock = vi.fn().mockResolvedValue(data);
  const value = { ok, json: jsonMock } as unknown as Response;
  const fetchMock = vi.fn().mockResolvedValue(value);
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, jsonMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LeadDetailModal client request contracts', () => {
  test('fetches and decodes lead contact logs', async () => {
    const { fetchMock } = stubResponse({ contactLogs: [contactLog] });

    await expect(fetchLeadContactLogs('lead-1')).resolves.toEqual({
      successful: true,
      data: [contactLog],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/contact');
  });

  test('fetches all lead tasks and decodes the tasks envelope', async () => {
    const { fetchMock } = stubResponse({ tasks: [task], stats: { total: 1 } });

    await expect(fetchAllLeadTasks('lead-1')).resolves.toEqual({
      successful: true,
      data: [task],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks?leadId=lead-1&status=all');
  });

  test('defaults missing contact-log and task envelope data to empty lists', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLeadContactLogs('lead-1')).resolves.toEqual({
      successful: true,
      data: [],
    });
    await expect(fetchAllLeadTasks('lead-1')).resolves.toEqual({
      successful: true,
      data: [],
    });
  });

  test('patches only supplied fields and returns the authoritative lead envelope', async () => {
    const { fetchMock, jsonMock } = stubResponse({
      lead,
      message: 'Lead updated successfully',
    });
    const fields = {
      status: 'contacted' as const,
      notes: 'Call next week',
      nextFollowUpAt: '2026-08-01T12:00:00.000Z',
    };

    await expect(patchLeadEditableFields('lead-1', fields)).resolves.toEqual(lead);
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    expect(jsonMock).toHaveBeenCalledOnce();
  });

  test('posts and decodes a contact log', async () => {
    const { fetchMock } = stubResponse({
      contactLog,
      message: 'Contact log added successfully',
    });
    const newContactLog = {
      type: 'email' as const,
      summary: 'Sent the proposal',
      outcome: 'positive' as const,
    };

    await expect(createLeadContactLog('lead-1', newContactLog)).resolves.toEqual({
      successful: true,
      data: contactLog,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newContactLog),
    });
  });

  test.each([
    ['complete', '2026-07-25T12:34:56.000Z'],
    ['reopen', null],
  ] as const)('patches the exact task body to %s a task', async (_label, completedAt) => {
    const { fetchMock, jsonMock } = stubResponse({ task });

    await expect(setLeadTaskCompletion('task-1', completedAt)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completedAt }),
    });
    expect(jsonMock).not.toHaveBeenCalled();
  });

  test('deletes a task without a request body and ignores the response envelope', async () => {
    const { fetchMock, jsonMock } = stubResponse({
      message: 'Task deleted successfully',
    });

    await expect(deleteLeadTask('task-1')).resolves.toEqual({
      successful: true,
      data: null,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/task-1', { method: 'DELETE' });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(jsonMock).not.toHaveBeenCalled();
  });
});

describe('LeadDetailModal client failure contracts', () => {
  const resultOperations = [
    ['fetch contact logs', () => fetchLeadContactLogs('lead-1')],
    ['fetch tasks', () => fetchAllLeadTasks('lead-1')],
    [
      'create a contact log',
      () =>
        createLeadContactLog('lead-1', {
          type: 'call',
          summary: 'Called',
          outcome: 'neutral',
        }),
    ],
    ['delete a task', () => deleteLeadTask('task-1')],
  ] as const;

  test.each(resultOperations)(
    'returns explicit no-data failure when %s is non-OK',
    async (_name, run) => {
      const { jsonMock } = stubResponse({ error: 'Request failed' }, false);

      await expect(run()).resolves.toEqual({ successful: false, data: null });
      expect(jsonMock).not.toHaveBeenCalled();
    }
  );

  test('throws one consistent client error for non-OK and malformed lead responses', async () => {
    const { jsonMock } = stubResponse({ error: 'Request failed' }, false);

    await expect(patchLeadEditableFields('lead-1', { notes: 'Notes' })).rejects.toThrow(
      'Lead update request failed'
    );
    expect(jsonMock).not.toHaveBeenCalled();

    stubResponse({ message: 'Missing lead envelope' });
    await expect(patchLeadEditableFields('lead-1', { notes: 'Notes' })).rejects.toThrow(
      'Lead update request failed'
    );
  });

  test('rejects malformed lead DTOs inside an otherwise valid envelope', async () => {
    stubResponse({ lead: { id: 'lead-1', status: 'contacted' } });

    await expect(patchLeadEditableFields('lead-1', { status: 'contacted' })).rejects.toThrow(
      'Lead update request failed'
    );
  });

  test('rejects task completion when the response is non-OK', async () => {
    const { jsonMock } = stubResponse({ error: 'Request failed' }, false);

    await expect(setLeadTaskCompletion('task-1', null)).rejects.toThrow(
      'Task completion request failed'
    );
    expect(jsonMock).not.toHaveBeenCalled();
  });

  test.each([
    ...resultOperations,
    ['patch a lead', () => patchLeadEditableFields('lead-1', { notes: 'Notes' })] as const,
    ['set task completion', () => setLeadTaskCompletion('task-1', null)] as const,
  ])('rejects when %s has a network failure', async (_name, run) => {
    const networkError = new Error('Network unavailable');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    await expect(run()).rejects.toBe(networkError);
  });

  test.each([
    ['contact logs', () => fetchLeadContactLogs('lead-1')],
    ['tasks', () => fetchAllLeadTasks('lead-1')],
    [
      'created contact log',
      () =>
        createLeadContactLog('lead-1', {
          type: 'call',
          summary: 'Called',
          outcome: 'neutral',
        }),
    ],
  ] as const)('rejects when the %s response envelope cannot be decoded', async (_name, run) => {
    const jsonError = new SyntaxError('Invalid JSON');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(jsonError),
      } as unknown as Response)
    );

    await expect(run()).rejects.toBe(jsonError);
  });
});
