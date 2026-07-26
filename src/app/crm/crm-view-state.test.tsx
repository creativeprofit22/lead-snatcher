import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { errorToast } = vi.hoisted(() => ({
  errorToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: errorToast },
}));

vi.mock('@/components/auth', () => ({
  UserMenu: () => <button type="button">User menu</button>,
}));

vi.mock('@/components/leads', () => ({
  LeadDetailModal: () => null,
}));

vi.mock('@/components/tasks', () => ({
  TasksDropdown: () => <button type="button">Tasks</button>,
  TaskSlideOver: () => null,
}));

vi.mock('@/lib/search-cache', () => ({
  getLastSearch: () => null,
}));

vi.mock('@/lib/hooks/useCrmTasks', () => ({
  CrmTasksProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/lib/hooks/useCrmTags', () => ({
  useCrmTags: () => ({
    tags: [],
    loading: false,
    error: null,
    refetch: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/components/crm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/crm')>();

  return {
    ...actual,
    CRMLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    MetricsRow: () => null,
    TasksWidget: () => null,
    LeadsTable: () => <div>List content</div>,
    KanbanBoard: () => <div>Kanban content</div>,
    TagManager: () => null,
    BulkActions: () => null,
  };
});

import CRMPage from './page';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function latestLeadQuery(fetchMock: ReturnType<typeof vi.fn>): URLSearchParams | undefined {
  const leadRequest = [...fetchMock.mock.calls]
    .reverse()
    .map(([input]) => requestUrl(input as RequestInfo | URL))
    .find((url) => url.startsWith('/api/leads?'));

  return leadRequest ? new URL(leadRequest, 'http://localhost').searchParams : undefined;
}

function setupFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);

    if (url.startsWith('/api/leads?')) return jsonResponse({ leads: [] });
    if (url === '/api/leads/stats') {
      return jsonResponse({
        stats: { total: 0, byStatus: {}, conversionRate: 0 },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CRM view and filter state', () => {
  test('scoped tabs clear user statuses and expose the tab-owned status scope', async () => {
    const fetchMock = setupFetch();
    render(<CRMPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Contacted' }));
    await waitFor(() => expect(latestLeadQuery(fetchMock)?.get('statuses')).toBe('contacted'));

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pipeline' }), { button: 0 });

    await waitFor(() => {
      expect(latestLeadQuery(fetchMock)?.get('statuses')).toBe(
        'contacted,called,proposal_sent,negotiating'
      );
    });
    const scopedStatusControl = screen.getByRole('button', { name: /Status.*Pipeline tab/ });
    expect(scopedStatusControl.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Statuses are set by the Pipeline tab.')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Contacted' })).toBeNull();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'All Leads' }), { button: 0 });
    expect((screen.getByRole('checkbox', { name: 'Contacted' }) as HTMLInputElement).checked).toBe(
      false
    );
  });

  test('opens and resets filters while the persisted Kanban view remains active', async () => {
    localStorage.setItem('crm-view-mode', 'kanban');
    const fetchMock = setupFetch();
    render(<CRMPage />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Kanban view' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    );
    expect(screen.getByText('Kanban content')).toBeTruthy();

    const filtersButton = screen.getByRole('button', { name: 'Filters' });
    fireEvent.click(filtersButton);
    expect(filtersButton.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Lead Score' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minimum lead score' }), {
      target: { value: '40' },
    });
    await waitFor(() => expect(latestLeadQuery(fetchMock)?.get('minScore')).toBe('40'));

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(latestLeadQuery(fetchMock)?.has('minScore')).toBe(false));
    expect(screen.getByText('Kanban content')).toBeTruthy();
  });

  test('lets a persisted mobile Kanban user switch back to List', async () => {
    localStorage.setItem('crm-view-mode', 'kanban');
    setupFetch();
    render(<CRMPage />);

    const listButton = screen.getByRole('button', { name: 'List view' });
    const kanbanButton = screen.getByRole('button', { name: 'Kanban view' });
    await waitFor(() => expect(kanbanButton.getAttribute('aria-pressed')).toBe('true'));
    expect(listButton.closest('[role="group"]')?.className.includes('hidden')).toBe(false);

    fireEvent.click(listButton);

    expect(localStorage.getItem('crm-view-mode')).toBe('list');
    expect(listButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('List content')).toBeTruthy();
  });
});
