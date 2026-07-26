import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Lead, LeadStatus } from '@/types';
import type { LeadListFilters } from '@/lib/crm-lead-query';
import type { TabValue } from '@/components/crm';

const { errorToast, successToast } = vi.hoisted(() => ({
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: errorToast, success: successToast },
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
    CRMHeader: () => null,
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
        <button type="button" onClick={() => onTabChange('pipeline')}>
          Pipeline
        </button>
        {children}
      </div>
    ),
    TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    MetricsRow: () => null,
    TasksWidget: () => null,
    TagManager: () => null,
    BulkActions: () => null,
    LeadsTable: () => null,
    FilterSidebar: ({
      filters,
      onFiltersChange,
    }: {
      filters: LeadListFilters;
      onFiltersChange: (filters: LeadListFilters) => void;
    }) => (
      <button type="button" onClick={() => onFiltersChange({ ...filters, statuses: ['won'] })}>
        Show sidebar Won scope
      </button>
    ),
    KanbanBoard: ({
      leads,
      onStatusChange,
    }: {
      leads: Lead[];
      onStatusChange: (leadId: string, status: LeadStatus) => Promise<void>;
    }) => (
      <div>
        {leads.map((lead) => (
          <article key={lead.id}>
            <span>{lead.name}</span>
            {(['contacted', 'won', 'lost'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => void onStatusChange(lead.id, status)}
              >
                Set {lead.name} to {status}
              </button>
            ))}
          </article>
        ))}
      </div>
    ),
  };
});

import CRMPage from './page';

function createLead(status: LeadStatus): Lead {
  return {
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
    leadScore: 75,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

function setupApi(initialStatus: LeadStatus, patchStatus = 200) {
  let currentLead = createLead(initialStatus);
  const leadQueries: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';

    if (url.startsWith('/api/leads?') && method === 'GET') {
      leadQueries.push(url);
      const statuses = new URL(url, 'http://localhost').searchParams.get('statuses')?.split(',');
      const matches = !statuses || statuses.includes(currentLead.status);
      return jsonResponse({ leads: matches ? [currentLead] : [] });
    }

    if (url === '/api/leads/stats' && method === 'GET') {
      return jsonResponse({ stats: { total: 1, byStatus: {}, conversionRate: 0 } });
    }

    if (url === '/api/leads/lead-1' && method === 'PATCH') {
      if (patchStatus !== 200) return jsonResponse({ error: 'Rejected' }, patchStatus);
      const body = JSON.parse(requestBody(init?.body)) as { status: LeadStatus };
      currentLead = {
        ...currentLead,
        status: body.status,
        lastContactedAt:
          body.status === 'contacted' ? '2026-07-25T12:00:00.000Z' : currentLead.lastContactedAt,
        updatedAt: '2026-07-25T12:00:00.000Z',
      };
      return jsonResponse({ lead: currentLead });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, leadQueries };
}

function latestStatuses(leadQueries: string[]): string | null | undefined {
  const latestQuery = leadQueries.at(-1);
  return latestQuery
    ? new URL(latestQuery, 'http://localhost').searchParams.get('statuses')
    : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('crm-view-mode', 'kanban');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CRM lead status reconciliation', () => {
  test('removes a Won lead after it enters Pipeline and refetches the Won scope', async () => {
    const { fetchMock, leadQueries } = setupApi('won');
    render(<CRMPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Won' }));
    await screen.findByText('Acme Dental');
    await waitFor(() => expect(latestStatuses(leadQueries)).toBe('won'));

    fireEvent.click(screen.getByRole('button', { name: 'Set Acme Dental to contacted' }));

    await waitFor(() => expect(screen.queryByText('Acme Dental')).toBeNull());
    expect(latestStatuses(leadQueries)).toBe('won');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/leads/lead-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'contacted' }) })
    );
    expect(successToast).toHaveBeenCalledWith('Status updated to Contacted');
  });

  test('removes a Pipeline lead after it enters Won and refetches the Pipeline scope', async () => {
    const { leadQueries } = setupApi('contacted');
    render(<CRMPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Pipeline' }));
    await screen.findByText('Acme Dental');
    await waitFor(() =>
      expect(latestStatuses(leadQueries)).toBe('contacted,called,proposal_sent,negotiating')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set Acme Dental to won' }));

    await waitFor(() => expect(screen.queryByText('Acme Dental')).toBeNull());
    expect(latestStatuses(leadQueries)).toBe('contacted,called,proposal_sent,negotiating');
    expect(successToast).toHaveBeenCalledWith('Status updated to Won');
  });

  test('removes a lead that leaves the sidebar Won scope', async () => {
    const { leadQueries } = setupApi('won');
    render(<CRMPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar Won scope' }));
    await screen.findByText('Acme Dental');
    await waitFor(() => expect(latestStatuses(leadQueries)).toBe('won'));

    fireEvent.click(screen.getByRole('button', { name: 'Set Acme Dental to lost' }));

    await waitFor(() => expect(screen.queryByText('Acme Dental')).toBeNull());
    expect(latestStatuses(leadQueries)).toBe('won');
    expect(successToast).toHaveBeenCalledWith('Status updated to Lost');
  });

  test('rolls back an optimistic status after a non-OK PATCH', async () => {
    setupApi('won', 500);
    render(<CRMPage />);

    await screen.findByText('Acme Dental');
    fireEvent.click(screen.getByRole('button', { name: 'Set Acme Dental to lost' }));

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Failed to update status'));
    expect(await screen.findByText('Acme Dental')).toBeTruthy();
    expect(successToast).not.toHaveBeenCalled();
  });
});
