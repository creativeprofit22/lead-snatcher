'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiErrorResponseSchema,
  apiKeySettingsDeleteSuccessSchema,
  apiKeySettingsGetResponseSchema,
  apiKeySettingsPostSuccessSchema,
  type ApiKeySettingsDeleteSuccess,
  type ApiKeySettingsGetResponse,
  type ApiKeySettingsItem,
  type ApiKeySettingsPostSuccess,
} from '@/lib/api-key-settings-contract';
import type { ApiKeyService } from '@/lib/api-key-services';

const SETTINGS_ENDPOINT = '/api/settings';

export class ApiKeySettingsRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiKeySettingsRequestError';
  }
}

export class ApiKeySettingsResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeySettingsResponseError';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function parseErrorResponse(response: Response, fallbackMessage: string): Promise<Error> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return new ApiKeySettingsRequestError(fallbackMessage, response.status);
  }

  const parsed = apiErrorResponseSchema.safeParse(body);
  return new ApiKeySettingsRequestError(
    parsed.success ? parsed.data.error : fallbackMessage,
    response.status
  );
}

async function parseSuccessResponse<T>(
  response: Response,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  malformedMessage: string
): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new ApiKeySettingsResponseError(malformedMessage);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiKeySettingsResponseError(malformedMessage);
  }

  return parsed.data;
}

function safeOperationError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof ApiKeySettingsRequestError || error instanceof ApiKeySettingsResponseError) {
    return error;
  }

  return new Error(fallbackMessage);
}

export async function fetchApiKeySettings(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<ApiKeySettingsGetResponse> {
  const response = await fetcher(SETTINGS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to load API key settings');
  }

  return parseSuccessResponse(
    response,
    apiKeySettingsGetResponseSchema,
    'API key settings response is malformed'
  );
}

async function postApiKey(
  service: ApiKeyService,
  key: string,
  fetcher: typeof fetch
): Promise<ApiKeySettingsPostSuccess> {
  const response = await fetcher(SETTINGS_ENDPOINT, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, key }),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to save key');
  }

  return parseSuccessResponse(
    response,
    apiKeySettingsPostSuccessSchema,
    'Save key response is malformed'
  );
}

async function removeApiKey(
  service: ApiKeyService,
  fetcher: typeof fetch
): Promise<ApiKeySettingsDeleteSuccess> {
  const response = await fetcher(`${SETTINGS_ENDPOINT}?service=${encodeURIComponent(service)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to remove key');
  }

  return parseSuccessResponse(
    response,
    apiKeySettingsDeleteSuccessSchema,
    'Remove key response is malformed'
  );
}

function replaceService(
  current: ApiKeySettingsGetResponse,
  replacement: ApiKeySettingsItem
): ApiKeySettingsGetResponse {
  const existingIndex = current.findIndex(({ service }) => service === replacement.service);
  if (existingIndex === -1) return [...current, replacement];

  return current.map((item, index) => (index === existingIndex ? replacement : item));
}

export interface ApiKeySettingsResource {
  apiKeys: ApiKeySettingsGetResponse;
  isLoading: boolean;
  loadError: Error | null;
  savingService: ApiKeyService | null;
  deletingService: ApiKeyService | null;
  retry: () => Promise<void>;
  saveApiKey: (service: ApiKeyService, key: string) => Promise<ApiKeySettingsPostSuccess>;
  deleteApiKey: (service: ApiKeyService) => Promise<ApiKeySettingsDeleteSuccess>;
}

export function useApiKeySettings(
  enabled: boolean,
  fetcher: typeof fetch = fetch
): ApiKeySettingsResource {
  const [apiKeys, setApiKeys] = useState<ApiKeySettingsGetResponse>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [savingService, setSavingService] = useState<ApiKeyService | null>(null);
  const [deletingService, setDeletingService] = useState<ApiKeyService | null>(null);
  const requestVersion = useRef(0);
  const loadController = useRef<AbortController | null>(null);
  const previousEnabled = useRef(false);

  const invalidateLoad = useCallback(() => {
    requestVersion.current += 1;
    loadController.current?.abort();
    loadController.current = null;
  }, []);

  const retry = useCallback(async () => {
    if (!enabled) return;

    const version = ++requestVersion.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetchApiKeySettings(fetcher, controller.signal);
      if (version === requestVersion.current) {
        setApiKeys(response);
      }
    } catch (error) {
      if (version === requestVersion.current && !isAbortError(error)) {
        setLoadError(safeOperationError(error, 'Failed to load API key settings'));
      }
    } finally {
      if (version === requestVersion.current) {
        loadController.current = null;
        setLoading(false);
      }
    }
  }, [enabled, fetcher]);

  useEffect(() => {
    previousEnabled.current = enabled;

    if (enabled) {
      void retry();
    } else {
      invalidateLoad();
      setLoading(false);
    }

    return invalidateLoad;
  }, [enabled, invalidateLoad, retry]);

  const saveApiKey = useCallback(
    async (service: ApiKeyService, key: string) => {
      setSavingService(service);

      try {
        const response = await postApiKey(service, key, fetcher);
        invalidateLoad();
        setLoading(false);
        setLoadError(null);
        setApiKeys((current) =>
          replaceService(current, {
            service: response.service,
            maskedKey: response.maskedKey,
            hasKey: true,
          })
        );
        return response;
      } catch (error) {
        throw safeOperationError(error, 'Failed to save key');
      } finally {
        setSavingService((current) => (current === service ? null : current));
      }
    },
    [fetcher, invalidateLoad]
  );

  const deleteApiKey = useCallback(
    async (service: ApiKeyService) => {
      setDeletingService(service);

      try {
        const response = await removeApiKey(service, fetcher);
        invalidateLoad();
        setLoading(false);
        setLoadError(null);
        setApiKeys((current) =>
          replaceService(current, { service, maskedKey: null, hasKey: false })
        );
        return response;
      } catch (error) {
        throw safeOperationError(error, 'Failed to remove key');
      } finally {
        setDeletingService((current) => (current === service ? null : current));
      }
    },
    [fetcher, invalidateLoad]
  );

  return {
    apiKeys,
    isLoading: enabled && (loading || !previousEnabled.current),
    loadError,
    savingService,
    deletingService,
    retry,
    saveApiKey,
    deleteApiKey,
  };
}
