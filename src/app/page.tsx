'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import {
  Settings,
  ArrowLeft,
  Plus,
  ExternalLink,
  Phone,
  Globe,
  Star,
  MessageSquare,
  MapPin,
  Mail,
  Users,
  Wallet,
  ChevronDown,
  ChevronUp,
  Flame,
  Gauge,
} from 'lucide-react';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
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
import { GlowEffect } from '@/components/motion-primitives/glow-effect';
import { HoloCard } from '@/components/ui/HoloCard';
import {
  LeadScoreBadge,
  OpportunitiesList,
  SaveLeadModal,
} from '@/components/leads';
import { EnrichButton } from '@/components/leads/EnrichButton';
import { BatchEnrichBar } from '@/components/leads/BatchEnrichBar';
import { ErrorBanner } from '@/components/leads/ErrorBanner';
import {
  EnrichmentExplainer,
  shouldShowExplainer,
} from '@/components/leads/EnrichmentExplainer';
import { useEnrichmentStream } from '@/lib/hooks/useEnrichmentStream';
import { SettingsModal } from '@/components/settings';
import { UserMenu } from '@/components/auth';
import {
  saveLastSearch,
  getLastSearch,
  updateLastSearchEnrichment,
  type CachedSearch,
} from '@/lib/search-cache';
import { INDUSTRY_TYPES } from '@/lib/constants';
import type { IndustryType, BusinessSearchResult } from '@/types';
import type { Zone } from '@/lib/business/zone-grid';

type ViewMode = 'search' | 'results';
type SortOption = 'fit' | 'score' | 'contactPoints' | 'reviews' | 'rating';
type RadarPhase = 'off' | 'scanning' | 'revealing';

const MIN_SCAN_DURATION_MS = 900;

/**
 * Client-side mirror of `formatUserSearchLabel` in zone-grid.ts — used to find
 * the zone that got the user's label override on the server so we can focus it
 * by default (instead of blindly focusing the top-density zone, which can land
 * the user on an adjacent neighborhood they didn't search for).
 *
 * Keep this in sync with the server helper if either ever changes.
 */
function formatUserSearchLabel(raw: string): string | null {
  const firstSegment = raw.split(',')[0]?.trim();
  if (!firstSegment) return null;
  const cleaned = firstSegment.replace(/\s+[A-Za-z]{2}$/, '').trim();
  const source = cleaned || firstSegment;
  return source
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/** Pick the zone the user actually asked about; fall back to top-density. */
function pickFocusedZoneId(zones: Zone[], rawCity: string): string | null {
  if (zones.length === 0) return null;
  const label = formatUserSearchLabel(rawCity);
  if (label) {
    const match = zones.find((z) => z.label === label);
    if (match) return match.id;
  }
  return zones[0]?.id ?? null;
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const [showPreLoader, setShowPreLoader] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('search');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Search state
  const [selectedIndustry, setSelectedIndustry] = useState<IndustryType | null>(null);
  const [customIndustry, setCustomIndustry] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('us');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<BusinessSearchResult[]>([]);
  const [radarPhase, setRadarPhase] = useState<RadarPhase>('off');
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const [marketDensity, setMarketDensity] = useState<{
    count: number;
    level: string;
    label: string;
    description: string;
    areaScore?: number;
    competition?: string;
    amenities?: {
      banks: number;
      hotels: number;
      hospitals: number;
      pharmacies: number;
      supermarkets: number;
      fuelStations: number;
      affluenceSpots: number;
      total: number;
    };
  } | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneBbox, setZoneBbox] = useState<
    [number, number, number, number] | null
  >(null);
  const [singleZone, setSingleZone] = useState(false);
  const [focusedZoneId, setFocusedZoneId] = useState<string | null>(null);
  const [rescanningZoneId, setRescanningZoneId] = useState<string | null>(null);

  // Filter & sort state
  const [sortBy, setSortBy] = useState<SortOption>('fit');
  const [filterHasEmail, setFilterHasEmail] = useState(false);
  const [filterHasPhone, setFilterHasPhone] = useState(false);
  const [filterHasSocial, setFilterHasSocial] = useState(false);
  const [filterHasAds, setFilterHasAds] = useState(false);
  const [filterMinBudget, setFilterMinBudget] = useState(0);

  // On mount, surface any localStorage-cached search as a dismissible
  // resume card on the home screen — NO longer auto-redirects to the
  // results view. The user always lands on a clean home and opts in via
  // the card. Dismissing the card hides it for the current browser tab
  // via sessionStorage (survives refresh, clears on tab close) but does
  // NOT destroy the cache, so closing for a recording take and coming
  // back later keeps the session intact.
  useEffect(() => {
    const cached = getLastSearch();
    if (!cached) return;
    // Returning users (those who have cache) skip the preloader cinematic —
    // preserves the original "don't make me watch this twice" behavior.
    setShowPreLoader(false);
    setResumeCard({
      industry: cached.industry,
      city: cached.city,
      country: cached.country,
      resultCount: cached.results.length,
      updatedAt: new Date(cached.timestamp).toISOString(),
      payload: cached,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-session "resume your last search" — only fetched when the
  // user lands on a fresh home screen (no localStorage cache). If the
  // server has a persisted session, surface a small banner above the
  // search form. `dismissed` is a tab-scoped hide; clicking the X also
  // deletes the server-side record.
  const [resumeCard, setResumeCard] = useState<{
    industry: IndustryType;
    city: string;
    country: string;
    resultCount: number;
    updatedAt: string;
    payload: Parameters<typeof saveLastSearch>[0];
  } | null>(null);
  const [resumeDismissed, setResumeDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('lead-snatcher-resume-dismissed') === '1';
  });

  // Persistent search error — shown above the results list when a sweep
  // fails or times out. Companion to the transient toast; this stays
  // visible until the user starts a new search or dismisses it. Kept
  // separate from the enrichment banner so one failure doesn't stomp
  // on the other.
  const [searchBannerError, setSearchBannerError] = useState<{
    message: string;
    severity: 'error' | 'warning';
    isAuthError: boolean;
  } | null>(null);

  useEffect(() => {
    // Only fetch when we're on the home view with no local cache —
    // otherwise the banner would either duplicate auto-restored
    // results or appear after the user already started searching.
    if (viewMode !== 'search') return;
    if (getLastSearch()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/business/last-search');
        if (!res.ok) return;
        const { data } = (await res.json()) as {
          data: (typeof resumeCard extends infer T ? T : never) & {
            results: BusinessSearchResult[];
            industry: IndustryType;
            city: string;
            country: string;
            updatedAt: string;
          };
        };
        if (!data || cancelled) return;
        setResumeCard({
          industry: data.industry,
          city: data.city,
          country: data.country,
          resultCount: data.results.length,
          updatedAt: data.updatedAt,
          payload: data,
        });
      } catch {
        // Network blip — stay silent, home screen works fine without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  const hydrateResultsFromPayload = (
    p: Partial<CachedSearch> & Pick<CachedSearch, 'results' | 'industry' | 'city' | 'country'>
  ) => {
    setSearchResults(p.results);
    setSelectedIndustry(p.industry);
    setCity(p.city);
    setCountry(p.country);
    if (p.zones) setZones(p.zones);
    if (p.zoneBbox !== undefined) setZoneBbox(p.zoneBbox);
    if (typeof p.singleZone === 'boolean') setSingleZone(p.singleZone);
    if (p.focusedZoneId !== undefined) setFocusedZoneId(p.focusedZoneId);
    if (p.marketDensity !== undefined) setMarketDensity(p.marketDensity);
    if (p.enrichStatusMap || p.enrichResultMap) {
      hydrateEnrichment(p.enrichStatusMap, p.enrichResultMap);
    }
    if (p.selectedForEnrich?.length) {
      setSelectedForEnrich(new Set(p.selectedForEnrich));
    }
  };

  const handleResumeLastSearch = () => {
    if (!resumeCard) return;
    const p = resumeCard.payload;
    saveLastSearch(p); // mirror into localStorage for instant future restores
    hydrateResultsFromPayload(p);
    setViewMode('results');
    setResumeCard(null);
  };

  const handleLoadSavedSession = (
    p: Omit<CachedSearch, 'enrichStatusMap' | 'enrichResultMap' | 'selectedForEnrich'>
  ) => {
    // Mirror into localStorage so CRM-and-back / refreshes hold the
    // loaded session in place the same way a fresh sweep would.
    saveLastSearch(p);
    hydrateResultsFromPayload(p);
    setViewMode('results');
    setResumeCard(null);
  };

  const handleDismissResume = () => {
    // Hide for the current browser tab (persists across refresh, clears on
    // tab close) WITHOUT destroying the cache. Matt can dismiss for a
    // recording take and the next work session still finds the card.
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('lead-snatcher-resume-dismissed', '1');
    }
    setResumeDismissed(true);
    setResumeCard(null);
  };

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
    clearStatus: clearEnrichStatus,
    hydrate: hydrateEnrichment,
    bannerError: enrichBannerError,
    clearBannerError: clearEnrichBannerError,
  } = useEnrichmentStream();
  const [selectedForEnrich, setSelectedForEnrich] = useState<Set<string>>(
    new Set()
  );
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [pendingEnrichAction, setPendingEnrichAction] = useState<
    (() => void) | null
  >(null);

  // Auto-clear the 'enriched' success state 3s after completion so the
  // button flips back to idle and the found-data diff banner fades.
  useEffect(() => {
    const timers: number[] = [];
    for (const [id, status] of Object.entries(enrichStatusMap)) {
      if (status === 'enriched') {
        timers.push(
          window.setTimeout(() => clearEnrichStatus(id), 3000)
        );
      }
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [enrichStatusMap, clearEnrichStatus]);

  // Persist enrichment state to the search cache whenever it changes so
  // navigating away and back preserves which leads have been enriched.
  useEffect(() => {
    updateLastSearchEnrichment({
      enrichStatusMap,
      enrichResultMap,
      selectedForEnrich: Array.from(selectedForEnrich),
    });
  }, [enrichStatusMap, enrichResultMap, selectedForEnrich]);

  // Saving leads
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(new Set());
  const [savedLeadModal, setSavedLeadModal] = useState<{ isOpen: boolean; businessName: string }>({
    isOpen: false,
    businessName: '',
  });

  // Search businesses
  const handleSearch = async () => {
    const effectiveIndustry = customIndustry.trim() || selectedIndustry;
    if (!effectiveIndustry || !city.trim() || isSearching) return;

    const scanStart = Date.now();
    setIsSearching(true);
    setRadarPhase('scanning');
    setSearchBannerError(null); // clear any lingering banner from a prior attempt
    // Tiered timeout: a standard sweep should finish in ~30-90s; past
    // 2 min the server has almost certainly died (OOM, hang, whatever).
    // Deep Analysis runs PageSpeed on all 50 sites serially and
    // legitimately needs the full 5 min window.
    const SEARCH_HARD_TIMEOUT_MS = deepAnalysis ? 5 * 60_000 : 2 * 60_000;
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), SEARCH_HARD_TIMEOUT_MS);
    try {
      const response = await fetch('/api/business/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessType: effectiveIndustry,
          city: city.trim(),
          country,
          limit: 50,
          deepAnalysis,
        }),
        signal: abortController.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = data.error || `Search failed (${response.status})`;
        toast.error(msg);
        setSearchBannerError({
          message: msg,
          severity: response.status === 401 ? 'error' : 'error',
          isAuthError: response.status === 401,
        });
        setRadarPhase('off');
        return;
      }

      const elapsed = Date.now() - scanStart;
      if (elapsed < MIN_SCAN_DURATION_MS) {
        await new Promise((r) => setTimeout(r, MIN_SCAN_DURATION_MS - elapsed));
      }

      setSearchResults(data.results || []);
      setMarketDensity(data.marketDensity || null);
      const nextZones: Zone[] = data.zones || [];
      setZones(nextZones);
      setZoneBbox(Array.isArray(data.zoneBbox) ? data.zoneBbox : null);
      setSingleZone(Boolean(data.singleZone));
      // Focus the zone matching the user's typed target (e.g. "Shepherds Bush")
      // over the raw top-density winner (which could be an adjacent neighborhood).
      // Falls back to nextZones[0] if the user didn't refine or their label
      // didn't survive to the zones list.
      setFocusedZoneId(pickFocusedZoneId(nextZones, city.trim()));
      setRadarPhase('revealing');

      if (data.results?.length > 0) {
        const cachePayload = {
          results: data.results,
          industry: (selectedIndustry ?? 'other') as IndustryType,
          city: city.trim(),
          country,
          zones: nextZones,
          zoneBbox: Array.isArray(data.zoneBbox) ? data.zoneBbox : null,
          singleZone: Boolean(data.singleZone),
          focusedZoneId: pickFocusedZoneId(nextZones, city.trim()),
          marketDensity: data.marketDensity || null,
        };
        saveLastSearch(cachePayload);
        // Fire-and-forget DB persist — enables the resume card on a
        // fresh browser. Errors are silent; localStorage is still the
        // primary fast path.
        void fetch('/api/business/last-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cachePayload),
        }).catch(() => {});
      }

      if (data.results?.length === 0) {
        // Distinguish "Maps provider glitched" from "genuinely zero hits in a
        // tiny area". The provider glitch is the common case for micro-zones
        // (e.g. a single street) and for repeat queries that worked a moment
        // earlier — surface that possibility so the user doesn't assume the
        // city/industry combination is a dead end.
        const msg =
          'No businesses returned. The Maps provider sometimes blanks out for micro-zones or repeat queries — hit Search again, or widen to a bigger city name.';
        toast.error(msg, { duration: 8000 });
        setSearchBannerError({
          message: msg,
          severity: 'error',
          isAuthError: false,
        });
        setRadarPhase('off');
      } else {
        toast.success(`Found ${data.results.length} businesses`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // AbortController fired either because the user navigated away
        // or because our wall-clock timeout tripped. Distinguish the
        // two with the elapsed time vs the configured cap.
        const timeoutMsg = deepAnalysis
          ? 'Deep Analysis sweep took longer than 5 minutes — the server likely died mid-request. Try again, or disable Deep Analysis.'
          : 'Sweep took longer than 2 minutes — the server likely died mid-request (usually a memory spike). Try again with a less dense city.';
        toast.error(timeoutMsg, { duration: 10_000 });
        setSearchBannerError({
          message: timeoutMsg,
          severity: 'error',
          isAuthError: false,
        });
      } else {
        const msg =
          error instanceof TypeError
            ? 'Lost connection to the server mid-sweep. Check the server is still running and try again.'
            : 'Search failed unexpectedly. Try again; if it keeps happening, check the server logs.';
        toast.error(msg);
        setSearchBannerError({
          message: msg,
          severity: 'error',
          isAuthError: false,
        });
      }
      setRadarPhase('off');
    } finally {
      clearTimeout(abortTimer);
      setIsSearching(false);
    }
  };

  const handleRadarComplete = () => {
    setRadarPhase('off');
    setViewMode('results');
  };

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
  const enrichedResults = searchResults.map((lead) => {
    const found = enrichResultMap[lead.placeId];
    if (!found) return lead;
    const mergedSocials: BusinessSearchResult['socialLinks'] = {
      ...(lead.socialLinks ?? {}),
      ...(found.socials ?? {}),
    };
    return {
      ...lead,
      website: lead.website ?? found.website,
      socialLinks: mergedSocials,
    } satisfies BusinessSearchResult;
  });

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
    const leads = enrichedResults.filter((l) => selectedForEnrich.has(l.placeId));
    if (leads.length === 0) return;
    void enrichLeads(leads, city.trim(), country).then(() => {
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
  const filteredResults = enrichedResults
    .filter((b) => {
      if (filterHasEmail && !(b.email && isRealEmail(b.email))) return false;
      if (filterHasPhone && !b.phone) return false;
      if (filterHasSocial && Object.keys(b.socialLinks || {}).length === 0) return false;
      if (filterHasAds && !b.scoreBreakdown.hasMarketingBudget) return false;
      if (filterMinBudget > 0 && (!b.budgetEstimate || b.budgetEstimate.min < filterMinBudget)) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'fit':
          return (b.fitScore ?? 0) - (a.fitScore ?? 0) || b.leadScore - a.leadScore;
        case 'contactPoints':
          return b.contactPoints - a.contactPoints || b.leadScore - a.leadScore;
        case 'reviews':
          return (b.reviewCount || 0) - (a.reviewCount || 0);
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        case 'score':
          return b.leadScore - a.leadScore || b.contactPoints - a.contactPoints;
        default:
          return b.leadScore - a.leadScore || b.contactPoints - a.contactPoints;
      }
    });

  const handleBackToSearch = () => {
    setViewMode('search');
    setSearchResults([]);
    setMarketDensity(null);
    setZones([]);
    setZoneBbox(null);
    setSingleZone(false);
    setFocusedZoneId(null);
    setRescanningZoneId(null);
  };

  // Tap-to-rescan a different zone without leaving the results page.
  // Reuses zones from the initial scan; only the Maps search + density update.
  const handleZoneSwitch = async (zone: Zone) => {
    const effectiveIndustry = customIndustry.trim() || selectedIndustry;
    if (!effectiveIndustry || rescanningZoneId) return;
    if (focusedZoneId === zone.id) return;

    setRescanningZoneId(zone.id);
    try {
      const response = await fetch('/api/business/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessType: effectiveIndustry,
          city: city.trim(),
          country,
          limit: 50,
          deepAnalysis,
          searchLat: zone.latitude,
          searchLng: zone.longitude,
          zoneLabel: zone.label,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Zone rescan failed');
        return;
      }
      setSearchResults(data.results || []);
      setMarketDensity(data.marketDensity || null);
      if (Array.isArray(data.zones) && data.zones.length > 0) {
        setZones(data.zones);
      }
      setFocusedZoneId(zone.id);
      if (data.results?.length === 0) {
        toast.info(`No businesses in ${zone.label}`);
      } else {
        toast.success(`Scanning ${zone.label} — ${data.results.length} found`);
      }
      const zoneCachePayload = {
        results: data.results || [],
        industry: (selectedIndustry ?? 'other') as IndustryType,
        city: city.trim(),
        country,
        zones: Array.isArray(data.zones) && data.zones.length > 0 ? data.zones : zones,
        zoneBbox: Array.isArray(data.zoneBbox) ? data.zoneBbox : zoneBbox,
        singleZone,
        focusedZoneId: zone.id,
        marketDensity: data.marketDensity || null,
      };
      saveLastSearch(zoneCachePayload);
      void fetch('/api/business/last-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zoneCachePayload),
      }).catch(() => {});
    } catch {
      toast.error('Zone rescan failed');
    } finally {
      setRescanningZoneId(null);
    }
  };

  // Floating UI shared by both results view and home view: the batch
  // enrichment bar (appears when leads are selected) and the explainer
  // modal (gates first-time enrichment). Defined before the early
  // return so both branches mount it — otherwise clicking Enrich from
  // the results view sets explainerOpen=true with no modal in the tree.
  const enrichmentFloatingUI = (
    <>
      <BatchEnrichBar
        selectedLeads={enrichedResults.filter((l) =>
          selectedForEnrich.has(l.placeId)
        )}
        cachedCount={
          enrichedResults.filter(
            (l) =>
              selectedForEnrich.has(l.placeId) &&
              enrichResultMap[l.placeId]?.cached
          ).length
        }
        onEnrich={() => {
          const fire = () => handleBatchEnrich();
          if (!gateEnrichment(fire)) fire();
        }}
        onClear={() => setSelectedForEnrich(new Set())}
        isBusy={Object.values(enrichStatusMap).some((s) => s === 'enriching')}
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
                focusedZone={
                  zones.find((z) => z.id === focusedZoneId) ?? zones[0]
                }
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
                onChange={(e) => setSortBy(e.target.value as SortOption)}
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
              <FilterToggle label="Has Email" active={filterHasEmail} onClick={() => setFilterHasEmail(!filterHasEmail)} />
              <FilterToggle label="Has Phone" active={filterHasPhone} onClick={() => setFilterHasPhone(!filterHasPhone)} />
              <FilterToggle label="Has Social" active={filterHasSocial} onClick={() => setFilterHasSocial(!filterHasSocial)} />
              <FilterToggle label="Runs Ads" active={filterHasAds} onClick={() => setFilterHasAds(!filterHasAds)} />
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
                searchBannerError.isAuthError
                  ? { label: 'Log in', href: '/login' }
                  : undefined
              }
              onDismiss={() => setSearchBannerError(null)}
            />
          )}

          {enrichBannerError && (
            <ErrorBanner
              message={enrichBannerError.message}
              severity={
                enrichBannerError.kind === 'rate_limited'
                  ? 'warning'
                  : 'error'
              }
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
                  business.leadScore >= 55
                    ? 'hot'
                    : business.leadScore >= 35
                      ? 'mid'
                      : 'cold';
                const rank = index + 1;
                return (
                <motion.div
                  key={business.placeId}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{
                    type: 'spring',
                    stiffness: 320,
                    damping: 32,
                    mass: 0.6,
                    delay: Math.min(index, 16) * 0.04,
                  }}
                  data-heat={tier}
                  data-rank={rank}
                  style={{ ['--i' as string]: index }}
                  className="relative"
                >
                {rank <= 3 && (
                  <span className={`lead-rank-pip lead-rank-${rank}`}>
                    {rank === 1 && <Flame className="w-3 h-3" />}
                    #{rank}
                    {rank === 1 && ' HOT LEAD'}
                  </span>
                )}
                <HoloCard
                  className={`lead-card lead-tier-${tier} bg-surface-elevated/60 border border-border-bright/60 rounded-xl p-4 sm:p-5 backdrop-blur-sm`}
                  spotlightColor={
                    tier === 'hot'
                      ? 'rgba(253, 186, 116, 0.32)'
                      : tier === 'mid'
                        ? 'rgba(125, 211, 252, 0.28)'
                        : 'rgba(148, 163, 184, 0.22)'
                  }
                  glareColor={
                    tier === 'hot'
                      ? '#fdba74'
                      : tier === 'mid'
                        ? '#9be8ff'
                        : '#cbd5e1'
                  }
                  glareOpacity={tier === 'hot' ? 0.4 : 0.3}
                >
                <div className="flex flex-col lg:flex-row gap-4">
                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <label
                          className="flex-shrink-0 mt-1 cursor-pointer select-none"
                          title={`Select ${business.name} for batch enrichment`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedForEnrich.has(business.placeId)}
                            onChange={() => toggleSelectForEnrich(business.placeId)}
                            aria-label={`Select ${business.name} for batch enrichment`}
                            className="w-4 h-4 rounded border-gray-600 bg-transparent text-sky-500 focus:ring-sky-500 focus:ring-offset-0 cursor-pointer"
                          />
                        </label>
                        <div className="min-w-0">
                          <h3 className="lead-card-name text-lg font-semibold truncate">
                            {business.name}
                          </h3>
                          {business.address && (
                            <p className="text-sm text-gray-400 flex items-center gap-1.5 mt-1">
                              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{business.address}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <LeadScoreBadge
                        score={business.leadScore}
                        breakdown={business.scoreBreakdown}
                        websiteAnalysis={business.websiteAnalysis}
                      />
                    </div>

                    {/* Contact & Links */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {business.phone && (
                        <a
                          href={`tel:${business.phone}`}
                          className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          {business.phone}
                        </a>
                      )}
                      {business.email && isRealEmail(business.email) && (
                        <a
                          href={`mailto:${business.email}`}
                          className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          {business.email}
                        </a>
                      )}
                      {business.website && (
                        <a
                          href={business.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                        >
                          <Globe className="w-3.5 h-3.5" />
                          Website
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <EnrichButton
                        lead={business}
                        status={enrichStatusMap[business.placeId] ?? 'idle'}
                        onClick={() => handleEnrichOne(business)}
                        onRequestExplainer={() =>
                          gateEnrichment(() => handleEnrichOne(business))
                        }
                      />
                      {enrichStatusMap[business.placeId] === 'enriched' &&
                        (() => {
                          const found = enrichResultMap[business.placeId];
                          if (!found) return null;
                          const deltas: string[] = [];
                          if (found.website) deltas.push('website');
                          const socialKeys = Object.keys(found.socials ?? {});
                          if (socialKeys.length > 0) {
                            deltas.push(
                              socialKeys.length === 1
                                ? socialKeys[0]
                                : `${socialKeys.length} socials`
                            );
                          }
                          if (deltas.length === 0) {
                            return (
                              <span
                                role="status"
                                className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-gray-500/15 text-gray-300"
                                title="Small businesses often run on phone + word-of-mouth — still a valid lead"
                              >
                                No public contact data found
                              </span>
                            );
                          }
                          return (
                            <span
                              role="status"
                              className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-emerald-500/15 text-emerald-300"
                            >
                              + {deltas.join(', ')}
                            </span>
                          );
                        })()}
                      {business.mapsUrl && (
                        <a
                          href={business.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          Maps
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    {/* Website Quality chips — top triggered Layer 5 signals.
                        Every chip is a concrete, non-subjective fact usable in a sales email. */}
                    {business.scoreBreakdown.qualityChips.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {business.scoreBreakdown.qualityChips.map((chip) => (
                          <span
                            key={chip}
                            className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-amber-500/15 text-amber-300"
                            title="Website-quality signal — deterministic, no subjective calls"
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Social Media Links */}
                    {business.socialLinks && Object.keys(business.socialLinks).length > 0 && (
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="w-3.5 h-3.5 text-gray-500" />
                        {business.socialLinks.facebook && (
                          <a href={business.socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-400 transition-colors" title="Facebook">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.instagram && (
                          <a href={business.socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-pink-400 transition-colors" title="Instagram">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.twitter && (
                          <a href={business.socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors" title="X / Twitter">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.linkedin && (
                          <a href={business.socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-300 transition-colors" title="LinkedIn">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.youtube && (
                          <a href={business.socialLinks.youtube} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-red-400 transition-colors" title="YouTube">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.tiktok && (
                          <a href={business.socialLinks.tiktok} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors" title="TikTok">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="lead-stats flex items-center gap-3 text-sm text-gray-400">
                      {business.rating && (
                        <span className="lead-stat flex items-center gap-1.5">
                          <Star className="w-4 h-4 text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.55)]" />
                          <span className="tabular-nums font-medium text-white/85">
                            {business.rating.toFixed(1)}
                          </span>
                        </span>
                      )}
                      {typeof business.priceLevel === 'number' && business.priceLevel > 0 && (
                        <PriceTier level={business.priceLevel} />
                      )}
                      {business.reviewCount !== undefined && (
                        <span className="lead-stat flex items-center gap-1.5">
                          <MessageSquare className="w-4 h-4 text-white/40" />
                          <span className="tabular-nums font-medium text-white/75">
                            {business.reviewCount}
                          </span>
                          <span className="text-white/40">reviews</span>
                        </span>
                      )}
                      <span className="lead-stat flex items-center gap-1.5" title="Contact channels available">
                        <Users className="w-4 h-4 text-white/40" />
                        <span className="tabular-nums font-medium text-white/75">
                          {business.contactPoints}
                        </span>
                        <span className="text-white/40">
                          contact {business.contactPoints === 1 ? 'point' : 'points'}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Budget & Opportunities */}
                  <div className="lg:w-80 flex flex-col gap-3">
                    {/* Budget Estimate */}
                    {business.budgetEstimate && (
                      <BudgetCard estimate={business.budgetEstimate} />
                    )}

                    <OpportunitiesList opportunities={business.opportunities} maxVisible={2} />
                    <div className="group relative">
                      <GlowEffect
                        colors={['#10b981', '#14b8a6', '#06b6d4', '#10b981']}
                        mode="colorShift"
                        blur="soft"
                        duration={3.5}
                        className="rounded-lg opacity-0 transition-opacity duration-300 group-hover:opacity-65"
                      />
                      <button
                        onClick={() => handleSaveLead(business)}
                        disabled={savingLeadIds.has(business.placeId)}
                        className="relative flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-[0_4px_16px_rgba(16,185,129,0.25)] transition-all hover:from-emerald-400 hover:to-teal-500 hover:shadow-[0_6px_24px_rgba(16,185,129,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Plus className="h-4 w-4" />
                        {savingLeadIds.has(business.placeId) ? 'Saving...' : 'Save Lead'}
                      </button>
                    </div>
                  </div>
                </div>
                </HoloCard>
                </motion.div>
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
            Find local businesses that need your digital services.
            Search by industry and location to discover opportunities.
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
                  <span className="text-sm font-semibold text-white">
                    Deep Website Analysis
                  </span>
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
                  Heads-up: dense cities (London, NYC, Tokyo) with{' '}
                  Deep Analysis on can take{' '}
                  <span className="font-medium text-amber-300">1–2 minutes</span>{' '}
                  to scan all 50 leads. Smaller cities finish in under a minute.
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
            onComplete={handleRadarComplete}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function BudgetCard({
  estimate,
}: {
  estimate: {
    min: number;
    max: number;
    label: string;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
  };
}) {
  const [expanded, setExpanded] = useState(false);

  const confidenceColor =
    estimate.confidence === 'high'
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
      : estimate.confidence === 'medium'
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
        : 'text-gray-400 bg-white/5 border-white/10';

  return (
    <div className={`budget-card relative overflow-hidden rounded-lg border p-3 ${confidenceColor}`}>
      <div className="budget-card-shine" aria-hidden />
      <button
        onClick={() => setExpanded(!expanded)}
        className="relative w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 drop-shadow-[0_0_6px_currentColor]" />
          <span className="text-sm font-semibold tracking-wide">{estimate.label}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] opacity-55">
            {estimate.confidence} conf.
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 opacity-50" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        )}
      </button>
      {expanded && (
        <div className="relative mt-2 pt-2 border-t border-current/10 space-y-1">
          {estimate.reasons.map((reason, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] opacity-80">
              <span className="mt-0.5 w-1 h-1 rounded-full bg-current flex-shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isRealEmail(email: string): boolean {
  const junk = [
    /user@/i, /name@/i, /someone@/i, /test@/i, /your/i,
    /example\.com/i, /domain\.com/i, /email\.com$/i,
    /noreply/i, /no-reply/i, /placeholder/i, /sample/i,
    /changeme/i, /wix\.com/i, /sentry/i, /wordpress/i,
  ];
  return !junk.some((p) => p.test(email));
}

function PriceTier({ level }: { level: number }) {
  const capped = Math.max(1, Math.min(4, Math.round(level)));
  const tierConfig: Record<number, { label: string; color: string; glow: string; tip: string }> = {
    1: {
      label: '$',
      color: 'text-slate-400',
      glow: '',
      tip: 'Budget pricing — tight margins',
    },
    2: {
      label: '$$',
      color: 'text-emerald-300',
      glow: 'drop-shadow-[0_0_4px_rgba(52,211,153,0.5)]',
      tip: 'Mid-range pricing',
    },
    3: {
      label: '$$$',
      color: 'text-amber-300',
      glow: 'drop-shadow-[0_0_6px_rgba(252,211,77,0.6)]',
      tip: 'Upscale pricing — solid budget',
    },
    4: {
      label: '$$$$',
      color: 'text-yellow-200',
      glow: 'drop-shadow-[0_0_8px_rgba(253,224,71,0.85)]',
      tip: 'Premium pricing — deep pockets',
    },
  };
  const cfg = tierConfig[capped];
  return (
    <span
      className={`lead-stat flex items-center gap-1 font-mono font-semibold tabular-nums ${cfg.color} ${cfg.glow}`}
      title={cfg.tip}
    >
      {cfg.label}
    </span>
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

function TierDistribution({
  results,
  total,
}: {
  results: BusinessSearchResult[];
  total: number;
}) {
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
