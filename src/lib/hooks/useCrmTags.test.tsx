import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { TagWithCount } from '@/types';
import { CrmTagsRequestError, CrmTagsResponseError, fetchCrmTags, useCrmTags } from './useCrmTags';

const catalogTag: TagWithCount = {
  id: 'tag-1',
  name: 'Priority',
  color: '#3b82f6',
  createdAt: '2026-07-25T12:00:00.000Z',
  leadCount: 3,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => cleanup());

describe('CRM tags resource', () => {
  test('accepts a valid empty catalog without treating it as an error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ tags: [] }));

    await expect(fetchCrmTags(fetcher)).resolves.toEqual({ tags: [] });
    expect(fetcher).toHaveBeenCalledWith('/api/tags', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  });

  test.each([401, 500])('rejects an HTTP %s response with its status', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'Request failed' }, status));

    const request = fetchCrmTags(fetcher);

    await expect(request).rejects.toBeInstanceOf(CrmTagsRequestError);
    await expect(request).rejects.toMatchObject({ status });
  });

  test('rejects invalid JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(fetchCrmTags(fetcher)).rejects.toEqual(
      new CrmTagsResponseError('CRM tags response is not valid JSON')
    );
  });

  test('rejects an envelope with no tags field', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));

    await expect(fetchCrmTags(fetcher)).rejects.toEqual(
      new CrmTagsResponseError('CRM tags response is malformed')
    );
  });

  test('exposes loading, error, tags, and refetch from one resource', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ tags: [] }))
      .mockResolvedValueOnce(jsonResponse({ tags: [catalogTag] }));
    const { result } = renderHook(() => useCrmTags(fetcher));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ tags: [], error: null });

    await act(async () => result.current.refetch());

    expect(result.current).toMatchObject({ tags: [catalogTag], loading: false, error: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
