'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeLastSearchSync,
  decodeSearchCacheBrowserState,
  getLastSearch,
  getPendingLastSearch,
  markLastSearchPending,
  saveLastSearch,
  updateLastSearchEnrichment,
  type SearchCacheBrowserState,
} from '@/lib/search-cache';
import {
  comparePersistedSearchPayloads,
  decodePersistedSearchPayload,
  hasSameSearchSnapshotIdentity,
  parsePersistedSearchPayload,
  timestampToISOString,
  type PersistedSearchPayload,
  type SearchSnapshot,
} from './search-snapshot';

const LAST_SEARCH_ENDPOINT = '/api/business/last-search';
const RESUME_DISMISSED_KEY = 'lead-snatcher-resume-dismissed';
const MAX_CONSECUTIVE_PENDING_WRITES = 5;

export type SearchSessionPayload = PersistedSearchPayload & SearchCacheBrowserState;

export interface SearchResumeCardData {
  businessType: SearchSnapshot['businessType'];
  city: string;
  country: string;
  resultCount: number;
  updatedAt: string;
  payload: SearchSessionPayload;
}

interface SearchSessionCache {
  get: typeof getLastSearch;
  save: typeof saveLastSearch;
  updateEnrichment: typeof updateLastSearchEnrichment;
  getPending: typeof getPendingLastSearch;
  markPending: typeof markLastSearchPending;
  acknowledge: typeof acknowledgeLastSearchSync;
}

interface SearchSessionClientDependencies {
  fetch?: typeof fetch;
  cache?: SearchSessionCache;
  sessionStorage?: Storage;
}

export interface SearchSessionClient {
  readLocalResume(): SearchResumeCardData | null;
  reconcileServerResume(): Promise<SearchResumeCardData | null>;
  isResumeDismissed(payload: PersistedSearchPayload): boolean;
  dismissResume(payload: PersistedSearchPayload): void;
  replaceSession(
    payload: SearchSessionPayload,
    replace: (payload: SearchSessionPayload) => void
  ): void;
  loadSavedSession(
    payload: PersistedSearchPayload,
    replace: (payload: SearchSessionPayload) => void
  ): void;
  persistSearch(payload: SearchSnapshot): void;
  updateEnrichment(patch: SearchCacheBrowserState): void;
}

const defaultCache: SearchSessionCache = {
  get: getLastSearch,
  save: saveLastSearch,
  updateEnrichment: updateLastSearchEnrichment,
  getPending: getPendingLastSearch,
  markPending: markLastSearchPending,
  acknowledge: acknowledgeLastSearchSync,
};

function toResumeCard(payload: SearchSessionPayload): SearchResumeCardData | null {
  const updatedAt = timestampToISOString(payload.timestamp);
  if (!updatedAt) return null;

  return {
    businessType: payload.businessType,
    city: payload.city,
    country: payload.country,
    resultCount: payload.results.length,
    updatedAt,
    payload,
  };
}

function durableSnapshot(payload: SearchSessionPayload): PersistedSearchPayload | null {
  return decodePersistedSearchPayload(payload);
}

function browserStateForMatchingSnapshot(
  accepted: PersistedSearchPayload,
  local: SearchSessionPayload | null
): SearchCacheBrowserState {
  const localSnapshot = local ? durableSnapshot(local) : null;
  if (!localSnapshot || !hasSameSearchSnapshotIdentity(accepted, localSnapshot)) return {};
  return decodeSearchCacheBrowserState(local);
}

function decodeServerResponse(value: unknown): PersistedSearchPayload | null {
  if (!value || typeof value !== 'object' || !('data' in value)) return null;
  const data = (value as { data?: unknown }).data;
  return data ? decodePersistedSearchPayload(data) : null;
}

export function createSearchSessionClient(
  dependencies: SearchSessionClientDependencies = {}
): SearchSessionClient {
  const cache = dependencies.cache ?? defaultCache;
  const fetcher = dependencies.fetch ?? fetch;
  const getTabStorage = () => {
    if (dependencies.sessionStorage) return dependencies.sessionStorage;
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  };

  const acceptServerSnapshot = (accepted: PersistedSearchPayload): SearchSessionPayload => {
    const local = cache.get();
    const localSnapshot = local ? durableSnapshot(local) : null;
    cache.acknowledge(accepted);

    if (!local || !localSnapshot) {
      cache.save(accepted);
      return accepted;
    }

    const order = comparePersistedSearchPayloads(accepted, localSnapshot);
    if (order < 0) {
      cache.markPending(localSnapshot);
      return local;
    }
    if (order === 0) return local;

    const reconciled = {
      ...accepted,
      ...browserStateForMatchingSnapshot(accepted, local),
    };
    cache.save(reconciled);
    return reconciled;
  };

  const postSnapshot = async (snapshot: PersistedSearchPayload) => {
    try {
      const response = await fetcher(LAST_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      if (!response.ok) return null;
      return decodeServerResponse(await response.json());
    } catch {
      return null;
    }
  };

  const flushPendingWrite = async (): Promise<SearchSessionPayload | null> => {
    let lastReconciled: SearchSessionPayload | null = null;

    for (let attempt = 0; attempt < MAX_CONSECUTIVE_PENDING_WRITES; attempt += 1) {
      const pending = cache.getPending();
      if (!pending) return lastReconciled;

      const accepted = await postSnapshot(pending);
      if (!accepted) return lastReconciled;
      lastReconciled = acceptServerSnapshot(accepted);

      const nextPending = cache.getPending();
      if (
        nextPending &&
        hasSameSearchSnapshotIdentity(nextPending, pending) &&
        comparePersistedSearchPayloads(accepted, pending) < 0
      ) {
        return lastReconciled;
      }
    }

    return lastReconciled;
  };

  const queueDurableWrite = (payload: PersistedSearchPayload) => {
    cache.save(payload);
    cache.markPending(payload);
    void flushPendingWrite();
  };

  return {
    readLocalResume() {
      const cached = cache.get();
      return cached ? toResumeCard(cached) : null;
    },

    async reconcileServerResume() {
      const pendingResult = await flushPendingWrite();
      if (pendingResult && !cache.getPending()) return toResumeCard(pendingResult);

      let serverSnapshot: PersistedSearchPayload | null = null;
      let serverReachable = false;
      try {
        const response = await fetcher(LAST_SEARCH_ENDPOINT);
        if (response.ok) {
          serverReachable = true;
          serverSnapshot = decodeServerResponse(await response.json());
        }
      } catch {
        // The validated browser snapshot remains resumable while offline.
      }

      const local = cache.get();
      const localSnapshot = local ? durableSnapshot(local) : null;
      if (!serverReachable) return local ? toResumeCard(local) : null;

      if (!serverSnapshot) {
        if (!localSnapshot || !local) return null;
        cache.markPending(localSnapshot);
        const accepted = await flushPendingWrite();
        return toResumeCard(accepted ?? local);
      }

      if (!localSnapshot || !local) {
        return toResumeCard(acceptServerSnapshot(serverSnapshot));
      }

      const order = comparePersistedSearchPayloads(localSnapshot, serverSnapshot);
      if (order <= 0) {
        return toResumeCard(acceptServerSnapshot(serverSnapshot));
      }

      cache.markPending(localSnapshot);
      const accepted = await flushPendingWrite();
      return toResumeCard(accepted ?? local);
    },

    isResumeDismissed(payload) {
      const dismissedSnapshot = parsePersistedSearchPayload(
        getTabStorage()?.getItem(RESUME_DISMISSED_KEY) ?? ''
      );
      const currentSnapshot = decodePersistedSearchPayload(payload);
      return dismissedSnapshot && currentSnapshot
        ? hasSameSearchSnapshotIdentity(dismissedSnapshot, currentSnapshot)
        : false;
    },

    dismissResume(payload) {
      const canonicalPayload = decodePersistedSearchPayload(payload);
      if (!canonicalPayload) return;
      getTabStorage()?.setItem(RESUME_DISMISSED_KEY, JSON.stringify(canonicalPayload));
    },

    replaceSession(payload, replace) {
      cache.save(payload);
      replace(payload);
    },

    loadSavedSession(payload, replace) {
      const promoted = decodePersistedSearchPayload({ ...payload, timestamp: Date.now() });
      if (!promoted) return;
      queueDurableWrite(promoted);
      replace(promoted);
    },

    persistSearch(payload) {
      const persistedPayload = decodePersistedSearchPayload({ ...payload, timestamp: Date.now() });
      if (!persistedPayload) return;
      queueDurableWrite(persistedPayload);
    },

    updateEnrichment(patch) {
      cache.updateEnrichment(patch);
    },
  };
}

const browserSearchSessionClient = createSearchSessionClient();

interface UseSearchSessionPersistenceOptions {
  isSearchView: boolean;
  onReplaceSession: (payload: SearchSessionPayload) => void;
  onLocalResumeFound: () => void;
  client?: SearchSessionClient;
}

export function useSearchSessionPersistence({
  isSearchView,
  onReplaceSession,
  onLocalResumeFound,
  client = browserSearchSessionClient,
}: UseSearchSessionPersistenceOptions) {
  const [resumeCard, setResumeCard] = useState<SearchResumeCardData | null>(null);
  useEffect(() => {
    const localResume = client.readLocalResume();
    if (!localResume) return;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      onLocalResumeFound();
      setResumeCard(localResume);
    });

    return () => {
      cancelled = true;
    };
  }, [client, onLocalResumeFound]);

  useEffect(() => {
    if (!isSearchView) return;
    let cancelled = false;

    void client.reconcileServerResume().then((reconciledResume) => {
      if (!cancelled && reconciledResume) setResumeCard(reconciledResume);
    });

    return () => {
      cancelled = true;
    };
  }, [client, isSearchView]);

  const resumeDismissed = resumeCard ? client.isResumeDismissed(resumeCard.payload) : false;

  const replaceSession = useCallback(
    (payload: SearchSessionPayload) => {
      client.replaceSession(payload, onReplaceSession);
      setResumeCard(null);
    },
    [client, onReplaceSession]
  );

  const resumeLastSearch = useCallback(() => {
    if (resumeCard) replaceSession(resumeCard.payload);
  }, [replaceSession, resumeCard]);

  const loadSavedSession = useCallback(
    (payload: PersistedSearchPayload) => {
      client.loadSavedSession(payload, onReplaceSession);
      setResumeCard(null);
    },
    [client, onReplaceSession]
  );

  const dismissResume = useCallback(() => {
    if (!resumeCard) return;
    client.dismissResume(resumeCard.payload);
    setResumeCard(null);
  }, [client, resumeCard]);

  const persistSearch = useCallback(
    (payload: SearchSnapshot) => client.persistSearch(payload),
    [client]
  );

  const persistEnrichment = useCallback(
    (patch: SearchCacheBrowserState) => client.updateEnrichment(patch),
    [client]
  );

  return {
    resumeCard,
    resumeDismissed,
    resumeLastSearch,
    loadSavedSession,
    dismissResume,
    persistSearch,
    persistEnrichment,
  };
}
