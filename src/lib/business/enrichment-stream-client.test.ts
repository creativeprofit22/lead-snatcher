import { describe, expect, test, vi } from 'vitest';
import {
  buildEnrichmentRequest,
  streamEnrichment,
  type EnrichmentStreamRow,
} from './enrichment-stream-client';
import type { BusinessSearchResult, ScoreBreakdown } from '@/types';

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

function responseFromChunks(chunks: string[], responseInit: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    responseInit
  );
}

function errorResponse(status: number, body: BodyInit | null = null): Response {
  return new Response(body, {
    status,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
  });
}

describe('buildEnrichmentRequest', () => {
  test('projects only missing enrichment targets into the server contract', () => {
    const request = buildEnrichmentRequest(
      [
        lead('missing-both'),
        lead('website-only', { website: 'https://example.com' }),
        lead('complete', {
          website: 'https://complete.example',
          socialLinks: { instagram: 'https://instagram.com/complete' },
        }),
      ],
      ' London ',
      'GB'
    );

    expect(request).toEqual({
      leads: [
        {
          businessId: 'missing-both',
          name: 'missing-both',
          needsWebsite: true,
          needsSocials: true,
        },
        {
          businessId: 'website-only',
          name: 'website-only',
          needsWebsite: false,
          needsSocials: true,
        },
      ],
      city: ' London ',
      country: 'GB',
    });
  });
});

describe('streamEnrichment NDJSON parsing', () => {
  test('emits multiple rows from one chunk and rows split across chunks', async () => {
    const rows: EnrichmentStreamRow[] = [];
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        responseFromChunks([
          '{"businessId":"cached","status":"cached","website":"https://cached.example"}\n' +
            '{"businessId":"ok","status":"ok","socials":{"instagram":"https://instagram.com/ok"}}\n' +
            '{"businessId":"rate","status":"rate_',
          'limited","resetIn":1000}\n{"businessId":"error","status":"error","error":"boom"}\n',
        ])
      );

    const outcome = await streamEnrichment(
      {
        leads: [{ businessId: 'cached', name: 'Cached', needsWebsite: true, needsSocials: true }],
        city: 'London',
        country: 'GB',
      },
      { fetch: fetcher, onRow: (row) => rows.push(row) }
    );

    expect(outcome).toEqual({ type: 'complete' });
    expect(rows.map((row) => row.status)).toEqual(['cached', 'ok', 'rate_limited', 'error']);
    expect(rows[0]).toMatchObject({ businessId: 'cached', website: 'https://cached.example' });
    expect(rows[1]).toMatchObject({
      businessId: 'ok',
      socials: { instagram: 'https://instagram.com/ok' },
    });
  });

  test('ignores blank and malformed lines and flushes a final row without a newline', async () => {
    const rows: EnrichmentStreamRow[] = [];
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        responseFromChunks([
          '\nnot-json\n   \n{"businessId":"first","status":"ok"}\n',
          '{"businessId":"tail","status":"cached"}',
        ])
      );

    const outcome = await streamEnrichment(
      { leads: [], city: 'London', country: 'GB' },
      { fetch: fetcher, onRow: (row) => rows.push(row) }
    );

    expect(outcome).toEqual({ type: 'complete' });
    expect(rows).toEqual([
      { businessId: 'first', status: 'ok' },
      { businessId: 'tail', status: 'cached' },
    ]);
  });

  test('posts the local server request contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(responseFromChunks([]));
    const request = {
      leads: [{ businessId: 'one', name: 'One', needsWebsite: true, needsSocials: false }],
      city: 'London',
      country: 'GB',
    };

    await streamEnrichment(request, { fetch: fetcher, onRow: vi.fn() });

    expect(fetcher).toHaveBeenCalledWith('/api/business/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: undefined,
    });
  });
});

describe('streamEnrichment failures', () => {
  test.each([
    [
      401,
      { error: 'Unauthorized' },
      'session_expired',
      'Your session expired. Log in again to keep enriching leads.',
    ],
    [429, { error: 'Slow down' }, 'rate_limited', 'Rate-limited — wait a moment before retrying.'],
    [500, { error: 'Provider failed' }, 'server_error', 'Enrichment failed (500): Provider failed'],
  ] as const)('classifies HTTP %s responses', async (status, body, kind, message) => {
    const outcome = await streamEnrichment(
      { leads: [], city: 'London', country: 'GB' },
      {
        fetch: vi.fn().mockResolvedValue(errorResponse(status, JSON.stringify(body))),
        onRow: vi.fn(),
      }
    );

    expect(outcome).toEqual({
      type: 'failure',
      failure: { kind, message, status },
    });
  });

  test('tolerates a non-JSON server error body', async () => {
    const outcome = await streamEnrichment(
      { leads: [], city: 'London', country: 'GB' },
      {
        fetch: vi.fn().mockResolvedValue(errorResponse(500, 'bad gateway')),
        onRow: vi.fn(),
      }
    );

    expect(outcome).toEqual({
      type: 'failure',
      failure: { kind: 'server_error', message: 'Enrichment failed (500)', status: 500 },
    });
  });

  test('classifies network failures and treats fetch aborts as cancellation', async () => {
    const network = await streamEnrichment(
      { leads: [], city: 'London', country: 'GB' },
      { fetch: vi.fn().mockRejectedValue(new TypeError('offline')), onRow: vi.fn() }
    );
    const aborted = await streamEnrichment(
      { leads: [], city: 'London', country: 'GB' },
      {
        fetch: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
        onRow: vi.fn(),
      }
    );

    expect(network).toEqual({
      type: 'failure',
      failure: {
        kind: 'network',
        message: "Couldn't reach enrichment service — check your connection",
      },
    });
    expect(aborted).toEqual({ type: 'aborted' });
  });

  test('classifies a dropped response stream and treats read aborts as cancellation', async () => {
    const droppedResponse = {
      ok: true,
      body: {
        getReader: () => ({ read: vi.fn().mockRejectedValue(new Error('socket dropped')) }),
      },
    } as unknown as Response;
    const abortedResponse = {
      ok: true,
      body: {
        getReader: () => ({
          read: vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')),
        }),
      },
    } as unknown as Response;

    const dropped = await streamEnrichment(
      { leads: [], city: 'London', country: 'GB' },
      { fetch: vi.fn().mockResolvedValue(droppedResponse), onRow: vi.fn() }
    );
    const aborted = await streamEnrichment(
      { leads: [], city: 'London', country: 'GB' },
      { fetch: vi.fn().mockResolvedValue(abortedResponse), onRow: vi.fn() }
    );

    expect(dropped).toEqual({
      type: 'failure',
      failure: {
        kind: 'stream_error',
        message: 'Enrichment stream dropped — click any lead to retry',
      },
    });
    expect(aborted).toEqual({ type: 'aborted' });
  });
});
