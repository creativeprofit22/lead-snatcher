'use client';

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { Settings, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatePresence } from 'motion/react';
import {
  WelcomeHeader,
  BusinessTypeSelector,
  CityInput,
  RadarScan,
  ResumeSearchCard,
  ActivityTicker,
  SavedSessionsPanel,
  SearchResultsView,
} from '@/components/search';
import { PreLoader } from '@/components/preloader';
import { BatchEnrichBar } from '@/components/leads/BatchEnrichBar';
import { EnrichmentExplainer, shouldShowExplainer } from '@/components/leads/EnrichmentExplainer';
import { useEnrichmentStream } from '@/lib/hooks/useEnrichmentStream';
import {
  useBusinessSearchController,
  type SearchSessionReplacementKind,
} from '@/lib/hooks/useBusinessSearchController';
import { SettingsModal } from '@/components/settings';
import { UserMenu } from '@/components/auth';
import { useSearchSessionPersistence } from '@/lib/business/search-session-client';
import {
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
  type SearchSnapshot,
} from '@/lib/business/search-snapshot';
import { decodeSearchCacheBrowserState, type SearchCacheBrowserState } from '@/lib/search-cache';
import {
  filterAndSortResults,
  mergeEnrichmentResults,
  selectResultsById,
  type SearchResultFilters,
  type SearchResultSort,
} from '@/lib/business/derive-search-results';
import { DEFAULT_COUNTRY_CODE, getBusinessTypeLabel } from '@/lib/constants';
import type { IndustryType, BusinessSearchResult } from '@/types';
import type { Zone } from '@/lib/business/zone-contract';

const EMPTY_RESULT_FILTERS: SearchResultFilters = {
  hasEmail: false,
  hasPhone: false,
  hasSocial: false,
  hasAds: false,
  minBudget: 0,
};

type SearchSessionReplacement = SearchSnapshot & SearchCacheBrowserState;

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const [showPreLoader, setShowPreLoader] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Search form state stays local; the controller owns result and lifecycle state.
  const [selectedIndustry, setSelectedIndustry] = useState<IndustryType | null>(null);
  const [customIndustry, setCustomIndustry] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState(DEFAULT_COUNTRY_CODE);
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const effectiveIndustry = customIndustry.trim() || selectedIndustry;
  const {
    viewMode,
    isSearching,
    searchResults,
    radarPhase,
    marketDensity,
    zoneScanStatus,
    zones,
    zoneBbox,
    singleZone,
    focusedZoneId,
    queryIdentity,
    rescanningZoneId,
    searchBannerError,
    replaceSnapshot,
    runInitialSearch,
    rescanZone,
    completeRadar,
    resetSearch,
    dismissSearchBanner,
  } = useBusinessSearchController({
    query: {
      businessType: effectiveIndustry,
      cacheIndustry: selectedIndustry ?? 'other',
      city,
      country,
      deepAnalysis,
    },
  });

  const focusedZone = focusedZoneId ? zones.find((zone) => zone.id === focusedZoneId) : undefined;
  // Filter & sort state
  const [sortBy, setSortBy] = useState<SearchResultSort>('fit');
  const [filters, setFilters] = useState<SearchResultFilters>(EMPTY_RESULT_FILTERS);

  // Count-up for "N businesses found"
  const [resultsCount, setResultsCount] = useState(0);
  useEffect(() => {
    if (viewMode !== 'results') return;
    const target = searchResults.length;
    const start = target >= 10 ? 10 : 0;
    setResultsCount(start);
    const t = setTimeout(() => setResultsCount(target), 180);
    return () => clearTimeout(t);
  }, [viewMode, searchResults.length]);

  // Enrichment state (user-triggered, per-card). The hook owns the
  // NDJSON stream + status/result maps; this component owns selection
  // + the first-time explainer gate.
  const {
    statusMap: enrichStatusMap,
    resultMap: enrichResultMap,
    enrichLeads,
    replaceSession: replaceEnrichmentSession,
    bannerError: enrichBannerError,
    clearBannerError: clearEnrichBannerError,
  } = useEnrichmentStream();
  const [selectedForEnrich, setSelectedForEnrich] = useState<Set<string>>(new Set());
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [pendingEnrichAction, setPendingEnrichAction] = useState<(() => void) | null>(null);
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(new Set());
  const [savedLeadModal, setSavedLeadModal] = useState<{ isOpen: boolean; businessName: string }>({
    isOpen: false,
    businessName: '',
  });
  const sessionEpochRef = useRef(0);

  // Every actual session transition uses this clobbering command. The enrichment
  // hook's one-shot hydrate command remains separate for non-clobbering cache seeds.
  const replaceSearchSession = useCallback(
    (payload: SearchSessionReplacement, kind: SearchSessionReplacementKind = 'loaded') => {
      const browserState = decodeSearchCacheBrowserState(payload);
      const isPresetQuery = payload.businessType === payload.industry;

      sessionEpochRef.current += 1;
      replaceSnapshot(payload, kind);
      setSelectedIndustry(isPresetQuery ? payload.industry : null);
      setCustomIndustry(isPresetQuery ? '' : payload.businessType);
      setCity(payload.city);
      setCountry(payload.country);
      setDeepAnalysis(false);
      replaceEnrichmentSession(browserState.enrichStatusMap, browserState.enrichResultMap);
      setSelectedForEnrich(new Set(browserState.selectedForEnrich ?? []));
      setExplainerOpen(false);
      setPendingEnrichAction(null);
      setSavingLeadIds(new Set());
      setSavedLeadModal({ isOpen: false, businessName: '' });
      setSortBy('fit');
      setFilters(EMPTY_RESULT_FILTERS);
    },
    [replaceEnrichmentSession, replaceSnapshot]
  );

  const handleLocalResumeFound = useCallback(() => setShowPreLoader(false), []);
  const {
    resumeCard,
    resumeDismissed,
    resumeLastSearch: handleResumeLastSearch,
    loadSavedSession: handleLoadSavedSession,
    dismissResume: handleDismissResume,
    persistSearch,
    persistEnrichment,
  } = useSearchSessionPersistence({
    isSearchView: viewMode === 'search',
    onReplaceSession: replaceSearchSession,
    onLocalResumeFound: handleLocalResumeFound,
  });

  const handleSearch = () => {
    void runInitialSearch(persistSearch, (snapshot) =>
      replaceSearchSession(snapshot, 'new-search')
    );
  };

  // Persist enrichment state to the search cache whenever it changes so
  // navigating away and back preserves which leads have been enriched.
  useEffect(() => {
    if (viewMode !== 'results') return;
    persistEnrichment({
      enrichStatusMap,
      enrichResultMap,
      selectedForEnrich: Array.from(selectedForEnrich),
    });
  }, [enrichStatusMap, enrichResultMap, persistEnrichment, selectedForEnrich, viewMode]);

  // Save lead
  const handleSaveLead = async (business: BusinessSearchResult) => {
    if (savingLeadIds.has(business.placeId)) return;

    const sessionEpoch = sessionEpochRef.current;
    setSavingLeadIds((prev) => new Set(prev).add(business.placeId));
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(business),
      });

      const data = await response.json();
      if (sessionEpochRef.current !== sessionEpoch) return;

      if (response.ok) {
        setSavedLeadModal({ isOpen: true, businessName: business.name });
      } else if (response.status === 409) {
        toast.info(`${business.name} already in CRM`);
      } else {
        toast.error(data.error || 'Failed to save');
      }
    } catch {
      if (sessionEpochRef.current === sessionEpoch) toast.error('Failed to save lead');
    } finally {
      if (sessionEpochRef.current === sessionEpoch) {
        setSavingLeadIds((prev) => {
          const next = new Set(prev);
          next.delete(business.placeId);
          return next;
        });
      }
    }
  };

  // Merge enrichment and re-derive every dependent intelligence field before
  // rendering, filtering, sorting, or passing a lead to the save handler.
  const enrichedResults = mergeEnrichmentResults(searchResults, enrichResultMap, focusedZone);
  const selectedEnrichedResults = selectResultsById(enrichedResults, selectedForEnrich);
  const cachedSelectedCount = selectedEnrichedResults.filter(
    (lead) => enrichResultMap[lead.placeId]?.cached
  ).length;
  const isEnrichmentBusy = Object.values(enrichStatusMap).some((status) => status === 'enriching');

  // Fire the enrichment, gating on the first-time explainer. If the
  // user hasn't seen it yet, we open the modal and defer `action`
  // until they press Continue.
  const gateEnrichment = (action: () => void) => {
    if (shouldShowExplainer()) {
      setPendingEnrichAction(() => action);
      setExplainerOpen(true);
      return true; // parent should NOT fire yet
    }
    return false;
  };

  const handleEnrichOne = (lead: BusinessSearchResult) => {
    void enrichLeads([lead], city.trim(), country);
  };

  const handleBatchEnrich = () => {
    if (selectedEnrichedResults.length === 0) return;
    const sessionEpoch = sessionEpochRef.current;
    void enrichLeads(selectedEnrichedResults, city.trim(), country).then(() => {
      // An old stream may resolve after a replacement; only its owning session
      // is allowed to clear selection.
      if (sessionEpochRef.current === sessionEpoch) setSelectedForEnrich(new Set());
    });
  };

  const toggleSelectForEnrich = (placeId: string) => {
    setSelectedForEnrich((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  };

  // Filter and sort results
  const filteredResults = filterAndSortResults(enrichedResults, filters, sortBy);

  const activeBusinessType = queryIdentity?.businessType ?? effectiveIndustry ?? 'other';
  const activeIndustry = queryIdentity?.industry ?? selectedIndustry ?? 'other';
  const activeCity = queryIdentity?.city ?? city.trim();
  const activeCountry = queryIdentity?.country ?? country;
  const resultsTitle = `${getBusinessTypeLabel(activeBusinessType)} in ${activeCity}`;
  const getSessionPayload = (): PersistedSearchPayload => ({
    version: SEARCH_SNAPSHOT_VERSION,
    results: searchResults,
    businessType: activeBusinessType,
    industry: activeIndustry,
    city: activeCity,
    country: activeCountry,
    timestamp: Date.now(),
    zones,
    zoneBbox,
    singleZone,
    focusedZoneId,
    zoneScanStatus: zoneScanStatus ?? undefined,
    marketDensity,
  });

  const handleBackToSearch = () => {
    sessionEpochRef.current += 1;
    resetSearch();
    replaceEnrichmentSession(undefined, undefined);
    setSelectedForEnrich(new Set());
    setExplainerOpen(false);
    setPendingEnrichAction(null);
    setSavingLeadIds(new Set());
    setSavedLeadModal({ isOpen: false, businessName: '' });
    setSelectedIndustry(null);
    setCustomIndustry('');
    setCity('');
    setCountry(DEFAULT_COUNTRY_CODE);
    setDeepAnalysis(false);
    setSortBy('fit');
    setFilters(EMPTY_RESULT_FILTERS);
  };

  // Tap-to-rescan a different zone without leaving the results page.
  const handleZoneSwitch = (zone: Zone) => {
    void rescanZone(zone, persistSearch);
  };

  const handleRequestEnrichmentExplainer = (lead: BusinessSearchResult) =>
    gateEnrichment(() => handleEnrichOne(lead));

  const handleCloseSavedLeadModal = () => setSavedLeadModal({ isOpen: false, businessName: '' });

  const handleViewSavedLeadCRM = () => {
    handleCloseSavedLeadModal();
    window.location.href = '/crm';
  };

  // Floating UI shared by both results view and home view: the batch
  // enrichment bar (appears when leads are selected) and the explainer
  // modal (gates first-time enrichment). Defined before the early
  // return so both branches mount it — otherwise clicking Enrich from
  // the results view sets explainerOpen=true with no modal in the tree.
  const enrichmentFloatingUI = (
    <>
      <BatchEnrichBar
        selectedLeads={selectedEnrichedResults}
        cachedCount={cachedSelectedCount}
        onEnrich={() => {
          const fire = () => handleBatchEnrich();
          if (!gateEnrichment(fire)) fire();
        }}
        onClear={() => setSelectedForEnrich(new Set())}
        isBusy={isEnrichmentBusy}
      />
      <EnrichmentExplainer
        isOpen={explainerOpen}
        onClose={() => {
          setExplainerOpen(false);
          setPendingEnrichAction(null);
        }}
        onContinue={() => {
          pendingEnrichAction?.();
          setPendingEnrichAction(null);
        }}
      />
    </>
  );

  // Render results view
  if (viewMode === 'results') {
    return (
      <>
        <SearchResultsView
          title={resultsTitle}
          city={city}
          animatedResultsCount={resultsCount}
          totalResults={searchResults.length}
          filteredResults={filteredResults}
          sortBy={sortBy}
          filters={filters}
          onSortChange={setSortBy}
          onFiltersChange={setFilters}
          defaultSessionName={resultsTitle}
          getSessionPayload={getSessionPayload}
          zones={zones}
          focusedZone={focusedZone}
          focusedZoneId={focusedZoneId}
          rescanningZoneId={rescanningZoneId}
          zoneScanStatus={zoneScanStatus}
          marketDensity={marketDensity}
          singleZone={singleZone}
          onBack={handleBackToSearch}
          onZoneSelect={handleZoneSwitch}
          searchBannerError={searchBannerError}
          onDismissSearchBanner={dismissSearchBanner}
          enrichBannerError={enrichBannerError}
          onDismissEnrichBanner={clearEnrichBannerError}
          selectedForEnrich={selectedForEnrich}
          enrichStatusMap={enrichStatusMap}
          enrichResultMap={enrichResultMap}
          savingLeadIds={savingLeadIds}
          onToggleSelection={toggleSelectForEnrich}
          onEnrichLead={handleEnrichOne}
          onRequestEnrichmentExplainer={handleRequestEnrichmentExplainer}
          onSaveLead={handleSaveLead}
          savedLeadModal={savedLeadModal}
          onCloseSavedLeadModal={handleCloseSavedLeadModal}
          onViewSavedLeadCRM={handleViewSavedLeadCRM}
        />
        {enrichmentFloatingUI}
      </>
    );
  }

  // Render search view (default)
  return (
    <>
      {showPreLoader && <PreLoader onComplete={() => setShowPreLoader(false)} />}
      <div className="relative flex min-h-screen flex-col items-center px-3 sm:px-4">
        {/* Ambient mesh gradient background — slow drift, no UX interference */}
        <div className="mesh-bg" aria-hidden />

        {/* Activity ticker — top-center, always on */}
        <div className="fixed left-1/2 top-4 z-30 -translate-x-1/2 sm:top-6">
          <ActivityTicker />
        </div>

        {/* User chrome — top-right corner, pinned directly to the viewport
            so the ticker (centered) always has clear air between itself and
            these controls regardless of viewport width. */}
        <div className="fixed right-4 top-4 z-40 flex items-center gap-2 sm:right-6 sm:top-6">
          <SavedSessionsPanel onLoad={handleLoadSavedSession} />
          <Link
            href="/crm"
            className="inline-flex items-center gap-2 rounded-lg border border-border-bright/50 bg-surface/60 px-3 py-1.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-all hover:border-sky-400/50 hover:bg-surface-hover/60 hover:text-white"
          >
            My Leads
          </Link>
          <UserMenu />
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border-bright/50 bg-surface/60 px-3 py-1.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-all hover:border-sky-400/50 hover:bg-surface-hover/60 hover:text-white"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>

        {/* Main content — top-justified so the logo sits just below the ticker
            rather than floating in the vertical middle of a tall viewport. */}
        <div className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-5 pt-24 sm:gap-6 sm:pt-[6.5rem]">
          <WelcomeHeader />

          {resumeCard && !resumeDismissed && (
            <ResumeSearchCard
              businessType={resumeCard.businessType}
              city={resumeCard.city}
              resultCount={resumeCard.resultCount}
              updatedAt={resumeCard.updatedAt}
              onResume={handleResumeLastSearch}
              onDismiss={handleDismissResume}
            />
          )}

          <p className="text-sm text-gray-400 text-center max-w-md">
            Find local businesses that need your digital services. Search by industry and location
            to discover opportunities.
          </p>

          <BusinessTypeSelector
            selected={selectedIndustry}
            onSelect={setSelectedIndustry}
            customIndustry={customIndustry}
            onCustomIndustryChange={setCustomIndustry}
          />

          {(selectedIndustry || customIndustry.trim().length > 0) && (
            <>
              <CityInput
                city={city}
                country={country}
                onCityChange={setCity}
                onCountryChange={setCountry}
                onSearch={handleSearch}
                isLoading={isSearching}
              />

              {/* Deep Analysis Toggle — HUD panel, matches results-page vocabulary. */}
              <label
                className={`hud-panel group relative flex w-full max-w-md cursor-pointer items-center gap-4 rounded-xl border p-4 backdrop-blur-sm transition-all ${
                  deepAnalysis
                    ? 'border-sky-400/55 bg-sky-400/[0.06] shadow-[0_0_22px_rgba(56,189,248,0.18)]'
                    : 'border-border-bright/50 bg-surface/60 hover:border-sky-400/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={deepAnalysis}
                  onChange={(e) => setDeepAnalysis(e.target.checked)}
                  className="sr-only peer"
                />
                <div
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border transition-all ${
                    deepAnalysis
                      ? 'border-sky-400/70 bg-sky-400/15 text-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.35)]'
                      : 'border-border-bright/60 bg-surface-elevated/70 text-white/55'
                  }`}
                >
                  <Gauge className="h-5 w-5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/45">
                      Mode
                    </span>
                    <span
                      className={`font-mono text-[10px] uppercase tracking-[0.24em] transition-colors ${
                        deepAnalysis ? 'text-sky-300' : 'text-white/35'
                      }`}
                    >
                      {deepAnalysis ? '// Active' : '// Idle'}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-white">Deep Website Analysis</span>
                  <span className="text-xs leading-relaxed text-white/55">
                    Lighthouse pass on every site. Slower sweep, sharper scoring.
                  </span>
                </div>
                <div className="relative flex-shrink-0">
                  <div
                    className={`h-7 w-12 rounded-full border transition-colors ${
                      deepAnalysis
                        ? 'border-sky-400/70 bg-sky-400/30'
                        : 'border-border-bright/60 bg-surface-elevated/60'
                    }`}
                  />
                  <div
                    className={`absolute top-0.5 h-5 w-5 rounded-full shadow-[0_0_10px_rgba(56,189,248,0.5)] transition-all ${
                      deepAnalysis ? 'left-[1.625rem] bg-sky-300' : 'left-0.5 bg-white/70'
                    }`}
                  />
                </div>
              </label>

              {/* Enrichment is now per-card (post-sweep) — see the
                  lightning-bolt button on each result to find missing
                  websites + socials on demand. */}

              {/* Pacing notice — sets expectations so dense-city scans
                  don't feel like they're broken. Only really matters
                  when Deep Analysis is on. */}
              {deepAnalysis && (
                <p className="text-[11px] text-amber-300/70 leading-relaxed">
                  Heads-up: dense cities (London, NYC, Tokyo) with Deep Analysis on can take{' '}
                  <span className="font-medium text-amber-300">1–2 minutes</span> to scan all 50
                  leads. Smaller cities finish in under a minute.
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {enrichmentFloatingUI}

      <AnimatePresence>
        {radarPhase !== 'off' && (
          <RadarScan
            key="radar"
            city={city}
            results={radarPhase === 'revealing' ? searchResults : null}
            zones={radarPhase === 'revealing' ? zones : null}
            zoneBbox={radarPhase === 'revealing' ? zoneBbox : null}
            focusedZoneId={focusedZoneId}
            singleZone={singleZone}
            onComplete={completeRadar}
          />
        )}
      </AnimatePresence>
    </>
  );
}
