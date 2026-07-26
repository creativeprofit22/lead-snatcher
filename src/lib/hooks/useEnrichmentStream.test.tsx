import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from 'sonner';
import type { BusinessSearchResult, ScoreBreakdown } from '@/types';
import { useEnrichmentStream } from './useEnrichmentStream';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const scoreBreakdown = {
  qualityChips: [],
  marketingPlatforms: [],
} as unknown as ScoreBreakdown;

function lead(
  placeId: string,
  overrides: Partial<BusinessSearchResult> = {}
): BusinessSearchResult {
  return {
    placeId,
    name: placeId,
    photoCount: 0,
    types: [],
    socialLinks: {},
    contactPoints: 0,
    leadScore: 0,
    scoreBreakdown,
    opportunities: [],
    industryType: 'other',
    ...overrides,
  };
}

function responseFromRows(rows: unknown[]): Response {
  return new Response(`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useEnrichmentStream protocol state', () => {
  test('maps cached, ok, rate-limited, and error rows into hook-owned state', async () => {
    vi.mocked(fetch).mockResolvedValue(
      responseFromRows([
        {
          businessId: 'cached',
          status: 'cached',
          website: 'https://cached.example',
        },
        {
          businessId: 'ok',
          status: 'ok',
          socials: { instagram: 'https://instagram.com/ok' },
        },
        { businessId: 'rate', status: 'rate_limited' },
        { businessId: 'error', status: 'error', error: 'provider failed' },
      ])
    );
    const { result } = renderHook(() => useEnrichmentStream());

    await act(async () => {
      await result.current.enrichLeads(
        [lead('cached'), lead('ok'), lead('rate'), lead('error')],
        'London',
        'GB'
      );
    });

    expect(result.current.statusMap).toEqual({
      cached: 'enriched',
      ok: 'enriched',
      rate: 'rate_limited',
      error: 'error',
    });
    expect(result.current.resultMap).toEqual({
      cached: {
        website: 'https://cached.example',
        socials: undefined,
        cached: true,
        error: undefined,
      },
      ok: {
        website: undefined,
        socials: { instagram: 'https://instagram.com/ok' },
        cached: false,
        error: undefined,
      },
      rate: {
        website: undefined,
        socials: undefined,
        cached: false,
        error: undefined,
      },
      error: {
        website: undefined,
        socials: undefined,
        cached: false,
        error: 'provider failed',
      },
    });
  });

  test('does not let hydration clobber an active stream', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () => new Promise<Response>((resolve) => (resolveFetch = resolve))
    );
    const { result } = renderHook(() => useEnrichmentStream());

    let enrichment!: Promise<void>;
    act(() => {
      enrichment = result.current.enrichLeads([lead('active')], 'London', 'GB');
    });
    await waitFor(() => expect(result.current.statusMap).toEqual({ active: 'enriching' }));

    act(() => {
      result.current.hydrate(
        { persisted: 'enriched' },
        { persisted: { website: 'https://persisted.example' } }
      );
    });

    expect(result.current.statusMap).toEqual({ active: 'enriching' });
    expect(result.current.resultMap).toEqual({});

    resolveFetch(responseFromRows([{ businessId: 'active', status: 'ok' }]));
    await act(async () => enrichment);
  });

  test('session replacement aborts A and ignores its late row for an overlapping B place ID', async () => {
    let resolveFetch!: (response: Response) => void;
    let signal!: AbortSignal;
    vi.mocked(fetch).mockImplementation((_input, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    const { result } = renderHook(() => useEnrichmentStream());

    let enrichment!: Promise<void>;
    act(() => {
      enrichment = result.current.enrichLeads([lead('shared')], 'London', 'GB');
    });
    await waitFor(() => expect(result.current.statusMap.shared).toBe('enriching'));

    act(() => {
      result.current.replaceSession(
        { shared: 'enriched', onlyB: 'rate_limited' },
        { shared: { website: 'https://b.example' } }
      );
    });
    expect(signal.aborted).toBe(true);

    resolveFetch(
      responseFromRows([{ businessId: 'shared', status: 'ok', website: 'https://late-a.example' }])
    );
    await act(async () => enrichment);

    expect(result.current.statusMap).toEqual({ shared: 'enriched', onlyB: 'rate_limited' });
    expect(result.current.resultMap).toEqual({
      shared: { website: 'https://b.example' },
    });
  });

  test('aborts the previous global stream when a new enrichment starts', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch)
      .mockImplementationOnce((_input, init) => {
        signals.push(init?.signal as AbortSignal);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      })
      .mockImplementationOnce((_input, init) => {
        signals.push(init?.signal as AbortSignal);
        return Promise.resolve(responseFromRows([{ businessId: 'second', status: 'ok' }]));
      });
    const { result } = renderHook(() => useEnrichmentStream());

    let first!: Promise<void>;
    act(() => {
      first = result.current.enrichLeads([lead('first')], 'London', 'GB');
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.enrichLeads([lead('second')], 'London', 'GB');
      await first;
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(result.current.statusMap).toEqual({ first: 'enriching', second: 'enriched' });
  });

  test('turns network and HTTP failures into statuses, banners, and existing toast messages', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Provider down' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    const { result } = renderHook(() => useEnrichmentStream());

    await act(async () => result.current.enrichLeads([lead('network')], 'London', 'GB'));
    expect(result.current.statusMap.network).toBe('error');
    expect(result.current.bannerError).toEqual({
      kind: 'network',
      message: "Couldn't reach enrichment service — check your connection",
    });
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't reach enrichment service — check your connection"
    );

    await act(async () => result.current.enrichLeads([lead('server')], 'London', 'GB'));
    expect(result.current.statusMap.server).toBe('error');
    expect(result.current.bannerError).toEqual({
      kind: 'server_error',
      message: 'Enrichment failed (500): Provider down',
      status: 500,
    });
  });

  test('marks only still-active rows as errors when the stream drops', async () => {
    const encoder = new TextEncoder();
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          value: encoder.encode('{"businessId":"done","status":"ok"}\n'),
          done: false,
        })
        .mockRejectedValueOnce(new Error('socket dropped')),
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      body: { getReader: () => reader },
    } as unknown as Response);
    const { result } = renderHook(() => useEnrichmentStream());

    await act(async () => {
      await result.current.enrichLeads([lead('done'), lead('pending')], 'London', 'GB');
    });

    expect(result.current.statusMap).toEqual({ done: 'enriched', pending: 'error' });
    expect(toast.error).toHaveBeenCalledWith('Enrichment stream dropped — click any lead to retry');
  });
});

describe('useEnrichmentStream success lifecycle', () => {
  test('expires enriched success exactly three seconds after completion', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(responseFromRows([{ businessId: 'success', status: 'ok' }]));
    const { result } = renderHook(() => useEnrichmentStream());

    await act(async () => {
      await result.current.enrichLeads([lead('success')], 'London', 'GB');
    });
    expect(result.current.statusMap.success).toBe('enriched');

    act(() => vi.advanceTimersByTime(2_999));
    expect(result.current.statusMap.success).toBe('enriched');

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.statusMap.success).toBeUndefined();
    expect(result.current.resultMap.success).toBeDefined();
  });

  test('clears a stale banner when a successful row arrives', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(responseFromRows([{ businessId: 'recovered', status: 'cached' }]));
    const { result } = renderHook(() => useEnrichmentStream());

    await act(async () => result.current.enrichLeads([lead('failed')], 'London', 'GB'));
    expect(result.current.bannerError).not.toBeNull();

    await act(async () => result.current.enrichLeads([lead('recovered')], 'London', 'GB'));
    expect(result.current.bannerError).toBeNull();
  });
});
