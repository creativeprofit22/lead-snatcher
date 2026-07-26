import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defaultLeadListQuery, type LeadListFilters } from '@/lib/crm-lead-query';
import type { Lead, PipelineStats } from '@/types';
import {
  CrmLeadsRequestError,
  CrmLeadsResponseError,
  useCrmLeadsController,
} from './useCrmLeadsController';

function lead(id: string, name: string): Lead {
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

function stats(total: number): PipelineStats {
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

function filteredQuery(overrides: Partial<LeadListFilters>): LeadListFilters {
  return { ...defaultLeadListQuery, ...overrides };
}

afterEach(() => cleanup());

describe('useCrmLeadsController', () => {
  test('ignores an older list response that finishes after a newer query', async () => {
    const firstList = deferred<Response>();
    const secondList = deferred<Response>();
    let listRequestCount = 0;
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/leads?')) {
        listRequestCount += 1;
        return listRequestCount === 1 ? firstList.promise : secondList.promise;
      }
      return Promise.resolve(jsonResponse({ stats: stats(0) }));
    });
    const { result, rerender } = renderHook(({ query }) => useCrmLeadsController(query, fetcher), {
      initialProps: { query: defaultLeadListQuery },
    });

    await waitFor(() => expect(listRequestCount).toBe(1));
    rerender({ query: filteredQuery({ minScore: 60 }) });
    await waitFor(() => expect(listRequestCount).toBe(2));
    expect(result.current.leads).toEqual([]);

    secondList.resolve(jsonResponse({ leads: [lead('newer', 'Newer result')] }));
    await waitFor(() => expect(result.current.leads.map((item) => item.id)).toEqual(['newer']));

    firstList.resolve(jsonResponse({ leads: [lead('older', 'Older result')] }));
    await act(async () => Promise.resolve());

    expect(result.current.leads.map((item) => item.id)).toEqual(['newer']);
    expect(result.current.leadsError).toBeNull();
  });

  test('ignores an older stats response after an explicit refresh wins', async () => {
    const firstStats = deferred<Response>();
    const secondStats = deferred<Response>();
    let statsRequestCount = 0;
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url === '/api/leads/stats') {
        statsRequestCount += 1;
        return statsRequestCount === 1 ? firstStats.promise : secondStats.promise;
      }
      return Promise.resolve(jsonResponse({ leads: [] }));
    });
    const { result } = renderHook(() => useCrmLeadsController(defaultLeadListQuery, fetcher));

    await waitFor(() => expect(statsRequestCount).toBe(1));
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.refreshStats();
    });
    await waitFor(() => expect(statsRequestCount).toBe(2));

    secondStats.resolve(jsonResponse({ stats: stats(2) }));
    await act(async () => refresh);
    expect(result.current.stats?.total).toBe(2);

    firstStats.resolve(jsonResponse({ stats: stats(1) }));
    await act(async () => Promise.resolve());
    expect(result.current.stats?.total).toBe(2);
  });

  test.each([401, 500])('clears list data and exposes an HTTP %s read error', async (status) => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/leads?')) {
        return Promise.resolve(jsonResponse({ error: 'Request failed' }, status));
      }
      return Promise.resolve(jsonResponse({ stats: stats(0) }));
    });
    const { result } = renderHook(() => useCrmLeadsController(defaultLeadListQuery, fetcher));

    await waitFor(() => expect(result.current.leadsLoading).toBe(false));

    expect(result.current.leads).toEqual([]);
    expect(result.current.leadsError).toBeInstanceOf(CrmLeadsRequestError);
    expect(result.current.leadsError).toMatchObject({ resource: 'leads', status });
  });

  test('rejects malformed list and stats envelopes instead of presenting them', async () => {
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/leads?')) {
        return Promise.resolve(jsonResponse({ results: [lead('wrong', 'Wrong envelope')] }));
      }
      return Promise.resolve(jsonResponse({ metrics: stats(1) }));
    });
    const { result } = renderHook(() => useCrmLeadsController(defaultLeadListQuery, fetcher));

    await waitFor(() => {
      expect(result.current.leadsLoading).toBe(false);
      expect(result.current.statsLoading).toBe(false);
    });

    expect(result.current.leads).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.leadsError).toBeInstanceOf(CrmLeadsResponseError);
    expect(result.current.statsError).toBeInstanceOf(CrmLeadsResponseError);
  });
});
