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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
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

  test('keeps a newer success when an older request resolves afterward', async () => {
    const initialRequest = deferred<Response>();
    const newerRequest = deferred<Response>();
    const newerTag = { ...catalogTag, leadCount: 2 };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(initialRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);
    const { result } = renderHook(() => useCrmTags(fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    let newerRefetch!: Promise<void>;
    act(() => {
      newerRefetch = result.current.refetch();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      newerRequest.resolve(jsonResponse({ tags: [newerTag] }));
      await newerRefetch;
    });
    expect(result.current).toMatchObject({ tags: [newerTag], loading: false, error: null });

    await act(async () => {
      initialRequest.resolve(jsonResponse({ tags: [catalogTag] }));
      await initialRequest.promise;
    });
    expect(result.current).toMatchObject({ tags: [newerTag], loading: false, error: null });
  });

  test('ignores an older request failure after a newer success', async () => {
    const initialRequest = deferred<Response>();
    const newerRequest = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(initialRequest.promise)
      .mockReturnValueOnce(newerRequest.promise);
    const { result } = renderHook(() => useCrmTags(fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    let newerRefetch!: Promise<void>;
    act(() => {
      newerRefetch = result.current.refetch();
    });

    await act(async () => {
      newerRequest.resolve(jsonResponse({ tags: [catalogTag] }));
      await newerRefetch;
    });
    expect(result.current).toMatchObject({ tags: [catalogTag], loading: false, error: null });

    await act(async () => {
      initialRequest.reject(new Error('Stale request failed'));
      await expect(initialRequest.promise).rejects.toThrow('Stale request failed');
    });
    expect(result.current).toMatchObject({ tags: [catalogTag], loading: false, error: null });
  });

  test('exposes a current response error and clears it after a successful retry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ tags: [catalogTag] }));
    const { result } = renderHook(() => useCrmTags(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tags).toEqual([]);
    expect(result.current.error).toEqual(
      new CrmTagsResponseError('CRM tags response is malformed')
    );

    await act(async () => result.current.refetch());

    expect(result.current).toMatchObject({ tags: [catalogTag], loading: false, error: null });
  });
});
