'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AnimatePresence } from 'motion/react';

import type { EnrichmentStatus } from '@/components/leads/EnrichButton';
import { ErrorBanner } from '@/components/leads/ErrorBanner';
import { LeadResultCard } from '@/components/leads/LeadResultCard';
import { SaveLeadModal } from '@/components/leads/SaveLeadModal';
import { SlidingNumber } from '@/components/motion-primitives/sliding-number';
import type {
  SearchResultEnrichment,
  SearchResultFilters,
  SearchResultSort,
} from '@/lib/business/derive-search-results';
import type { PersistedSearchPayload, SearchMarketDensity } from '@/lib/business/search-snapshot';
import type { Zone, ZoneScanStatus } from '@/lib/business/zone-contract';
import type { EnrichmentBannerError } from '@/lib/hooks/useEnrichmentStream';
import type { SearchBannerError } from '@/lib/hooks/useBusinessSearchController';
import type { BusinessSearchResult } from '@/types';

import { AreaDensityMeter } from './AreaDensityMeter';
import { SaveSessionButton } from './SaveSessionButton';
import { SearchResultsControls, getLeadResultTier } from './SearchResultsControls';
import { ZoneChipsStrip } from './ZoneChipsStrip';

export interface SearchResultsViewProps {
  title: string;
  city: string;
  animatedResultsCount: number;
  totalResults: number;
  filteredResults: readonly BusinessSearchResult[];
  sortBy: SearchResultSort;
  filters: SearchResultFilters;
  onSortChange: (sort: SearchResultSort) => void;
  onFiltersChange: (filters: SearchResultFilters) => void;
  defaultSessionName: string;
  getSessionPayload: () => PersistedSearchPayload;
  zones: Zone[];
  focusedZone?: Zone;
  focusedZoneId: string | null;
  rescanningZoneId: string | null;
  zoneScanStatus: ZoneScanStatus | null;
  marketDensity: SearchMarketDensity | null;
  singleZone: boolean;
  onBack: () => void;
  onZoneSelect: (zone: Zone) => void;
  searchBannerError: SearchBannerError | null;
  onDismissSearchBanner: () => void;
  enrichBannerError: EnrichmentBannerError | null;
  onDismissEnrichBanner: () => void;
  selectedForEnrich: ReadonlySet<string>;
  enrichStatusMap: Readonly<Record<string, EnrichmentStatus>>;
  enrichResultMap: Readonly<Record<string, SearchResultEnrichment>>;
  savingLeadIds: ReadonlySet<string>;
  onToggleSelection: (placeId: string) => void;
  onEnrichLead: (lead: BusinessSearchResult) => void;
  onRequestEnrichmentExplainer: (lead: BusinessSearchResult) => boolean;
  onSaveLead: (lead: BusinessSearchResult) => void;
  savedLeadModal: { isOpen: boolean; businessName: string };
  onCloseSavedLeadModal: () => void;
  onViewSavedLeadCRM: () => void;
}

export function SearchResultsView({
  title,
  city,
  animatedResultsCount,
  totalResults,
  filteredResults,
  sortBy,
  filters,
  onSortChange,
  onFiltersChange,
  defaultSessionName,
  getSessionPayload,
  zones,
  focusedZone,
  focusedZoneId,
  rescanningZoneId,
  zoneScanStatus,
  marketDensity,
  singleZone,
  onBack,
  onZoneSelect,
  searchBannerError,
  onDismissSearchBanner,
  enrichBannerError,
  onDismissEnrichBanner,
  selectedForEnrich,
  enrichStatusMap,
  enrichResultMap,
  savingLeadIds,
  onToggleSelection,
  onEnrichLead,
  onRequestEnrichmentExplainer,
  onSaveLead,
  savedLeadModal,
  onCloseSavedLeadModal,
  onViewSavedLeadCRM,
}: SearchResultsViewProps) {
  return (
    <div className="min-h-screen px-3 sm:px-4 py-4 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <button
              onClick={onBack}
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <h1 className="text-lg sm:text-2xl font-semibold text-white">{title}</h1>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-white/60 sm:text-sm">
              <SlidingNumber value={animatedResultsCount} />
              <span>businesses found</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveSessionButton defaultName={defaultSessionName} getPayload={getSessionPayload} />
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
            onZoneSelect={onZoneSelect}
            disabled={!!rescanningZoneId}
          />
        )}

        {zoneScanStatus === 'unavailable' && marketDensity ? (
          <div
            role="status"
            className="mb-6 rounded-xl border border-border-bright/50 bg-surface/70 p-5 backdrop-blur-sm"
          >
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber-300">
              Market density unavailable
            </p>
            <p className="mt-2 text-sm leading-6 text-gray-300">{marketDensity.description}</p>
          </div>
        ) : (
          marketDensity &&
          marketDensity.areaScore !== undefined &&
          focusedZone && (
            <div className="mb-6">
              <AreaDensityMeter
                score={marketDensity.areaScore}
                level={marketDensity.level}
                label={marketDensity.label}
                description={marketDensity.description}
                amenities={marketDensity.amenities}
                focusedZone={focusedZone}
                cityLabel={city}
                singleZone={singleZone}
              />
            </div>
          )
        )}

        <SearchResultsControls
          sortBy={sortBy}
          filters={filters}
          filteredResults={filteredResults}
          totalResults={totalResults}
          onSortChange={onSortChange}
          onFiltersChange={onFiltersChange}
        />

        {searchBannerError && (
          <ErrorBanner
            message={searchBannerError.message}
            severity={searchBannerError.severity}
            action={searchBannerError.isAuthError ? { label: 'Log in', href: '/login' } : undefined}
            onDismiss={onDismissSearchBanner}
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
            onDismiss={onDismissEnrichBanner}
          />
        )}

        <div
          className={`grid gap-4 transition-opacity duration-300 ${
            rescanningZoneId ? 'pointer-events-none opacity-40' : 'opacity-100'
          }`}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {filteredResults.map((business, index) => (
              <LeadResultCard
                key={business.placeId}
                lead={business}
                index={index}
                rank={index + 1}
                tier={getLeadResultTier(business.leadScore)}
                selected={selectedForEnrich.has(business.placeId)}
                onToggleSelection={() => onToggleSelection(business.placeId)}
                enrichmentStatus={enrichStatusMap[business.placeId] ?? 'idle'}
                enrichmentResult={enrichResultMap[business.placeId]}
                onEnrich={() => onEnrichLead(business)}
                onRequestEnrichmentExplainer={() => onRequestEnrichmentExplainer(business)}
                saveBusy={savingLeadIds.has(business.placeId)}
                onSave={() => onSaveLead(business)}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <SaveLeadModal
        isOpen={savedLeadModal.isOpen}
        businessName={savedLeadModal.businessName}
        onClose={onCloseSavedLeadModal}
        onViewCRM={onViewSavedLeadCRM}
      />
    </div>
  );
}
