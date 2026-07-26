import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Lead } from '@/types';
import type { LeadListFilters } from '@/lib/crm-lead-query';

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
    CRMHeader: () => null,
    CRMTabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    MetricsRow: () => null,
    TasksWidget: () => null,
    KanbanBoard: () => null,
    TagManager: () => null,
    BulkActions: () => null,
    FilterSidebar: ({
      filters,
      onFiltersChange,
    }: {
      filters: LeadListFilters;
      onFiltersChange: (filters: LeadListFilters) => void;
    }) => (
      <button type="button" onClick={() => onFiltersChange({ ...filters, minScore: 60 })}>
        Apply score filter
      </button>
    ),
    LeadsTable: ({ leads, onDelete }: { leads: Lead[]; onDelete: (leadId: string) => void }) => (
      <div>
        {leads.map((item) => (
          <article key={item.id}>
            <span>{item.name}</span>
            <button type="button" onClick={() => onDelete(item.id)}>
              Delete {item.name}
            </button>
          </article>
        ))}
      </div>
    ),
  };
});

import CRMPage from './page';

function lead(): Lead {
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
    leadScore: 50,
    scoreBreakdown: null,
    status: 'new',
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

function stats(total: number) {
  return {
    total,
    byStatus: {
      new: total,
      contacted: 0,
      called: 0,
      proposal_sent: 0,
      negotiating: 0,
      won: 0,
      lost: 0,
      not_interested: 0,
    },
    conversionRate: 0,
    avgLeadScore: total > 0 ? 50 : 0,
    hotLeads: 0,
    coldLeads: 0,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CRM leads read flow', () => {
  test('clears old rows for a changed filter without refetching global stats', async () => {
    const filteredList = deferred<Response>();
    let statsRequestCount = 0;
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.startsWith('/api/leads?') && method === 'GET') {
        const minScore = new URL(url, 'http://localhost').searchParams.get('minScore');
        return minScore === '60'
          ? filteredList.promise
          : Promise.resolve(jsonResponse({ leads: [lead()] }));
      }
      if (url === '/api/leads/stats' && method === 'GET') {
        statsRequestCount += 1;
        return Promise.resolve(jsonResponse({ stats: stats(1) }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<CRMPage />);

    await screen.findByText('Acme Dental');
    await waitFor(() => expect(statsRequestCount).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: 'Apply score filter' }));

    expect(screen.queryByText('Acme Dental')).toBeNull();
    await waitFor(() => {
      expect(fetcher.mock.calls.some(([input]) => requestUrl(input).includes('minScore=60'))).toBe(
        true
      );
    });
    expect(statsRequestCount).toBe(1);

    filteredList.resolve(jsonResponse({ leads: [] }));
    await act(async () => Promise.resolve());
    expect(statsRequestCount).toBe(1);
  });

  test('refreshes global stats after a successful lead deletion', async () => {
    let leadExists = true;
    let statsRequestCount = 0;
    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url.startsWith('/api/leads?') && method === 'GET') {
        return Promise.resolve(jsonResponse({ leads: leadExists ? [lead()] : [] }));
      }
      if (url === '/api/leads/stats' && method === 'GET') {
        statsRequestCount += 1;
        return Promise.resolve(jsonResponse({ stats: stats(leadExists ? 1 : 0) }));
      }
      if (url === '/api/leads/lead-1' && method === 'DELETE') {
        leadExists = false;
        return Promise.resolve(jsonResponse({ message: 'Lead deleted' }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<CRMPage />);

    await screen.findByText('Acme Dental');
    await waitFor(() => expect(statsRequestCount).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Acme Dental' }));

    await waitFor(() => expect(screen.queryByText('Acme Dental')).toBeNull());
    await waitFor(() => expect(statsRequestCount).toBe(2));
  });
});
