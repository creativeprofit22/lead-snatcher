'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getLastSearch,
  saveLastSearch,
  updateLastSearchEnrichment,
  type SearchCacheBrowserState,
} from '@/lib/search-cache';
import type { PersistedSearchPayload, SearchSnapshot } from './search-snapshot';

const LAST_SEARCH_ENDPOINT = '/api/business/last-search';
const RESUME_DISMISSED_KEY = 'lead-snatcher-resume-dismissed';

export type SearchSessionPayload = SearchSnapshot & SearchCacheBrowserState;

export interface SearchResumeCardData {
  industry: SearchSnapshot['industry'];
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
}

interface SearchSessionClientDependencies {
  fetch?: typeof fetch;
  cache?: SearchSessionCache;
  sessionStorage?: Storage;
}

export interface SearchSessionClient {
  readLocalResume(): SearchResumeCardData | null;
  fetchServerResumeIfLocalMissing(): Promise<SearchResumeCardData | null>;
  isResumeDismissed(): boolean;
  dismissResume(): void;
  applySnapshot(
    payload: SearchSessionPayload,
    hydrate: (payload: SearchSessionPayload) => void
  ): void;
  persistSearch(payload: SearchSnapshot): void;
  updateEnrichment(patch: SearchCacheBrowserState): void;
}

const defaultCache: SearchSessionCache = {
  get: getLastSearch,
  save: saveLastSearch,
  updateEnrichment: updateLastSearchEnrichment,
};

function toResumeCard(payload: SearchSessionPayload, updatedAt: string): SearchResumeCardData {
  return {
    industry: payload.industry,
    city: payload.city,
    country: payload.country,
    resultCount: payload.results.length,
    updatedAt,
    payload,
  };
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

  return {
    readLocalResume() {
      const cached = cache.get();
      if (!cached) return null;
      return toResumeCard(cached, new Date(cached.timestamp).toISOString());
    },

    async fetchServerResumeIfLocalMissing() {
      if (cache.get()) return null;

      try {
        const response = await fetcher(LAST_SEARCH_ENDPOINT);
        if (!response.ok) return null;
        const { data } = (await response.json()) as {
          data: (PersistedSearchPayload & { updatedAt: string }) | null;
        };
        if (!data) return null;
        return toResumeCard(data, data.updatedAt);
      } catch {
        return null;
      }
    },

    isResumeDismissed() {
      return getTabStorage()?.getItem(RESUME_DISMISSED_KEY) === '1';
    },

    dismissResume() {
      getTabStorage()?.setItem(RESUME_DISMISSED_KEY, '1');
    },

    applySnapshot(payload, hydrate) {
      cache.save(payload);
      hydrate(payload);
    },

    persistSearch(payload) {
      cache.save(payload);
      try {
        void fetcher(LAST_SEARCH_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      } catch {
        // Local persistence is authoritative for this tab; server sync is best effort.
      }
    },

    updateEnrichment(patch) {
      cache.updateEnrichment(patch);
    },
  };
}

const browserSearchSessionClient = createSearchSessionClient();

interface UseSearchSessionPersistenceOptions {
  isSearchView: boolean;
  onHydrate: (payload: SearchSessionPayload) => void;
  onLocalResumeFound: () => void;
  client?: SearchSessionClient;
}

export function useSearchSessionPersistence({
  isSearchView,
  onHydrate,
  onLocalResumeFound,
  client = browserSearchSessionClient,
}: UseSearchSessionPersistenceOptions) {
  const [resumeCard, setResumeCard] = useState<SearchResumeCardData | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(() => client.isResumeDismissed());
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

    void client.fetchServerResumeIfLocalMissing().then((serverResume) => {
      if (!cancelled && serverResume) setResumeCard(serverResume);
    });

    return () => {
      cancelled = true;
    };
  }, [client, isSearchView]);

  const applySnapshot = useCallback(
    (payload: SearchSessionPayload) => {
      client.applySnapshot(payload, onHydrate);
      setResumeCard(null);
    },
    [client, onHydrate]
  );

  const resumeLastSearch = useCallback(() => {
    if (resumeCard) applySnapshot(resumeCard.payload);
  }, [applySnapshot, resumeCard]);

  const dismissResume = useCallback(() => {
    client.dismissResume();
    setResumeDismissed(true);
    setResumeCard(null);
  }, [client]);

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
    loadSavedSession: applySnapshot,
    dismissResume,
    persistSearch,
    persistEnrichment,
  };
}
