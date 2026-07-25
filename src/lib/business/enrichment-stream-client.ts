import type { DiscoveredSocials } from '@/lib/business/enrichment';
import { previewEnrichment } from '@/lib/business/enrichment-preview';
import type { BusinessSearchResult } from '@/types';

const ENRICHMENT_ENDPOINT = '/api/business/enrich';

export interface EnrichmentRequestLead {
  businessId: string;
  name: string;
  needsWebsite: boolean;
  needsSocials: boolean;
}

export interface EnrichmentStreamRequest {
  leads: EnrichmentRequestLead[];
  city: string;
  country: string;
}

export interface EnrichmentStreamRow {
  businessId: string;
  status: 'ok' | 'cached' | 'rate_limited' | 'error';
  website?: string;
  socials?: DiscoveredSocials;
  error?: string;
  resetIn?: number;
}

export interface EnrichmentTransportFailure {
  kind: 'session_expired' | 'rate_limited' | 'server_error' | 'network' | 'stream_error';
  message: string;
  status?: number;
}

export type EnrichmentStreamOutcome =
  | { type: 'complete' }
  | { type: 'aborted' }
  | { type: 'failure'; failure: EnrichmentTransportFailure };

interface StreamEnrichmentOptions {
  signal?: AbortSignal;
  onRow: (row: EnrichmentStreamRow) => void;
  fetch?: typeof fetch;
}

export function buildEnrichmentRequest(
  leads: BusinessSearchResult[],
  city: string,
  country: string
): EnrichmentStreamRequest {
  return {
    leads: leads.flatMap((lead) => {
      const preview = previewEnrichment(lead);
      if (preview.alreadyEnriched) return [];
      return [
        {
          businessId: lead.placeId,
          name: lead.name,
          needsWebsite: preview.willFind.includes('website'),
          needsSocials: preview.willFind.includes('socials'),
        },
      ];
    }),
    city,
    country,
  };
}

export async function streamEnrichment(
  request: EnrichmentStreamRequest,
  options: StreamEnrichmentOptions
): Promise<EnrichmentStreamOutcome> {
  const fetcher = options.fetch ?? fetch;
  let response: Response;

  try {
    response = await fetcher(ENRICHMENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) return { type: 'aborted' };
    return {
      type: 'failure',
      failure: {
        kind: 'network',
        message: "Couldn't reach enrichment service — check your connection",
      },
    };
  }

  if (!response.ok || !response.body) {
    return { type: 'failure', failure: await classifyHttpFailure(response) };
  }

  try {
    await consumeNdjson(response.body, options.onRow);
    return { type: 'complete' };
  } catch (error) {
    if (isAbortError(error)) return { type: 'aborted' };
    return {
      type: 'failure',
      failure: {
        kind: 'stream_error',
        message: 'Enrichment stream dropped — click any lead to retry',
      },
    };
  }
}

async function classifyHttpFailure(response: Response): Promise<EnrichmentTransportFailure> {
  if (response.status === 401) {
    return {
      kind: 'session_expired',
      message: 'Your session expired. Log in again to keep enriching leads.',
      status: 401,
    };
  }

  if (response.status === 429) {
    return {
      kind: 'rate_limited',
      message: 'Rate-limited — wait a moment before retrying.',
      status: 429,
    };
  }

  let serverMessage = '';
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    if (typeof body.error === 'string') serverMessage = `: ${body.error}`;
  } catch {
    // The endpoint normally returns JSON, but status classification does not depend on it.
  }

  return {
    kind: 'server_error',
    message: `Enrichment failed (${response.status})${serverMessage}`,
    status: response.status,
  };
}

async function consumeNdjson(
  stream: ReadableStream<Uint8Array>,
  onRow: (row: EnrichmentStreamRow) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      emitLine(buffer.slice(0, newlineIndex), onRow);
      buffer = buffer.slice(newlineIndex + 1);
    }
  }

  emitLine(buffer, onRow);
}

function emitLine(line: string, onRow: (row: EnrichmentStreamRow) => void): void {
  const trimmedLine = line.trim();
  if (!trimmedLine) return;

  try {
    onRow(JSON.parse(trimmedLine) as EnrichmentStreamRow);
  } catch {
    // Preserve the existing tolerant protocol: malformed rows do not stop later rows.
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}
