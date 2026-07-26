'use client';

import type { LeadResultTier } from '@/components/leads/LeadResultCard';
import type { SearchResultFilters, SearchResultSort } from '@/lib/business/derive-search-results';
import type { BusinessSearchResult } from '@/types';

interface SearchResultsControlsProps {
  sortBy: SearchResultSort;
  filters: SearchResultFilters;
  filteredResults: readonly BusinessSearchResult[];
  totalResults: number;
  onSortChange: (sort: SearchResultSort) => void;
  onFiltersChange: (filters: SearchResultFilters) => void;
}

export function getLeadResultTier(leadScore: number): LeadResultTier {
  return leadScore >= 55 ? 'hot' : leadScore >= 35 ? 'mid' : 'cold';
}

export function SearchResultsControls({
  sortBy,
  filters,
  filteredResults,
  totalResults,
  onSortChange,
  onFiltersChange,
}: SearchResultsControlsProps) {
  return (
    <div className="hud-panel mb-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-surface/60 border border-border-bright/50 rounded-xl backdrop-blur-sm">
      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Sort</span>
        <select
          value={sortBy}
          onChange={(event) => onSortChange(event.target.value as SearchResultSort)}
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
          active={filters.hasEmail}
          onClick={() => onFiltersChange({ ...filters, hasEmail: !filters.hasEmail })}
        />
        <FilterToggle
          label="Has Phone"
          active={filters.hasPhone}
          onClick={() => onFiltersChange({ ...filters, hasPhone: !filters.hasPhone })}
        />
        <FilterToggle
          label="Has Social"
          active={filters.hasSocial}
          onClick={() => onFiltersChange({ ...filters, hasSocial: !filters.hasSocial })}
        />
        <FilterToggle
          label="Runs Ads"
          active={filters.hasAds}
          onClick={() => onFiltersChange({ ...filters, hasAds: !filters.hasAds })}
        />
        <select
          value={filters.minBudget}
          onChange={(event) =>
            onFiltersChange({ ...filters, minBudget: Number(event.target.value) })
          }
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
      <TierDistribution results={filteredResults} total={totalResults} />
    </div>
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
  results: readonly BusinessSearchResult[];
  total: number;
}) {
  const tiers = results.map((result) => getLeadResultTier(result.leadScore));
  const hot = tiers.filter((tier) => tier === 'hot').length;
  const mid = tiers.filter((tier) => tier === 'mid').length;
  const cold = tiers.filter((tier) => tier === 'cold').length;
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
