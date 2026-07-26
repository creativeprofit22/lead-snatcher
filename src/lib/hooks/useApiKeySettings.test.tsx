import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ApiKeySettingsGetResponse } from '@/lib/api-key-settings-contract';
import {
  ApiKeySettingsRequestError,
  ApiKeySettingsResponseError,
  useApiKeySettings,
} from './useApiKeySettings';

const emptySettings: ApiKeySettingsGetResponse = [
  { service: 'rapidapi', maskedKey: null, hasKey: false },
  { service: 'pagespeed', maskedKey: null, hasKey: false },
];

const configuredSettings: ApiKeySettingsGetResponse = [
  { service: 'rapidapi', maskedKey: 'abcd••••wxyz', hasKey: true },
  { service: 'pagespeed', maskedKey: null, hasKey: false },
];

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

function methodOf(init?: RequestInit): string {
  return init?.method ?? 'GET';
}

afterEach(() => cleanup());

describe('API key settings load lifecycle', () => {
  test('keeps a new-open response when the old-open request resolves later', async () => {
    const oldOpen = deferred<Response>();
    const newOpen = deferred<Response>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(oldOpen.promise)
      .mockReturnValueOnce(newOpen.promise);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useApiKeySettings(enabled, fetcher),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const oldSignal = fetcher.mock.calls[0]?.[1]?.signal;
    rerender({ enabled: false });
    expect(oldSignal?.aborted).toBe(true);
    rerender({ enabled: true });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    await act(async () => {
      newOpen.resolve(jsonResponse(configuredSettings));
      await newOpen.promise;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apiKeys).toEqual(configuredSettings);

    await act(async () => {
      oldOpen.resolve(jsonResponse(emptySettings));
      await oldOpen.promise;
    });
    expect(result.current.apiKeys).toEqual(configuredSettings);
  });

  test('invalidates a pending load when closed', async () => {
    const pendingLoad = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(pendingLoad.promise);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useApiKeySettings(enabled, fetcher),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const signal = fetcher.mock.calls[0]?.[1]?.signal;
    rerender({ enabled: false });
    expect(signal?.aborted).toBe(true);
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      pendingLoad.resolve(jsonResponse(configuredSettings));
      await pendingLoad.promise;
    });
    expect(result.current.apiKeys).toEqual([]);
    expect(result.current.loadError).toBeNull();
  });

  test('keeps a completed save when the stale initial GET resolves afterward', async () => {
    const initialLoad = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (methodOf(init) === 'POST') {
        return jsonResponse({
          success: true,
          service: 'rapidapi',
          maskedKey: 'new••••key',
        });
      }
      return initialLoad.promise;
    });
    const { result } = renderHook(() => useApiKeySettings(true, fetcher));

    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await act(async () => {
      await result.current.saveApiKey('rapidapi', 'new-secret-key');
    });
    expect(result.current.apiKeys).toEqual([
      { service: 'rapidapi', maskedKey: 'new••••key', hasKey: true },
    ]);
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      initialLoad.resolve(jsonResponse(emptySettings));
      await initialLoad.promise;
    });
    expect(result.current.apiKeys).toEqual([
      { service: 'rapidapi', maskedKey: 'new••••key', hasKey: true },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test.each([
    [401, 'Unauthorized'],
    [500, 'Failed to fetch API keys'],
  ])('exposes GET %s errors and clears them after retry', async (status, message) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: message }, status))
      .mockResolvedValueOnce(jsonResponse(configuredSettings));
    const { result } = renderHook(() => useApiKeySettings(true, fetcher));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.apiKeys).toEqual([]);
    expect(result.current.loadError).toBeInstanceOf(ApiKeySettingsRequestError);
    expect(result.current.loadError).toMatchObject({ message, status });

    await act(async () => result.current.retry());

    expect(result.current).toMatchObject({
      apiKeys: configuredSettings,
      isLoading: false,
      loadError: null,
    });
  });
});

describe('API key settings mutations', () => {
  test.each([
    [400, 'API key is required'],
    [401, 'Session invalid. Please log out and log in again.'],
  ])('preserves settings and exposes a POST %s message', async (status, message) => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (methodOf(init) === 'POST') return jsonResponse({ error: message }, status);
      return jsonResponse(configuredSettings);
    });
    const { result } = renderHook(() => useApiKeySettings(true, fetcher));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.saveApiKey('rapidapi', 'replacement')).rejects.toMatchObject({
        message,
        status,
      });
    });

    expect(result.current.apiKeys).toEqual(configuredSettings);
    expect(result.current.savingService).toBeNull();
  });

  test('preserves settings and exposes a DELETE 404 message', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (methodOf(init) === 'DELETE') {
        return jsonResponse({ error: 'API key not found' }, 404);
      }
      return jsonResponse(configuredSettings);
    });
    const { result } = renderHook(() => useApiKeySettings(true, fetcher));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteApiKey('rapidapi')).rejects.toMatchObject({
        message: 'API key not found',
        status: 404,
      });
    });

    expect(result.current.apiKeys).toEqual(configuredSettings);
    expect(result.current.deletingService).toBeNull();
  });

  test.each([
    [
      'POST',
      { success: true, service: 'rapidapi' },
      (resource: ReturnType<typeof useApiKeySettings>) =>
        resource.saveApiKey('rapidapi', 'replacement'),
      'Save key response is malformed',
    ],
    [
      'DELETE',
      { success: false },
      (resource: ReturnType<typeof useApiKeySettings>) => resource.deleteApiKey('rapidapi'),
      'Remove key response is malformed',
    ],
  ])(
    'rejects malformed %s success JSON without changing settings',
    async (method, malformedBody, mutate, message) => {
      const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
        if (methodOf(init) === method) return jsonResponse(malformedBody);
        return jsonResponse(configuredSettings);
      });
      const { result } = renderHook(() => useApiKeySettings(true, fetcher));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await expect(mutate(result.current)).rejects.toEqual(
          new ApiKeySettingsResponseError(message)
        );
      });

      expect(result.current.apiKeys).toEqual(configuredSettings);
    }
  );

  test('updates save and delete state locally without follow-up GETs', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (methodOf(init) === 'POST') {
        return jsonResponse({
          success: true,
          service: 'rapidapi',
          maskedKey: 'next••••key',
        });
      }
      if (methodOf(init) === 'DELETE') return jsonResponse({ success: true });
      return jsonResponse(emptySettings);
    });
    const { result } = renderHook(() => useApiKeySettings(true, fetcher));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.saveApiKey('rapidapi', 'next-secret-key');
    });
    expect(result.current.apiKeys[0]).toEqual({
      service: 'rapidapi',
      maskedKey: 'next••••key',
      hasKey: true,
    });

    await act(async () => {
      await result.current.deleteApiKey('rapidapi');
    });
    expect(result.current.apiKeys[0]).toEqual({
      service: 'rapidapi',
      maskedKey: null,
      hasKey: false,
    });
    expect(fetcher.mock.calls.map(([, init]) => methodOf(init))).toEqual(['GET', 'POST', 'DELETE']);
  });
});
