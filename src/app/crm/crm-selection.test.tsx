import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Lead } from '@/types';
import type { LeadListFilters } from '@/lib/crm-lead-query';
import type { TabValue, ViewMode } from '@/components/crm';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/leads', () => ({
  LeadDetailModal: () => null,
}));

vi.mock('@/components/tasks', () => ({
  TaskSlideOver: () => null,
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
    CRMHeader: ({
      viewMode,
      onViewModeChange,
      searchQuery,
      onSearchChange,
    }: {
      viewMode: ViewMode;
      onViewModeChange: (mode: ViewMode) => void;
      searchQuery: string;
      onSearchChange: (query: string) => void;
    }) => (
      <div>
        <input
          aria-label="Search leads"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
        />
        <button
          type="button"
          aria-pressed={viewMode === 'list'}
          onClick={() => onViewModeChange('list')}
        >
          List view
        </button>
        <button
          type="button"
          aria-pressed={viewMode === 'kanban'}
          onClick={() => onViewModeChange('kanban')}
        >
          Kanban view
        </button>
      </div>
    ),
    CRMTabs: ({
      children,
      onTabChange,
    }: {
      children: ReactNode;
      onTabChange: (tab: TabValue) => void;
    }) => (
      <div>
        <button type="button" onClick={() => onTabChange('all')}>
          All Leads
        </button>
        <button type="button" onClick={() => onTabChange('won')}>
          Won
        </button>
        {children}
      </div>
    ),
    TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    MetricsRow: () => null,
    TasksWidget: () => null,
    TagManager: () => null,
    KanbanBoard: ({ leads }: { leads: Lead[] }) => (
      <div>Kanban: {leads.map((lead) => lead.name).join(', ')}</div>
    ),
    LeadsTable: ({
      leads,
      selectedLeadIds,
      onToggleSelect,
      onSelectAllVisible,
      onDeselectVisible,
      onDelete,
    }: {
      leads: Lead[];
      selectedLeadIds: Set<string>;
      onToggleSelect: (leadId: string) => void;
      onSelectAllVisible: () => void;
      onDeselectVisible: () => void;
      onDelete: (leadId: string) => void;
    }) => {
      const allVisibleSelected =
        leads.length > 0 && leads.every((lead) => selectedLeadIds.has(lead.id));

      return (
        <div>
          <button
            type="button"
            onClick={allVisibleSelected ? onDeselectVisible : onSelectAllVisible}
          >
            {allVisibleSelected ? 'Deselect visible' : 'Select all visible'}
          </button>
          {leads.map((lead) => (
            <div key={lead.id}>
              <span>{lead.name}</span>
              <button type="button" onClick={() => onToggleSelect(lead.id)}>
                Select {lead.name}
              </button>
              <button type="button" onClick={() => onDelete(lead.id)}>
                Delete row {lead.name}
              </button>
            </div>
          ))}
        </div>
      );
    },
    FilterSidebar: ({
      filters,
      onFiltersChange,
    }: {
      filters: LeadListFilters;
      onFiltersChange: (filters: LeadListFilters) => void;
    }) => (
      <button type="button" onClick={() => onFiltersChange({ ...filters, minScore: 50 })}>
        Apply score filter
      </button>
    ),
  };
});

import CRMPage from './page';

function lead(id: string, name: string, leadScore: number, status: Lead['status']): Lead {
  return {
    id,
    placeId: `place-${id}`,
    name,
    address: null,
    phone: null,
    website: null,
    rating: null,
    reviewCount: null,
    industryType: 'other',
    photoUrl: null,
    mapsUrl: null,
    leadScore,
    scoreBreakdown: null,
    status,
    notes: null,
    opportunities: [],
    lastContactedAt: null,
    nextFollowUpAt: null,
    savedAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
    tags: [],
    popularTimesData: null,
    popularTimesScrapedAt: null,
  };
}

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

function requestBody(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new Error('Expected a JSON request body');
  return body;
}

function setupFetch() {
  let availableLeads = [
    lead('alpha', 'Alpha Dental', 80, 'new'),
    lead('bravo', 'Bravo Bakery', 40, 'won'),
  ];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.startsWith('/api/leads?') && method === 'GET') {
      const params = new URL(url, 'http://localhost').searchParams;
      const statuses = params.get('statuses')?.split(',');
      const minScore = Number(params.get('minScore') ?? 0);
      return jsonResponse({
        leads: availableLeads.filter(
          (item) => (!statuses || statuses.includes(item.status)) && item.leadScore >= minScore
        ),
      });
    }

    if (url === '/api/leads/stats' && method === 'GET') {
      return jsonResponse({
        stats: {
          total: availableLeads.length,
          byStatus: { new: 1, won: 1 },
          conversionRate: 50,
        },
      });
    }

    if (url === '/api/leads/bulk' && method === 'DELETE') {
      const { leadIds } = JSON.parse(requestBody(init?.body)) as { leadIds: string[] };
      availableLeads = availableLeads.filter((item) => !leadIds.includes(item.id));
      return jsonResponse({ count: leadIds.length });
    }

    if (url.startsWith('/api/leads/') && method === 'DELETE') {
      const deletedId = url.slice('/api/leads/'.length);
      availableLeads = availableLeads.filter((item) => item.id !== deletedId);
      return jsonResponse({ message: 'Lead deleted successfully' });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true)
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CRM current-visible-result selection', () => {
  test('drops a selected lead when search hides it and does not restore the latent ID', async () => {
    setupFetch();
    render(<CRMPage />);

    await screen.findByText('Alpha Dental');
    fireEvent.click(screen.getByRole('button', { name: 'Select Alpha Dental' }));
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search leads' }), {
      target: { value: 'Bravo' },
    });
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());

    fireEvent.change(screen.getByRole('textbox', { name: 'Search leads' }), {
      target: { value: '' },
    });
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  test('clears selection across filter and tab result refetches', async () => {
    setupFetch();
    render(<CRMPage />);

    await screen.findByText('Bravo Bakery');
    fireEvent.click(screen.getByRole('button', { name: 'Select Bravo Bakery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply score filter' }));

    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
    await waitFor(() => expect(screen.queryByText('Bravo Bakery')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Select Alpha Dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Won' }));

    await waitFor(() => expect(screen.queryByText('Alpha Dental')).toBeNull());
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  test('clears list selection when switching to Kanban and keeps it clear on return', async () => {
    setupFetch();
    render(<CRMPage />);

    await screen.findByText('Alpha Dental');
    fireEvent.click(screen.getByRole('button', { name: 'Select Alpha Dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kanban view' }));

    expect(screen.queryByText('1 selected')).toBeNull();
    expect(screen.getByText(/Kanban: Alpha Dental/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  test('selects all visible leads and deselects only through the distinct visible operation', async () => {
    setupFetch();
    render(<CRMPage />);

    await screen.findByText('Alpha Dental');
    fireEvent.click(screen.getByRole('button', { name: 'Select all visible' }));
    expect(screen.getByText('2 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deselect visible' }));
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  test('excludes a search-hidden ID from the destructive bulk request and removes deleted IDs', async () => {
    const fetchMock = setupFetch();
    render(<CRMPage />);

    await screen.findByText('Alpha Dental');
    fireEvent.click(screen.getByRole('button', { name: 'Select all visible' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search leads' }), {
      target: { value: 'Alpha' },
    });
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input as RequestInfo | URL) === '/api/leads/bulk' && init?.method === 'DELETE'
      );
      expect(deleteCall).toBeTruthy();
      expect(JSON.parse(requestBody(deleteCall?.[1]?.body))).toEqual({ leadIds: ['alpha'] });
    });
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });

  test('removes a selected ID after a successful single-row deletion', async () => {
    setupFetch();
    render(<CRMPage />);

    await screen.findByText('Alpha Dental');
    fireEvent.click(screen.getByRole('button', { name: 'Select Alpha Dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete row Alpha Dental' }));

    await waitFor(() => expect(screen.queryByText('Alpha Dental')).toBeNull());
    expect(screen.queryByText('1 selected')).toBeNull();
  });
});
