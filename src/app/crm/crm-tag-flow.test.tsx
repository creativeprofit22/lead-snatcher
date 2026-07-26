import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Lead, TagWithCount } from '@/types';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: successToast, error: errorToast },
}));

vi.mock('@/components/leads', () => ({
  LeadDetailModal: () => null,
}));

vi.mock('@/components/tasks', () => ({
  TaskSlideOver: () => null,
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
    LeadsTable: ({
      leads,
      onToggleSelect,
      onDelete,
    }: {
      leads: Lead[];
      onToggleSelect?: (leadId: string) => void;
      onDelete?: (leadId: string) => void;
    }) => (
      <div>
        {leads.map((lead) => (
          <div key={lead.id}>
            <span>{lead.name}</span>
            <span data-testid={`lead-tags-${lead.id}`}>
              {lead.tags.map((tag) => tag.name).join(', ')}
            </span>
            <button onClick={() => onToggleSelect?.(lead.id)}>Select {lead.name}</button>
            <button onClick={() => onDelete?.(lead.id)}>Delete {lead.name}</button>
          </div>
        ))}
      </div>
    ),
  };
});

import CRMPage from './page';

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

function lead(tags: TagWithCount[]): Lead {
  return {
    id: 'lead-1',
    placeId: 'place-1',
    name: 'Acme Dental',
    address: null,
    phone: null,
    website: null,
    rating: null,
    reviewCount: null,
    industryType: 'other',
    photoUrl: null,
    mapsUrl: null,
    leadScore: 75,
    scoreBreakdown: null,
    status: 'new',
    notes: null,
    opportunities: [],
    lastContactedAt: null,
    nextFollowUpAt: null,
    savedAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
    tags: tags.map(({ id, name, color, createdAt }) => ({ id, name, color, createdAt })),
    popularTimesData: null,
    popularTimesScrapedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CRM tag catalog flow', () => {
  test('synchronizes tag mutations across filters, lead badges, and an already-mounted bulk picker', async () => {
    let tags: TagWithCount[] = [
      {
        id: 'tag-1',
        name: 'Original',
        color: '#3b82f6',
        createdAt: '2026-07-25T10:00:00.000Z',
        leadCount: 1,
      },
    ];
    let deletedTag = false;
    const leadUrlsAfterDelete: string[] = [];
    const leadUrls: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/tags' && method === 'GET') {
        return jsonResponse({ tags });
      }

      if (url === '/api/tags' && method === 'POST') {
        const body = JSON.parse(requestBody(init?.body)) as { name: string; color: string };
        const createdTag: TagWithCount = {
          id: 'tag-2',
          name: body.name,
          color: body.color,
          createdAt: '2026-07-25T11:00:00.000Z',
          leadCount: 0,
        };
        tags = [...tags, createdTag];
        return jsonResponse({ tag: createdTag });
      }

      if (url === '/api/tags/tag-1' && method === 'PATCH') {
        const body = JSON.parse(requestBody(init?.body)) as { name: string; color: string };
        tags = tags.map((tag) => (tag.id === 'tag-1' ? { ...tag, ...body } : tag));
        return jsonResponse({ tag: tags.find((tag) => tag.id === 'tag-1') });
      }

      if (url === '/api/tags/tag-1' && method === 'DELETE') {
        tags = tags.filter((tag) => tag.id !== 'tag-1');
        deletedTag = true;
        return jsonResponse({ message: 'Tag deleted successfully' });
      }

      if (url.startsWith('/api/leads?')) {
        leadUrls.push(url);
        if (deletedTag) leadUrlsAfterDelete.push(url);
        const requestedTagIds = new URL(url, 'http://localhost').searchParams
          .get('tags')
          ?.split(',');
        const matchingLeads =
          requestedTagIds && !requestedTagIds.some((tagId) => tags.some((tag) => tag.id === tagId))
            ? []
            : [lead(tags.filter((tag) => tag.id === 'tag-1'))];
        return jsonResponse({ leads: matchingLeads });
      }

      if (url === '/api/leads/stats') {
        return jsonResponse({
          stats: {
            total: 1,
            byStatus: {
              new: 1,
              contacted: 0,
              called: 0,
              proposal_sent: 0,
              negotiating: 0,
              won: 0,
              lost: 0,
            },
            conversionRate: 0,
            avgLeadScore: 75,
            hotLeads: 1,
            coldLeads: 0,
          },
        });
      }

      if (url === '/api/tasks?status=pending&include=stats' && method === 'GET') {
        return jsonResponse({
          tasks: [],
          stats: { total: 0, pending: 0, completed: 0, overdue: 0, dueToday: 0 },
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true)
    );

    render(<CRMPage />);

    await screen.findByText('Acme Dental');
    expect(screen.getByTestId('lead-tags-lead-1').textContent).toBe('Original');

    fireEvent.click(screen.getByRole('button', { name: 'Select Acme Dental' }));
    expect(await screen.findByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Tag' }));
    expect(screen.getByRole('button', { name: 'Original' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Tag' }));

    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Tags' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create new tag' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New tag name' }), {
      target: { value: 'Created' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new tag' }));
    await screen.findByRole('button', { name: 'Edit Created' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Original' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename Original' }), {
      target: { value: 'Priority' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set tag color to #22c55e' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Original' }));

    await screen.findByRole('button', { name: 'Delete Priority' });
    await waitFor(() => {
      expect(screen.getByTestId('lead-tags-lead-1').textContent).toBe('Priority');
    });
    expect(
      fetchMock.mock.calls.some(([url, options]) => {
        if (url !== '/api/tags/tag-1' || options?.method !== 'PATCH') return false;
        return JSON.parse(requestBody(options.body)).color === '#22c55e';
      })
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close tag manager' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Priority' }));
    await waitFor(() => expect(leadUrls.some((url) => url.includes('tags=tag-1'))).toBe(true));

    // Server-filter changes intentionally clear the current visible-result selection.
    fireEvent.click(screen.getByRole('button', { name: 'Select Acme Dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Tag' }));
    expect(screen.getByRole('button', { name: 'Priority' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Created' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Tag' }));

    fireEvent.click(screen.getByRole('button', { name: 'Manage Tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Priority' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete Priority' })).toBeNull()
    );
    await waitFor(() => expect(leadUrlsAfterDelete.length).toBeGreaterThan(0));
    expect(new URL(leadUrlsAfterDelete[0]!, 'http://localhost').searchParams.has('tags')).toBe(
      false
    );
    expect(screen.queryByRole('checkbox', { name: 'Priority' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('lead-tags-lead-1').textContent).toBe(''));

    fireEvent.click(screen.getByRole('button', { name: 'Close tag manager' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Acme Dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Tag' }));
    expect(screen.getByRole('button', { name: 'Created' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Priority' })).toBeNull();
    expect(errorToast).not.toHaveBeenCalled();
    expect(successToast).toHaveBeenCalledWith('Tag created');
    expect(successToast).toHaveBeenCalledWith('Tag updated');
    expect(successToast).toHaveBeenCalledWith('Tag deleted');
  }, 30_000);

  test('refetches tag usage counts after deleting a single lead', async () => {
    const catalogTag: TagWithCount = {
      id: 'tag-1',
      name: 'Priority',
      color: '#3b82f6',
      createdAt: '2026-07-25T10:00:00.000Z',
      leadCount: 1,
    };
    let leadExists = true;
    let tagRequestCount = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';

      if (url === '/api/tags' && method === 'GET') {
        tagRequestCount += 1;
        return jsonResponse({
          tags: [{ ...catalogTag, leadCount: leadExists ? 1 : 0 }],
        });
      }

      if (url.startsWith('/api/leads?') && method === 'GET') {
        return jsonResponse({ leads: leadExists ? [lead([catalogTag])] : [] });
      }

      if (url === '/api/leads/stats' && method === 'GET') {
        const total = leadExists ? 1 : 0;
        return jsonResponse({
          stats: {
            total,
            byStatus: {
              new: total,
              contacted: 0,
              called: 0,
              proposal_sent: 0,
              negotiating: 0,
              won: 0,
              lost: 0,
            },
            conversionRate: 0,
            avgLeadScore: total ? 75 : 0,
            hotLeads: total,
            coldLeads: 0,
          },
        });
      }

      if (url === '/api/leads/lead-1' && method === 'DELETE') {
        leadExists = false;
        return jsonResponse({ message: 'Lead deleted successfully' });
      }

      if (url === '/api/tasks?status=pending&include=stats' && method === 'GET') {
        return jsonResponse({
          tasks: [],
          stats: { total: 0, pending: 0, completed: 0, overdue: 0, dueToday: 0 },
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CRMPage />);

    await screen.findByText('Acme Dental');
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Tags' }));
    expect(await screen.findByText('1 leads')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close tag manager' }));
    const tagRequestsBeforeDelete = tagRequestCount;
    fireEvent.click(screen.getByRole('button', { name: 'Delete Acme Dental' }));

    await waitFor(() => expect(screen.queryByText('Acme Dental')).toBeNull());
    await waitFor(() => expect(tagRequestCount).toBeGreaterThan(tagRequestsBeforeDelete));
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1', { method: 'DELETE' });

    fireEvent.click(screen.getByRole('button', { name: 'Manage Tags' }));
    expect(await screen.findByText('0 leads')).toBeTruthy();
    expect(successToast).toHaveBeenCalledWith('Lead deleted');
    expect(errorToast).not.toHaveBeenCalled();
  });
});
