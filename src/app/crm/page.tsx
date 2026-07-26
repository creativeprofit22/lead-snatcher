'use client';

import { useState, useSyncExternalStore, useCallback, useMemo } from 'react';
import { Filter } from 'lucide-react';
import { toast } from 'sonner';
import {
  CRMLayout,
  CRMHeader,
  CRMTabs,
  TabsContent,
  MetricsRow,
  TasksWidget,
  LeadsTable,
  KanbanBoard,
  FilterSidebar,
  TagManager,
  BulkActions,
} from '@/components/crm';
import type { TabValue, ViewMode } from '@/components/crm';
import { LeadDetailModal } from '@/components/leads';
import { patchLeadEditableFields } from '@/components/leads/LeadDetailModal.client';
import { TaskSlideOver } from '@/components/tasks';
import type { CrmTagMutation } from '@/lib/crm-tags-client';
import { useCrmTags } from '@/lib/hooks/useCrmTags';
import { useCrmLeadsController } from '@/lib/hooks/useCrmLeadsController';
import { CrmTasksProvider } from '@/lib/hooks/useCrmTasks';
import { useVisibleLeadSelection } from '@/lib/hooks/useVisibleLeadSelection';
import { LEAD_STATUS_METADATA, PIPELINE_LEAD_STATUS_VALUES } from '@/lib/lead-status';
import {
  defaultLeadListQuery,
  hasActiveLeadListFilters,
  type LeadListFilters,
  type LeadListUiSortField,
} from '@/lib/crm-lead-query';
import type { Lead, LeadStatus } from '@/types';

// LocalStorage key for view preference
const VIEW_MODE_KEY = 'crm-view-mode';
const VIEW_MODE_CHANGE_EVENT = 'crm-view-mode-change';

function getStoredViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'list';

  const savedViewMode = localStorage.getItem(VIEW_MODE_KEY);
  return savedViewMode === 'kanban' ? 'kanban' : 'list';
}

function subscribeToStoredViewMode(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(VIEW_MODE_CHANGE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(VIEW_MODE_CHANGE_EVENT, onStoreChange);
  };
}

const TAB_STATUS_SCOPES: Partial<Record<TabValue, { label: string; statuses: LeadStatus[] }>> = {
  won: { label: 'Won', statuses: ['won'] },
  lost: { label: 'Lost', statuses: ['lost'] },
  pipeline: { label: 'Pipeline', statuses: PIPELINE_LEAD_STATUS_VALUES },
};

function getEffectiveLeadListQuery(filters: LeadListFilters, activeTab: TabValue): LeadListFilters {
  const statusScope = TAB_STATUS_SCOPES[activeTab];

  return statusScope ? { ...filters, statuses: [...statusScope.statuses] } : filters;
}

export default function CRMPage() {
  return (
    <CrmTasksProvider>
      <CRMPageContent />
    </CrmTasksProvider>
  );
}

function CRMPageContent() {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabValue>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // View mode state with LocalStorage persistence
  const viewMode = useSyncExternalStore<ViewMode>(
    subscribeToStoredViewMode,
    getStoredViewMode,
    () => 'list'
  );

  const tagCatalog = useCrmTags();

  // Filter state
  const [filters, setFilters] = useState<LeadListFilters>(defaultLeadListQuery);
  const [isFilterSidebarOpen, setIsFilterSidebarOpen] = useState(false);
  const statusScope = TAB_STATUS_SCOPES[activeTab];
  const effectiveQuery = useMemo(
    () => getEffectiveLeadListQuery(filters, activeTab),
    [activeTab, filters]
  );
  const {
    leads,
    leadsLoading: isLoading,
    leadsError,
    stats,
    statsLoading,
    statsError,
    refreshLeads: fetchLeads,
    refreshLeadsForQuery: fetchLeadsForQuery,
    refreshStats: fetchStats,
    replaceLead,
    setLeadStatus,
    removeLeadIds,
  } = useCrmLeadsController(effectiveQuery);
  const hasActiveFilters = hasActiveLeadListFilters(filters);

  // Modal state
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [isTaskSlideOverOpen, setIsTaskSlideOverOpen] = useState(false);
  const displayedSelectedLead = selectedLead
    ? (leads.find((lead) => lead.id === selectedLead.id) ?? selectedLead)
    : null;

  // Filter leads by search query
  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads;

    const query = searchQuery.toLowerCase();
    return leads.filter(
      (lead) =>
        lead.name.toLowerCase().includes(query) ||
        lead.address?.toLowerCase().includes(query) ||
        lead.phone?.toLowerCase().includes(query) ||
        lead.notes?.toLowerCase().includes(query)
    );
  }, [leads, searchQuery]);
  const visibleLeadIds = useMemo(() => filteredLeads.map((lead) => lead.id), [filteredLeads]);
  const selection = useVisibleLeadSelection(visibleLeadIds, viewMode === 'list' && !isLoading);

  // View, tab, and server-filter changes create a new result scope.
  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      if (mode !== viewMode) selection.clearAll();
      localStorage.setItem(VIEW_MODE_KEY, mode);
      window.dispatchEvent(new Event(VIEW_MODE_CHANGE_EVENT));
    },
    [selection, viewMode]
  );

  const handleTabChange = useCallback(
    (tab: TabValue) => {
      selection.clearAll();
      setActiveTab(tab);
      if (TAB_STATUS_SCOPES[tab]) {
        setFilters((currentFilters) =>
          currentFilters.statuses.length > 0 ? { ...currentFilters, statuses: [] } : currentFilters
        );
      }
    },
    [selection]
  );

  const handleFiltersChange = useCallback(
    (nextFilters: LeadListFilters) => {
      selection.clearAll();
      setFilters(nextFilters);
    },
    [selection]
  );

  // Calculate metrics
  const metrics = useMemo(() => {
    const total = stats?.total || 0;
    const won = stats?.byStatus?.won || 0;
    const inProgress = PIPELINE_LEAD_STATUS_VALUES.reduce(
      (count, status) => count + (stats?.byStatus?.[status] || 0),
      0
    );
    const conversionRate = stats?.conversionRate || 0;
    return { total, won, inProgress, conversionRate };
  }, [stats]);

  // Delete lead
  const handleDeleteLead = async (leadId: string) => {
    try {
      const response = await fetch(`/api/leads/${leadId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        selection.removeIds([leadId]);
        removeLeadIds([leadId]);
        await Promise.all([fetchStats(), tagCatalog.refetch()]);
        toast.success('Lead deleted');
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    }
  };

  // Handle lead click
  const handleLeadClick = (lead: Lead) => {
    setSelectedLead(lead);
  };

  // Update lead from modal
  const handleLeadUpdate = (updatedLead: Lead) => {
    const currentLead =
      displayedSelectedLead?.id === updatedLead.id
        ? displayedSelectedLead
        : leads.find((lead) => lead.id === updatedLead.id);
    const statusChanged = currentLead?.status !== updatedLead.status;

    replaceLead(updatedLead);
    setSelectedLead(updatedLead);

    if (statusChanged) {
      void Promise.all([fetchLeads(), fetchStats()]);
    }
  };

  const handleBulkUpdate = useCallback(async () => {
    await Promise.all([fetchLeads(), fetchStats(), tagCatalog.refetch()]);
  }, [fetchLeads, fetchStats, tagCatalog]);

  const handleTagMutation = useCallback(
    async (mutation: CrmTagMutation) => {
      const nextFilters =
        mutation.type === 'deleted' && filters.tags.includes(mutation.tagId)
          ? { ...filters, tags: filters.tags.filter((tagId) => tagId !== mutation.tagId) }
          : filters;

      // Commit filter cleanup before issuing the authoritative leads refresh.
      if (nextFilters !== filters) {
        selection.clearAll();
        setFilters(nextFilters);
      }

      await Promise.all([
        tagCatalog.refetch(),
        fetchLeadsForQuery(getEffectiveLeadListQuery(nextFilters, activeTab)),
      ]);
    },
    [activeTab, fetchLeadsForQuery, filters, selection, tagCatalog]
  );

  // Handle sort change from table header
  const handleSortChange = useCallback(
    (field: LeadListUiSortField) => {
      selection.clearAll();
      setFilters((prev) => ({
        ...prev,
        sortBy: field,
        sortOrder: prev.sortBy === field && prev.sortOrder === 'desc' ? 'asc' : 'desc',
      }));
    },
    [selection]
  );

  // Bulk actions can only receive records from the current visible list result.
  const selectedLeads = useMemo(() => {
    return filteredLeads.filter((lead) => selection.selectedIds.has(lead.id));
  }, [filteredLeads, selection.selectedIds]);

  const handleBulkDelete = useCallback(
    (deletedLeadIds: readonly string[]) => {
      selection.removeIds(deletedLeadIds);
      removeLeadIds(deletedLeadIds);
    },
    [removeLeadIds, selection]
  );

  // Handle status change from Kanban drag & drop
  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    const previousLead = leads.find((lead) => lead.id === leadId);

    // Optimistically update UI while retaining the previous DTO for rollback.
    setLeadStatus(leadId, newStatus);
    setSelectedLead((current) =>
      current?.id === leadId ? { ...current, status: newStatus } : current
    );

    try {
      const updatedLead = await patchLeadEditableFields(leadId, { status: newStatus });
      replaceLead(updatedLead);
      setSelectedLead((current) => (current?.id === leadId ? updatedLead : current));

      await Promise.all([fetchLeads(), fetchStats()]);
      toast.success(`Status updated to ${LEAD_STATUS_METADATA[newStatus].label}`);
    } catch {
      if (previousLead) {
        replaceLead(previousLead);
        setSelectedLead((current) => (current?.id === leadId ? previousLead : current));
      }

      void fetchLeads();
      toast.error('Failed to update status');
    }
  };

  return (
    <CRMLayout>
      {/* Header */}
      <CRMHeader
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenTaskSlideOver={() => setIsTaskSlideOverOpen(true)}
      />

      {/* Tabs */}
      <div className="mt-6">
        <CRMTabs activeTab={activeTab} onTabChange={handleTabChange}>
          <TabsContent value={activeTab} className="mt-6">
            {/* Metrics */}
            {statsError ? (
              <div
                role="alert"
                className="mb-6 rounded-lg border border-white/15 bg-card p-4 text-sm text-gray-300"
              >
                <p>Couldn&apos;t load CRM metrics.</p>
                <button
                  type="button"
                  onClick={() => void fetchStats()}
                  className="mt-2 font-medium text-white underline underline-offset-4 hover:text-gray-200"
                >
                  Retry metrics
                </button>
              </div>
            ) : (
              <MetricsRow
                total={metrics.total}
                inProgress={metrics.inProgress}
                won={metrics.won}
                conversionRate={metrics.conversionRate}
                isLoading={statsLoading && !stats}
              />
            )}

            {/* Tasks Widget - Due Today */}
            <TasksWidget onOpenSlideOver={() => setIsTaskSlideOverOpen(true)} />

            {/* Mobile Filter Button */}
            <div className="lg:hidden mb-4">
              <button
                type="button"
                onClick={() => setIsFilterSidebarOpen(true)}
                aria-expanded={isFilterSidebarOpen}
                aria-controls="crm-filter-sidebar"
                className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white hover:bg-white/10 transition-colors"
              >
                <Filter className="w-4 h-4" />
                Filters
                {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-white/50" />}
              </button>
            </div>

            {/* Content with Sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div className="lg:col-span-3">
                {searchQuery && (
                  <div className="text-sm text-gray-500 mb-4">
                    Showing {filteredLeads.length} of {leads.length} leads
                  </div>
                )}
                {leadsError ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-white/15 bg-card p-5 text-sm text-gray-300"
                  >
                    <p>Couldn&apos;t load leads for these filters.</p>
                    <button
                      type="button"
                      onClick={() => void fetchLeads()}
                      className="mt-2 font-medium text-white underline underline-offset-4 hover:text-gray-200"
                    >
                      Retry leads
                    </button>
                  </div>
                ) : viewMode === 'kanban' ? (
                  <KanbanBoard
                    leads={filteredLeads}
                    isLoading={isLoading}
                    onLeadClick={handleLeadClick}
                    onDelete={handleDeleteLead}
                    onStatusChange={handleStatusChange}
                  />
                ) : (
                  <LeadsTable
                    leads={filteredLeads}
                    isLoading={isLoading}
                    onLeadClick={handleLeadClick}
                    onDelete={handleDeleteLead}
                    selectedLeadIds={selection.selectedIds}
                    onToggleSelect={selection.toggle}
                    onSelectAllVisible={selection.selectAllVisible}
                    onDeselectVisible={selection.deselectVisible}
                    sortBy={filters.sortBy}
                    sortOrder={filters.sortOrder}
                    onSortChange={handleSortChange}
                  />
                )}
              </div>

              <div className="lg:col-span-1">
                <FilterSidebar
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  isOpen={isFilterSidebarOpen}
                  onClose={() => setIsFilterSidebarOpen(false)}
                  leadCount={filteredLeads.length}
                  statusScopeLabel={statusScope?.label}
                  onOpenTagManager={() => setIsTagManagerOpen(true)}
                  tagCatalog={tagCatalog}
                />
              </div>
            </div>
          </TabsContent>
        </CRMTabs>
      </div>

      {/* Lead Detail Modal */}
      <LeadDetailModal
        lead={displayedSelectedLead}
        isOpen={!!displayedSelectedLead}
        onClose={() => setSelectedLead(null)}
        onUpdate={handleLeadUpdate}
      />

      {/* Tag Manager Modal */}
      <TagManager
        isOpen={isTagManagerOpen}
        onClose={() => setIsTagManagerOpen(false)}
        tagCatalog={tagCatalog}
        onMutation={handleTagMutation}
      />

      {/* Task SlideOver */}
      <TaskSlideOver isOpen={isTaskSlideOverOpen} onClose={() => setIsTaskSlideOverOpen(false)} />

      {/* Bulk Actions */}
      {selectedLeads.length > 0 && (
        <BulkActions
          selectedLeads={selectedLeads}
          onClearSelection={selection.clearAll}
          onBulkUpdate={handleBulkUpdate}
          onBulkDelete={handleBulkDelete}
          tagCatalog={tagCatalog}
        />
      )}
    </CRMLayout>
  );
}
