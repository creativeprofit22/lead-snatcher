'use client';

import { useState } from 'react';
import {
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Calendar,
  AlertCircle,
  Clock,
  Settings,
} from 'lucide-react';
import { LEAD_STATUSES, INDUSTRY_TYPES } from '@/lib/constants';
import { defaultLeadListQuery, type LeadListFilters } from '@/lib/crm-lead-query';
import type { CrmTagsResource } from '@/lib/hooks/useCrmTags';
import type { LeadStatus, IndustryType } from '@/types';

interface FilterSidebarProps {
  filters: LeadListFilters;
  onFiltersChange: (filters: LeadListFilters) => void;
  isOpen: boolean;
  onClose: () => void;
  leadCount: number;
  statusScopeLabel?: string;
  onOpenTagManager?: () => void;
  tagCatalog: CrmTagsResource;
}

export function FilterSidebar({
  filters,
  onFiltersChange,
  isOpen,
  onClose,
  leadCount,
  statusScopeLabel,
  onOpenTagManager,
  tagCatalog,
}: FilterSidebarProps) {
  // Section collapse state - all closed by default
  const [sections, setSections] = useState({
    status: false,
    score: false,
    industry: false,
    tags: false,
    followUp: false,
    sort: false,
  });
  const { tags: availableTags, loading: tagsLoading, error: tagsError, refetch } = tagCatalog;

  const toggleSection = (section: keyof typeof sections) => {
    setSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Check if any filters are active
  const hasActiveFilters =
    filters.statuses.length > 0 ||
    filters.industries.length > 0 ||
    filters.tags.length > 0 ||
    filters.minScore > 0 ||
    filters.maxScore < 100 ||
    filters.followUp !== 'all';

  // Reset all filters
  const resetFilters = () => {
    onFiltersChange(defaultLeadListQuery);
  };

  // Toggle status filter
  const toggleStatus = (status: LeadStatus) => {
    const newStatuses = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    onFiltersChange({ ...filters, statuses: newStatuses });
  };

  // Toggle industry filter
  const toggleIndustry = (industry: IndustryType) => {
    const newIndustries = filters.industries.includes(industry)
      ? filters.industries.filter((i) => i !== industry)
      : [...filters.industries, industry];
    onFiltersChange({ ...filters, industries: newIndustries });
  };

  // Toggle tag filter
  const toggleTag = (tagId: string) => {
    const newTags = filters.tags.includes(tagId)
      ? filters.tags.filter((t) => t !== tagId)
      : [...filters.tags, tagId];
    onFiltersChange({ ...filters, tags: newTags });
  };

  // Update score range
  const updateScoreRange = (key: 'minScore' | 'maxScore', value: number) => {
    const clampedValue = Math.min(100, Math.max(0, value));
    const nextFilters = { ...filters, [key]: clampedValue };
    // Keep the UI state inside the same range contract enforced by the API.
    if (key === 'minScore' && clampedValue > filters.maxScore) {
      nextFilters.maxScore = clampedValue;
    }
    if (key === 'maxScore' && clampedValue < filters.minScore) {
      nextFilters.minScore = clampedValue;
    }
    onFiltersChange(nextFilters);
  };

  // Follow-up options
  const followUpOptions = [
    { id: 'all' as const, label: 'All', icon: null },
    { id: 'today' as const, label: 'Today', icon: Calendar },
    { id: 'overdue' as const, label: 'Overdue', icon: AlertCircle },
    { id: 'this_week' as const, label: 'This Week', icon: Clock },
  ];

  // Sort options
  const sortOptions = [
    { id: 'savedAt' as const, label: 'Date Added' },
    { id: 'leadScore' as const, label: 'Lead Score' },
    { id: 'name' as const, label: 'Name' },
    { id: 'nextFollowUpAt' as const, label: 'Follow-up Date' },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <button
          type="button"
          aria-label="Dismiss filters"
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        id="crm-filter-sidebar"
        aria-label="Lead filters"
        className={`fixed lg:sticky top-0 lg:top-20 left-0 h-full lg:h-auto w-80 lg:w-72 bg-black lg:bg-transparent border-r lg:border-r-0 border-white/10 z-50 lg:z-0 transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-full lg:h-auto overflow-y-auto lg:overflow-visible p-4 lg:p-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 lg:hidden">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-500" />
              <h2 className="text-lg font-medium text-gray-200">Filters</h2>
            </div>
            <button
              type="button"
              aria-label="Close filters"
              onClick={onClose}
              className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-white/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Results count & Reset */}
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/10">
            <span className="text-sm text-gray-500">
              {leadCount} {leadCount === 1 ? 'result' : 'results'}
            </span>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="mb-4">
            <button
              type="button"
              disabled={Boolean(statusScopeLabel)}
              aria-expanded={!statusScopeLabel && sections.status}
              aria-controls="crm-status-filters"
              onClick={() => toggleSection('status')}
              className="flex items-center justify-between w-full py-2 text-left disabled:cursor-not-allowed"
            >
              <span className="text-sm font-medium text-gray-300">Status</span>
              {statusScopeLabel ? (
                <span className="text-xs font-normal text-gray-500">{statusScopeLabel} tab</span>
              ) : sections.status ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {statusScopeLabel ? (
              <p className="px-2 pb-1 text-xs leading-5 text-gray-500">
                Statuses are set by the {statusScopeLabel} tab.
              </p>
            ) : (
              sections.status && (
                <div id="crm-status-filters" className="space-y-1 mt-2">
                  {LEAD_STATUSES.map((status) => (
                    <label
                      key={status.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filters.statuses.includes(status.id)}
                        onChange={() => toggleStatus(status.id)}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-white focus:ring-white/20 focus:ring-offset-black"
                      />
                      <span className="text-sm text-gray-400">{status.label}</span>
                    </label>
                  ))}
                </div>
              )
            )}
          </div>

          {/* Score Range */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('score')}
              className="flex items-center justify-between w-full py-2 text-left"
            >
              <span className="text-sm font-medium text-gray-300">Lead Score</span>
              {sections.score ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {sections.score && (
              <div className="mt-2 px-2">
                <div className="flex items-center gap-3 mb-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={filters.minScore}
                    aria-label="Minimum lead score"
                    onChange={(e) =>
                      updateScoreRange(
                        'minScore',
                        Number.isNaN(e.currentTarget.valueAsNumber)
                          ? 0
                          : e.currentTarget.valueAsNumber
                      )
                    }
                    className="w-16 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 text-center focus:border-white/20 outline-none"
                  />
                  <span className="text-gray-600">to</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={filters.maxScore}
                    aria-label="Maximum lead score"
                    onChange={(e) =>
                      updateScoreRange(
                        'maxScore',
                        Number.isNaN(e.currentTarget.valueAsNumber)
                          ? 100
                          : e.currentTarget.valueAsNumber
                      )
                    }
                    className="w-16 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 text-center focus:border-white/20 outline-none"
                  />
                </div>
                {/* Range Slider */}
                <div className="relative mt-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={filters.minScore}
                    aria-label="Minimum lead score slider"
                    onChange={(e) => updateScoreRange('minScore', e.currentTarget.valueAsNumber)}
                    className="absolute w-full h-1 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={filters.maxScore}
                    aria-label="Maximum lead score slider"
                    onChange={(e) => updateScoreRange('maxScore', e.currentTarget.valueAsNumber)}
                    className="absolute w-full h-1 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                  <div className="h-1 bg-white/10 rounded">
                    <div
                      className="h-full bg-white/30 rounded"
                      style={{
                        marginLeft: `${filters.minScore}%`,
                        width: `${filters.maxScore - filters.minScore}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Industry Filter */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('industry')}
              className="flex items-center justify-between w-full py-2 text-left"
            >
              <span className="text-sm font-medium text-gray-300">Industry</span>
              {sections.industry ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {sections.industry && (
              <div className="space-y-1 mt-2 max-h-48 overflow-y-auto scrollbar-hidden">
                {INDUSTRY_TYPES.map((industry) => (
                  <label
                    key={industry.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.industries.includes(industry.id)}
                      onChange={() => toggleIndustry(industry.id)}
                      className="w-4 h-4 rounded border-white/20 bg-white/5 text-white focus:ring-white/20 focus:ring-offset-black"
                    />
                    <span className="text-sm text-gray-400">{industry.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Tags Filter */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('tags')}
              className="flex items-center justify-between w-full py-2 text-left"
            >
              <span className="text-sm font-medium text-gray-300">Tags</span>
              {sections.tags ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {sections.tags && (
              <div className="mt-2">
                {tagsLoading ? (
                  <p role="status" className="text-sm text-gray-500 px-2">
                    Loading tags...
                  </p>
                ) : tagsError ? (
                  <div role="alert" className="px-2 text-sm text-gray-500">
                    <p>Failed to load tags</p>
                    <button
                      onClick={() => void refetch()}
                      className="mt-1 text-gray-300 hover:text-white underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
                ) : availableTags.length > 0 ? (
                  <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-hidden">
                    {availableTags.map((tag) => (
                      <label
                        key={tag.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={filters.tags.includes(tag.id)}
                          onChange={() => toggleTag(tag.id)}
                          className="w-4 h-4 rounded border-white/20 bg-white/5 text-white focus:ring-white/20 focus:ring-offset-black"
                        />
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="text-sm text-gray-400">{tag.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 px-2">No tags created yet</p>
                )}
                {onOpenTagManager && (
                  <button
                    onClick={onOpenTagManager}
                    className="flex items-center gap-2 w-full mt-2 px-2 py-1.5 text-sm text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Manage Tags
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Follow-up Filter */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('followUp')}
              className="flex items-center justify-between w-full py-2 text-left"
            >
              <span className="text-sm font-medium text-gray-300">Follow-up</span>
              {sections.followUp ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {sections.followUp && (
              <div className="space-y-1 mt-2">
                {followUpOptions.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => onFiltersChange({ ...filters, followUp: option.id })}
                    className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-sm transition-colors ${
                      filters.followUp === option.id
                        ? 'bg-white/10 text-white'
                        : 'text-gray-400 hover:bg-white/5'
                    }`}
                  >
                    {option.icon && <option.icon className="w-4 h-4" />}
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('sort')}
              className="flex items-center justify-between w-full py-2 text-left"
            >
              <span className="text-sm font-medium text-gray-300">Sort By</span>
              {sections.sort ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            {sections.sort && (
              <div className="mt-2 space-y-2">
                <select
                  value={filters.sortBy}
                  onChange={(e) =>
                    onFiltersChange({
                      ...filters,
                      sortBy: e.target.value as LeadListFilters['sortBy'],
                    })
                  }
                  className="w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 outline-none focus:border-white/20"
                >
                  {sortOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => onFiltersChange({ ...filters, sortOrder: 'asc' })}
                    className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      filters.sortOrder === 'asc'
                        ? 'bg-white/10 border-white/20 text-white'
                        : 'border-white/10 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Ascending
                  </button>
                  <button
                    onClick={() => onFiltersChange({ ...filters, sortOrder: 'desc' })}
                    className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                      filters.sortOrder === 'desc'
                        ? 'bg-white/10 border-white/20 text-white'
                        : 'border-white/10 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    Descending
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
