'use client';

import { useCallback, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { Settings, ArrowLeft, Gauge } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatePresence } from 'motion/react';
import {
  WelcomeHeader,
  BusinessTypeSelector,
  CityInput,
  RadarScan,
  AreaDensityMeter,
  ZoneChipsStrip,
  ResumeSearchCard,
  ActivityTicker,
  SaveSessionButton,
  SavedSessionsPanel,
} from '@/components/search';
import { PreLoader } from '@/components/preloader';
import { SlidingNumber } from '@/components/motion-primitives/sliding-number';
import { SaveLeadModal } from '@/components/leads';
import { LeadResultCard } from '@/components/leads/LeadResultCard';
import { BatchEnrichBar } from '@/components/leads/BatchEnrichBar';
import { ErrorBanner } from '@/components/leads/ErrorBanner';
import { EnrichmentExplainer, shouldShowExplainer } from '@/components/leads/EnrichmentExplainer';
import { useEnrichmentStream } from '@/lib/hooks/useEnrichmentStream';
import { useBusinessSearchController } from '@/lib/hooks/useBusinessSearchController';
import { SettingsModal } from '@/components/settings';
import { UserMenu } from '@/components/auth';
import {
  useSearchSessionPersistence,
  type SearchSessionPayload,
} from '@/lib/business/search-session-client';
import {
  filterAndSortResults,
  mergeEnrichmentResults,
  selectResultsById,
  type SearchResultSort,
} from '@/lib/business/derive-search-results';
import { DEFAULT_COUNTRY_CODE, INDUSTRY_TYPES } from '@/lib/constants';
import type { IndustryType, BusinessSearchResult } from '@/types';
import type { Zone } from '@/lib/business/zone-grid';

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
    zones,
    zoneBbox,
    singleZone,
    focusedZoneId,
    rescanningZoneId,
    searchBannerError,
    hydrateSnapshot,
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

  // Filter & sort state
  const [sortBy, setSortBy] = useState<SearchResultSort>('fit');
  const [filterHasEmail, setFilterHasEmail] = useState(false);
  const [filterHasPhone, setFilterHasPhone] = useState(false);
  const [filterHasSocial, setFilterHasSocial] = useState(false);
  const [filterHasAds, setFilterHasAds] = useState(false);
  const [filterMinBudget, setFilterMinBudget] = useState(0);

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
    hydrate: hydrateEnrichment,
    bannerError: enrichBannerError,
    clearBannerError: clearEnrichBannerError,
  } = useEnrichmentStream();
  const [selectedForEnrich, setSelectedForEnrich] = useState<Set<string>>(new Set());
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [pendingEnrichAction, setPendingEnrichAction] = useState<(() => void) | null>(null);

  // The controller hydrates result data atomically; this adapter keeps form and
  // enrichment persistence concerns in the page.
  const hydrateSearchSession = useCallback(
    (payload: SearchSessionPayload) => {
      hydrateSnapshot(payload);
      setSelectedIndustry(payload.industry);
      setCity(payload.city);
      setCountry(payload.country);
      if (payload.enrichStatusMap || payload.enrichResultMap) {
        hydrateEnrichment(payload.enrichStatusMap, payload.enrichResultMap);
      }
      if (payload.selectedForEnrich?.length) {
        setSelectedForEnrich(new Set(payload.selectedForEnrich));
      }
    },
    [hydrateEnrichment, hydrateSnapshot]
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
    onHydrate: hydrateSearchSession,
    onLocalResumeFound: handleLocalResumeFound,
  });

  const handleSearch = () => {
    void runInitialSearch(persistSearch);
  };

  // Persist enrichment state to the search cache whenever it changes so
  // navigating away and back preserves which leads have been enriched.
  useEffect(() => {
    persistEnrichment({
      enrichStatusMap,
      enrichResultMap,
      selectedForEnrich: Array.from(selectedForEnrich),
    });
  }, [enrichStatusMap, enrichResultMap, persistEnrichment, selectedForEnrich]);

  // Saving leads
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(new Set());
  const [savedLeadModal, setSavedLeadModal] = useState<{ isOpen: boolean; businessName: string }>({
    isOpen: false,
    businessName: '',
  });

  // Save lead
  const handleSaveLead = async (business: BusinessSearchResult) => {
    if (savingLeadIds.has(business.placeId)) return;

    setSavingLeadIds((prev) => new Set(prev).add(business.placeId));
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(business),
      });

      const data = await response.json();

      if (response.ok) {
        setSavedLeadModal({ isOpen: true, businessName: business.name });
      } else if (response.status === 409) {
        toast.info(`${business.name} already in CRM`);
      } else {
        toast.error(data.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save lead');
    } finally {
      setSavingLeadIds((prev) => {
        const next = new Set(prev);
        next.delete(business.placeId);
        return next;
      });
    }
  };

  // Merge any post-sweep enrichment results (website + socials) into
  // each lead so rendering, filtering, and sorting all see the live
  // data — not the stale pre-enrichment snapshot.
  const enrichedResults = mergeEnrichmentResults(searchResults, enrichResultMap);
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
    void enrichLeads(selectedEnrichedResults, city.trim(), country).then(() => {
      // Clear selection after the stream closes — keep selection
      // while rows are still coming in so the bar reflects progress.
      setSelectedForEnrich(new Set());
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
  const filteredResults = filterAndSortResults(
    enrichedResults,
    {
      hasEmail: filterHasEmail,
      hasPhone: filterHasPhone,
      hasSocial: filterHasSocial,
      hasAds: filterHasAds,
      minBudget: filterMinBudget,
    },
    sortBy
  );

  const handleBackToSearch = resetSearch;

  // Tap-to-rescan a different zone without leaving the results page.
  const handleZoneSwitch = (zone: Zone) => {
    void rescanZone(zone, persistSearch);
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
        <div className="min-h-screen px-3 sm:px-4 py-4 sm:py-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <button
                  onClick={handleBackToSearch}
                  className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <h1 className="text-lg sm:text-2xl font-semibold text-white">
                  {customIndustry.trim() ||
                    INDUSTRY_TYPES.find((t) => t.id === selectedIndustry)?.label ||
                    selectedIndustry}{' '}
                  in {city}
                </h1>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-white/60 sm:text-sm">
                  <SlidingNumber value={resultsCount} />
                  <span>businesses found</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SaveSessionButton
                  defaultName={`${
                    customIndustry.trim() ||
                    INDUSTRY_TYPES.find((t) => t.id === selectedIndustry)?.label ||
                    selectedIndustry ||
                    'Session'
                  } in ${city}`}
                  getPayload={() => ({
                    results: searchResults,
                    industry: (selectedIndustry ?? 'other') as IndustryType,
                    city: city.trim(),
                    country,
                    timestamp: Date.now(),
                    zones,
                    zoneBbox,
                    singleZone,
                    focusedZoneId,
                    marketDensity,
                  })}
                />
                <Link
                  href="/crm"
                  className="flex items-center gap-2 rounded-lg bg-accent text-accent-foreground px-4 py-2 text-sm font-medium hover:bg-accent-hover transition-colors shadow-[0_0_20px_oklch(0.65_0.18_250/0.25)]"
                >
                  View My Leads
                </Link>
              </div>
            </div>

            {zones.length > 1 && (
              <ZoneChipsStrip
                zones={zones}
                focusedZoneId={focusedZoneId}
                rescanningZoneId={rescanningZoneId}
                onZoneSelect={handleZoneSwitch}
                disabled={!!rescanningZoneId}
              />
            )}

            {marketDensity && marketDensity.areaScore !== undefined && (
              <div className="mb-6">
                <AreaDensityMeter
                  score={marketDensity.areaScore}
                  level={marketDensity.level}
                  label={marketDensity.label}
                  description={marketDensity.description}
                  amenities={marketDensity.amenities}
                  focusedZone={zones.find((z) => z.id === focusedZoneId) ?? zones[0]}
                  cityLabel={city}
                  singleZone={singleZone}
                />
              </div>
            )}

            {/* Filters & Sort — HUD panel */}
            <div className="hud-panel mb-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-surface/60 border border-border-bright/50 rounded-xl backdrop-blur-sm">
              {/* Sort */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Sort
                </span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SearchResultSort)}
                  className="cursor-pointer rounded-lg border border-border-bright/60 bg-surface-elevated/80 px-2.5 py-1.5 text-xs text-white/85 outline-none transition-colors hover:bg-surface-hover/80 focus:border-sky-400/60"
                >
                  <option value="fit">Best Fit</option>
                  <option value="score">Lead Score</option>
                  <option value="contactPoints">Contact Points</option>
                  <option value="reviews">Reviews</option>
                  <option value="rating">Rating</option>
                </select>
              </div>

              <div className="hidden h-5 w-px bg-border-bright/50 sm:block" />

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Filter
                </span>
                <FilterToggle
                  label="Has Email"
                  active={filterHasEmail}
                  onClick={() => setFilterHasEmail(!filterHasEmail)}
                />
                <FilterToggle
                  label="Has Phone"
                  active={filterHasPhone}
                  onClick={() => setFilterHasPhone(!filterHasPhone)}
                />
                <FilterToggle
                  label="Has Social"
                  active={filterHasSocial}
                  onClick={() => setFilterHasSocial(!filterHasSocial)}
                />
                <FilterToggle
                  label="Runs Ads"
                  active={filterHasAds}
                  onClick={() => setFilterHasAds(!filterHasAds)}
                />
                <select
                  value={filterMinBudget}
                  onChange={(e) => setFilterMinBudget(Number(e.target.value))}
                  className="cursor-pointer rounded-lg border border-border-bright/60 bg-surface-elevated/80 px-2.5 py-1.5 text-xs text-white/85 outline-none transition-colors hover:bg-surface-hover/80 focus:border-sky-400/60"
                >
                  <option value={0}>Any Budget</option>
                  <option value={500}>$500+</option>
                  <option value={1500}>$1.5K+</option>
                  <option value={3000}>$3K+</option>
                  <option value={5000}>$5K+</option>
                </select>
              </div>

              {/* Tier distribution readout */}
              <TierDistribution results={filteredResults} total={searchResults.length} />
            </div>

            {searchBannerError && (
              <ErrorBanner
                message={searchBannerError.message}
                severity={searchBannerError.severity}
                action={
                  searchBannerError.isAuthError ? { label: 'Log in', href: '/login' } : undefined
                }
                onDismiss={dismissSearchBanner}
              />
            )}

            {enrichBannerError && (
              <ErrorBanner
                message={enrichBannerError.message}
                severity={enrichBannerError.kind === 'rate_limited' ? 'warning' : 'error'}
                action={
                  enrichBannerError.kind === 'session_expired'
                    ? { label: 'Log in', href: '/login' }
                    : undefined
                }
                onDismiss={clearEnrichBannerError}
              />
            )}

            <div
              className={`grid gap-4 transition-opacity duration-300 ${
                rescanningZoneId ? 'pointer-events-none opacity-40' : 'opacity-100'
              }`}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {filteredResults.map((business, index) => {
                  const tier =
                    business.leadScore >= 55 ? 'hot' : business.leadScore >= 35 ? 'mid' : 'cold';
                  const rank = index + 1;
                  return (
                    <LeadResultCard
                      key={business.placeId}
                      lead={business}
                      index={index}
                      rank={rank}
                      tier={tier}
                      selected={selectedForEnrich.has(business.placeId)}
                      onToggleSelection={() => toggleSelectForEnrich(business.placeId)}
                      enrichmentStatus={enrichStatusMap[business.placeId] ?? 'idle'}
                      enrichmentResult={enrichResultMap[business.placeId]}
                      onEnrich={() => handleEnrichOne(business)}
                      onRequestEnrichmentExplainer={() =>
                        gateEnrichment(() => handleEnrichOne(business))
                      }
                      saveBusy={savingLeadIds.has(business.placeId)}
                      onSave={() => handleSaveLead(business)}
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* Save Lead Confirmation Modal */}
          <SaveLeadModal
            isOpen={savedLeadModal.isOpen}
            businessName={savedLeadModal.businessName}
            onClose={() => setSavedLeadModal({ isOpen: false, businessName: '' })}
            onViewCRM={() => {
              setSavedLeadModal({ isOpen: false, businessName: '' });
              window.location.href = '/crm';
            }}
          />
        </div>
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
              industry={resumeCard.industry}
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
            singleZone={singleZone}
            onComplete={completeRadar}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`filter-toggle relative rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
        active
          ? 'filter-toggle-active border-sky-400/60 bg-sky-500/15 text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.35)]'
          : 'border-border-bright/45 bg-surface/40 text-white/50 hover:border-border-bright hover:bg-surface-hover/60 hover:text-white/85'
      }`}
    >
      {label}
    </button>
  );
}

function TierDistribution({ results, total }: { results: BusinessSearchResult[]; total: number }) {
  const hot = results.filter((b) => b.leadScore >= 55).length;
  const mid = results.filter((b) => b.leadScore >= 35 && b.leadScore < 55).length;
  const cold = results.filter((b) => b.leadScore < 35).length;
  const shown = results.length;
  const hotPct = shown > 0 ? (hot / shown) * 100 : 0;
  const midPct = shown > 0 ? (mid / shown) * 100 : 0;
  const coldPct = shown > 0 ? (cold / shown) * 100 : 0;

  return (
    <div className="tier-readout sm:ml-auto flex items-center gap-3">
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-70 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
        </span>
        Live
      </span>
      <div className="tier-bar relative h-1.5 w-32 overflow-hidden rounded-full bg-white/5">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-orange-400 to-amber-400"
          style={{ width: `${hotPct}%` }}
        />
        <div
          className="absolute inset-y-0 bg-gradient-to-r from-sky-400 to-cyan-400"
          style={{ left: `${hotPct}%`, width: `${midPct}%` }}
        />
        <div
          className="absolute inset-y-0 bg-gradient-to-r from-slate-500 to-slate-400"
          style={{ left: `${hotPct + midPct}%`, width: `${coldPct}%` }}
        />
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="inline-flex items-center gap-1 text-orange-300">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.8)]" />
          <span className="tabular-nums">{hot}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-sky-300">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]" />
          <span className="tabular-nums">{mid}</span>
        </span>
        <span className="inline-flex items-center gap-1 text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          <span className="tabular-nums">{cold}</span>
        </span>
      </div>
      <span className="font-mono text-[10px] text-white/35">
        <span className="tabular-nums text-white/60">{shown}</span>
        <span>/</span>
        <span className="tabular-nums">{total}</span>
      </span>
    </div>
  );
}
