'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TagsResponse, TagWithCount } from '@/types';

const TAGS_ENDPOINT = '/api/tags';

export class CrmTagsRequestError extends Error {
  constructor(public readonly status: number) {
    super(`Failed to load CRM tags (${status})`);
    this.name = 'CrmTagsRequestError';
  }
}

export class CrmTagsResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrmTagsResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTagWithCount(value: unknown): value is TagWithCount {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.color === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.leadCount === 'number' &&
    Number.isInteger(value.leadCount) &&
    value.leadCount >= 0
  );
}

function parseTagsResponse(value: unknown): TagsResponse {
  if (!isRecord(value) || !Array.isArray(value.tags) || !value.tags.every(isTagWithCount)) {
    throw new CrmTagsResponseError('CRM tags response is malformed');
  }

  return { tags: value.tags };
}

export async function fetchCrmTags(fetcher: typeof fetch = fetch): Promise<TagsResponse> {
  const response = await fetcher(TAGS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new CrmTagsRequestError(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CrmTagsResponseError('CRM tags response is not valid JSON');
  }

  return parseTagsResponse(body);
}

export interface CrmTagsResource {
  tags: TagWithCount[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useCrmTags(fetcher: typeof fetch = fetch): CrmTagsResource {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestVersion = useRef(0);

  const refetch = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const response = await fetchCrmTags(fetcher);
      if (version === requestVersion.current) {
        setTags(response.tags);
      }
    } catch (caughtError) {
      if (version === requestVersion.current) {
        setError(caughtError instanceof Error ? caughtError : new Error('Failed to load CRM tags'));
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [fetcher]);

  useEffect(() => {
    void refetch();

    return () => {
      requestVersion.current += 1;
    };
  }, [refetch]);

  return { tags, loading, error, refetch };
}
