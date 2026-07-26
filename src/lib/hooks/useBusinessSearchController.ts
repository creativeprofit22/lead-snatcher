'use client';

import { useCallback, useReducer, useRef } from 'react';
import { toast } from 'sonner';
import {
  BusinessSearchError,
  runBusinessSearch,
  type AppliedBusinessSearch,
} from '@/lib/business/run-business-search';
import type { SearchMarketDensity, SearchSnapshot } from '@/lib/business/search-snapshot';
import type { Zone, ZoneBbox, ZoneScanStatus } from '@/lib/business/zone-contract';
import type { BusinessSearchResult, IndustryType } from '@/types';

export type SearchViewMode = 'search' | 'results';
export type SearchRadarPhase = 'off' | 'scanning' | 'revealing';

export interface SearchResultSnapshot {
  results: BusinessSearchResult[];
  marketDensity: SearchMarketDensity | null;
  zoneScanStatus: ZoneScanStatus | null;
  zones: Zone[];
  zoneBbox: ZoneBbox | null;
  singleZone: boolean;
  focusedZoneId: string | null;
  queryIdentity: Pick<SearchSnapshot, 'businessType' | 'industry' | 'city' | 'country'> | null;
}

export interface SearchBannerError {
  message: string;
  severity: 'error' | 'warning';
  isAuthError: boolean;
}

export interface SearchNotification {
  type: 'success' | 'info' | 'error';
  message: string;
  duration?: number;
}

export interface BusinessSearchQuery {
  businessType: string | null;
  cacheIndustry: IndustryType;
  city: string;
  country: string;
  deepAnalysis: boolean;
}

type PersistSearch = (snapshot: SearchSnapshot) => void;
type RunSearch = typeof runBusinessSearch;

interface BusinessSearchControllerOptions {
  query: BusinessSearchQuery;
  runSearch?: RunSearch;
  notify?: (notification: SearchNotification) => void;
}

interface ControllerState {
  viewMode: SearchViewMode;
  snapshot: SearchResultSnapshot;
  isSearching: boolean;
  radarPhase: SearchRadarPhase;
  rescanningZoneId: string | null;
  searchBannerError: SearchBannerError | null;
}

export type SearchSessionReplacementKind = 'loaded' | 'new-search';

type ControllerAction =
  | {
      type: 'replace-session';
      snapshot: SearchResultSnapshot;
      kind: SearchSessionReplacementKind;
    }
  | { type: 'initial-started' }
  | { type: 'initial-succeeded'; result: AppliedBusinessSearch }
  | { type: 'initial-failed'; error: BusinessSearchError }
  | { type: 'initial-settled' }
  | { type: 'zone-started'; zoneId: string }
  | { type: 'zone-succeeded'; result: AppliedBusinessSearch }
  | { type: 'zone-settled' }
  | { type: 'radar-completed' }
  | { type: 'reset' }
  | { type: 'banner-dismissed' };

export const EMPTY_SEARCH_RESULT_SNAPSHOT: SearchResultSnapshot = {
  results: [],
  marketDensity: null,
  zoneScanStatus: null,
  zones: [],
  zoneBbox: null,
  singleZone: false,
  focusedZoneId: null,
  queryIdentity: null,
};

const INITIAL_STATE: ControllerState = {
  viewMode: 'search',
  snapshot: EMPTY_SEARCH_RESULT_SNAPSHOT,
  isSearching: false,
  radarPhase: 'off',
  rescanningZoneId: null,
  searchBannerError: null,
};

function snapshotFromStoredSearch(snapshot: SearchSnapshot): SearchResultSnapshot {
  return {
    results: snapshot.results,
    marketDensity: snapshot.marketDensity ?? null,
    zoneScanStatus: snapshot.zoneScanStatus ?? snapshot.marketDensity?.status ?? null,
    zones: snapshot.zones ?? [],
    zoneBbox: snapshot.zoneBbox ?? null,
    singleZone: snapshot.singleZone ?? false,
    focusedZoneId: snapshot.focusedZoneId ?? null,
    queryIdentity: {
      businessType: snapshot.businessType,
      industry: snapshot.industry,
      city: snapshot.city,
      country: snapshot.country,
    },
  };
}

function snapshotFromSearchResult(result: AppliedBusinessSearch): SearchResultSnapshot {
  return {
    results: result.results,
    marketDensity: result.marketDensity,
    zoneScanStatus: result.zoneScanStatus,
    zones: result.zones,
    zoneBbox: result.zoneBbox,
    singleZone: result.singleZone,
    focusedZoneId: result.focusedZoneId,
    queryIdentity: {
      businessType: result.cachePayload.businessType,
      industry: result.cachePayload.industry,
      city: result.cachePayload.city,
      country: result.cachePayload.country,
    },
  };
}

function controllerReducer(state: ControllerState, action: ControllerAction): ControllerState {
  switch (action.type) {
    case 'replace-session':
      return {
        ...state,
        viewMode: action.kind === 'loaded' ? 'results' : 'search',
        snapshot: action.snapshot,
        isSearching: false,
        radarPhase: action.kind === 'new-search' ? 'revealing' : 'off',
        rescanningZoneId: null,
        searchBannerError: null,
      };
    case 'initial-started':
      return {
        ...state,
        isSearching: true,
        radarPhase: 'scanning',
        searchBannerError: null,
      };
    case 'initial-succeeded':
      return {
        ...state,
        snapshot: snapshotFromSearchResult(action.result),
        radarPhase: action.result.shouldReveal ? 'revealing' : 'off',
        searchBannerError:
          action.result.notification.type === 'error'
            ? {
                message: action.result.notification.message,
                severity: 'error',
                isAuthError: false,
              }
            : null,
      };
    case 'initial-failed':
      return {
        ...state,
        radarPhase: 'off',
        searchBannerError: {
          message: action.error.message,
          severity: 'error',
          isAuthError: action.error.status === 401,
        },
      };
    case 'initial-settled':
      return { ...state, isSearching: false };
    case 'zone-started':
      return { ...state, rescanningZoneId: action.zoneId };
    case 'zone-succeeded':
      return { ...state, snapshot: snapshotFromSearchResult(action.result) };
    case 'zone-settled':
      return { ...state, rescanningZoneId: null };
    case 'radar-completed':
      return { ...state, radarPhase: 'off', viewMode: 'results' };
    case 'reset':
      return { ...INITIAL_STATE };
    case 'banner-dismissed':
      return { ...state, searchBannerError: null };
  }
}

function defaultNotify(notification: SearchNotification): void {
  const options = notification.duration ? { duration: notification.duration } : undefined;
  toast[notification.type](notification.message, options);
}

function normalizeInitialError(error: unknown): BusinessSearchError {
  return error instanceof BusinessSearchError
    ? error
    : new BusinessSearchError('Search failed unexpectedly. Try again.', null, 'network');
}

export function useBusinessSearchController({
  query,
  runSearch = runBusinessSearch,
  notify = defaultNotify,
}: BusinessSearchControllerOptions) {
  const [state, dispatch] = useReducer(controllerReducer, INITIAL_STATE);
  const initialPendingRef = useRef(false);
  const zonePendingRef = useRef(false);
  const initialRequestRef = useRef(0);
  const zoneRequestRef = useRef(0);

  const replaceSnapshot = useCallback(
    (snapshot: SearchSnapshot, kind: SearchSessionReplacementKind = 'loaded') => {
      initialRequestRef.current += 1;
      zoneRequestRef.current += 1;
      initialPendingRef.current = false;
      zonePendingRef.current = false;
      dispatch({ type: 'replace-session', snapshot: snapshotFromStoredSearch(snapshot), kind });
    },
    []
  );

  const runInitialSearch = useCallback(
    async (
      persistSearch: PersistSearch,
      replaceCommittedSession?: (snapshot: SearchSnapshot) => void
    ): Promise<void> => {
      const businessType = query.businessType?.trim();
      const city = query.city.trim();
      if (!businessType || !city || initialPendingRef.current) return;

      const requestId = initialRequestRef.current + 1;
      initialRequestRef.current = requestId;
      initialPendingRef.current = true;
      dispatch({ type: 'initial-started' });
      try {
        const result = await runSearch({
          businessType,
          cacheIndustry: query.cacheIndustry,
          city,
          country: query.country,
          deepAnalysis: query.deepAnalysis,
          mode: { kind: 'initial' },
        });
        if (initialRequestRef.current !== requestId) return;

        if (result.shouldPersist && replaceCommittedSession) {
          persistSearch(result.cachePayload);
          notify(result.notification);
          replaceCommittedSession(result.cachePayload);
        } else {
          dispatch({ type: 'initial-succeeded', result });
          if (result.shouldPersist) persistSearch(result.cachePayload);
          notify(result.notification);
        }
      } catch (error) {
        if (initialRequestRef.current !== requestId) return;
        const searchError = normalizeInitialError(error);
        notify({
          type: 'error',
          message: searchError.message,
          duration: searchError.kind === 'timeout' ? 10_000 : undefined,
        });
        dispatch({ type: 'initial-failed', error: searchError });
      } finally {
        if (initialRequestRef.current === requestId) {
          initialPendingRef.current = false;
          dispatch({ type: 'initial-settled' });
        }
      }
    },
    [notify, query, runSearch]
  );

  const rescanZone = useCallback(
    async (zone: Zone, persistSearch: PersistSearch): Promise<void> => {
      const identity = state.snapshot.queryIdentity;
      const businessType = identity?.businessType ?? query.businessType?.trim();
      if (!businessType || zonePendingRef.current || state.snapshot.focusedZoneId === zone.id) {
        return;
      }

      const requestId = zoneRequestRef.current + 1;
      zoneRequestRef.current = requestId;
      zonePendingRef.current = true;
      dispatch({ type: 'zone-started', zoneId: zone.id });
      try {
        const result = await runSearch({
          businessType,
          cacheIndustry: identity?.industry ?? query.cacheIndustry,
          city: identity?.city ?? query.city.trim(),
          country: identity?.country ?? query.country,
          deepAnalysis: query.deepAnalysis,
          mode: {
            kind: 'zone',
            zone,
            currentZones: state.snapshot.zones,
            currentZoneBbox: state.snapshot.zoneBbox,
            currentSingleZone: state.snapshot.singleZone,
          },
        });
        if (zoneRequestRef.current !== requestId) return;
        dispatch({ type: 'zone-succeeded', result });
        if (result.shouldPersist) persistSearch(result.cachePayload);
        notify(result.notification);
      } catch (error) {
        if (zoneRequestRef.current !== requestId) return;
        notify({
          type: 'error',
          message: error instanceof BusinessSearchError ? error.message : 'Zone rescan failed',
        });
      } finally {
        if (zoneRequestRef.current === requestId) {
          zonePendingRef.current = false;
          dispatch({ type: 'zone-settled' });
        }
      }
    },
    [notify, query, runSearch, state.snapshot]
  );

  const completeRadar = useCallback(() => dispatch({ type: 'radar-completed' }), []);
  const resetSearch = useCallback(() => {
    initialRequestRef.current += 1;
    zoneRequestRef.current += 1;
    initialPendingRef.current = false;
    zonePendingRef.current = false;
    dispatch({ type: 'reset' });
  }, []);
  const dismissSearchBanner = useCallback(() => dispatch({ type: 'banner-dismissed' }), []);

  return {
    viewMode: state.viewMode,
    snapshot: state.snapshot,
    ...state.snapshot,
    searchResults: state.snapshot.results,
    isSearching: state.isSearching,
    radarPhase: state.radarPhase,
    rescanningZoneId: state.rescanningZoneId,
    searchBannerError: state.searchBannerError,
    replaceSnapshot,
    runInitialSearch,
    rescanZone,
    completeRadar,
    resetSearch,
    dismissSearchBanner,
  };
}
