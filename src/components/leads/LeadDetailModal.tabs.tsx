'use client';

import {
  Calendar,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Star,
  StickyNote,
  Users,
  X,
} from 'lucide-react';

import { TaskList, TaskModal } from '@/components/tasks';
import { CONTACT_TYPES, OUTCOMES } from '@/lib/constants';
import type { ContactLogEntry, Lead, LeadStatus, Task } from '@/types';
import { formatLeadDetailTimestamp } from './LeadDetailModal.dates';
import { OpportunitiesList } from './OpportunitiesList';
import { StatusSelector } from './StatusSelector';

export type LeadDetailTabId = 'details' | 'activity' | 'tasks' | 'notes';

interface LeadDetailTabBarProps {
  activeTab: LeadDetailTabId;
  contactCount: number;
  openTaskCount: number;
  onTabChange: (tab: LeadDetailTabId) => void;
}

export function LeadDetailTabBar({
  activeTab,
  contactCount,
  openTaskCount,
  onTabChange,
}: LeadDetailTabBarProps) {
  return (
    <div className="flex-shrink-0 border-b border-white/10">
      <div className="flex">
        {(['details', 'activity', 'tasks', 'notes'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'text-white border-b-2 border-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab === 'details' && 'Details'}
            {tab === 'activity' && `Contacts (${contactCount})`}
            {tab === 'tasks' && `Tasks (${openTaskCount})`}
            {tab === 'notes' && 'Notes'}
          </button>
        ))}
      </div>
    </div>
  );
}

interface LeadDetailsTabViewProps {
  lead: Lead;
  followUpDate: string;
  nextFollowUpDisplayValue: string | null;
  isSavingFollowUp: boolean;
  onStatusChange: (status: LeadStatus) => void;
  onFollowUpDateChange: (value: string) => void;
  onSaveFollowUp: () => void;
}

export function LeadDetailsTabView({
  lead,
  followUpDate,
  nextFollowUpDisplayValue,
  isSavingFollowUp,
  onStatusChange,
  onFollowUpDateChange,
  onSaveFollowUp,
}: LeadDetailsTabViewProps) {
  return (
    <div className="space-y-6">
      {/* Status */}
      <div>
        <label className="text-xs text-gray-500 mb-2 block">Status</label>
        <StatusSelector value={lead.status} onChange={onStatusChange} />
      </div>

      {/* Follow-up */}
      <div>
        <label className="text-xs text-gray-500 mb-2 block">Follow-up Date</label>
        <div className="flex gap-2">
          <input
            type="date"
            value={followUpDate}
            onChange={(event) => onFollowUpDateChange(event.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-white/20"
          />
          <button
            onClick={onSaveFollowUp}
            disabled={isSavingFollowUp}
            className="px-4 py-2 rounded-lg border border-white/20 bg-white/5 text-gray-200 text-sm font-medium hover:bg-white/10 disabled:opacity-50 transition-colors"
          >
            {isSavingFollowUp ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set'}
          </button>
        </div>
        {nextFollowUpDisplayValue && (
          <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Currently set: {nextFollowUpDisplayValue}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {lead.rating && (
          <div className="bg-white/[0.02] border border-white/10 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Rating</p>
            <p className="text-lg font-semibold text-gray-200 flex items-center gap-1">
              <Star className="w-5 h-5 text-yellow-500" />
              {lead.rating.toFixed(1)}
            </p>
          </div>
        )}
        {lead.reviewCount !== undefined && (
          <div className="bg-white/[0.02] border border-white/10 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">Reviews</p>
            <p className="text-lg font-semibold text-gray-200 flex items-center gap-1">
              <MessageSquare className="w-5 h-5 text-gray-400" />
              {lead.reviewCount}
            </p>
          </div>
        )}
      </div>

      {/* Timestamps */}
      <div className="bg-white/[0.02] border border-white/10 rounded-lg p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Saved</span>
          <span className="text-gray-300">{formatLeadDetailTimestamp(lead.savedAt)}</span>
        </div>
        {lead.lastContactedAt && (
          <div className="flex justify-between">
            <span className="text-gray-500">Last Contacted</span>
            <span className="text-gray-300">{formatLeadDetailTimestamp(lead.lastContactedAt)}</span>
          </div>
        )}
      </div>

      {/* Opportunities */}
      {lead.opportunities && lead.opportunities.length > 0 && (
        <div>
          <OpportunitiesList opportunities={lead.opportunities} maxVisible={10} />
        </div>
      )}
    </div>
  );
}

interface LeadActivityTabViewProps {
  contactLogs: ContactLogEntry[];
  isLoadingLogs: boolean;
  showAddLog: boolean;
  newLogType: string;
  newLogSummary: string;
  newLogOutcome: string;
  isAddingLog: boolean;
  onShowAddLogChange: (show: boolean) => void;
  onNewLogTypeChange: (type: string) => void;
  onNewLogSummaryChange: (summary: string) => void;
  onNewLogOutcomeChange: (outcome: string) => void;
  onAddLog: () => void;
}

function getContactIcon(type: string) {
  switch (type) {
    case 'call':
      return <Phone className="w-4 h-4" />;
    case 'email':
      return <Mail className="w-4 h-4" />;
    case 'meeting':
      return <Users className="w-4 h-4" />;
    case 'note':
      return <StickyNote className="w-4 h-4" />;
    default:
      return <MessageSquare className="w-4 h-4" />;
  }
}

function getOutcomeColor(outcome?: string) {
  switch (outcome) {
    case 'positive':
      return 'text-green-400';
    case 'negative':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

export function LeadActivityTabView({
  contactLogs,
  isLoadingLogs,
  showAddLog,
  newLogType,
  newLogSummary,
  newLogOutcome,
  isAddingLog,
  onShowAddLogChange,
  onNewLogTypeChange,
  onNewLogSummaryChange,
  onNewLogOutcomeChange,
  onAddLog,
}: LeadActivityTabViewProps) {
  return (
    <div className="space-y-4">
      {/* Add Log Button */}
      {!showAddLog ? (
        <button
          onClick={() => onShowAddLogChange(true)}
          className="w-full py-3 rounded-lg border border-dashed border-white/20 text-gray-500 text-sm hover:border-white/30 hover:text-gray-300 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Contact Log
        </button>
      ) : (
        /* Add Log Form */
        <div className="bg-white/[0.02] border border-white/10 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-200">New Contact Log</h4>
            <button
              onClick={() => onShowAddLogChange(false)}
              className="text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Type</label>
              <select
                value={newLogType}
                onChange={(event) => onNewLogTypeChange(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-white/20"
              >
                {CONTACT_TYPES.map((type) => (
                  <option key={type.id} value={type.id} className="bg-black">
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Outcome</label>
              <select
                value={newLogOutcome}
                onChange={(event) => onNewLogOutcomeChange(event.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-white/20"
              >
                {OUTCOMES.map((outcome) => (
                  <option key={outcome.id} value={outcome.id} className="bg-black">
                    {outcome.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Summary</label>
            <textarea
              value={newLogSummary}
              onChange={(event) => onNewLogSummaryChange(event.target.value)}
              placeholder="What happened?"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none resize-none focus:border-white/20 placeholder-gray-600"
            />
          </div>

          <button
            onClick={onAddLog}
            disabled={isAddingLog || !newLogSummary.trim()}
            className="w-full py-2 rounded-lg border border-white/20 bg-white/5 text-gray-200 text-sm font-medium hover:bg-white/10 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isAddingLog ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                Add Log
              </>
            )}
          </button>
        </div>
      )}

      {/* Contact Logs List */}
      {isLoadingLogs ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        </div>
      ) : contactLogs.length === 0 ? (
        <div className="text-center py-8 text-gray-600">
          <MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>No contact history yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {contactLogs.map((log) => (
            <div key={log.id} className="bg-white/[0.02] border border-white/10 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg bg-white/5 ${getOutcomeColor(log.outcome)}`}>
                  {getContactIcon(log.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-200 capitalize">{log.type}</span>
                    {log.outcome && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          log.outcome === 'positive'
                            ? 'border-green-500/30 text-green-400'
                            : log.outcome === 'negative'
                              ? 'border-red-500/30 text-red-400'
                              : 'border-white/10 text-gray-500'
                        }`}
                      >
                        {log.outcome}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400">{log.summary}</p>
                  <p className="text-xs text-gray-600 mt-2 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {formatLeadDetailTimestamp(log.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface LeadTasksTabViewProps {
  lead: Lead;
  tasks: Task[];
  isLoadingTasks: boolean;
  isTaskModalOpen: boolean;
  editingTask: Task | null;
  onAddTask: () => void;
  onTaskComplete: (taskId: string, completed: boolean) => Promise<void>;
  onTaskEdit: (task: Task) => void;
  onTaskDelete: (taskId: string) => void;
  onTaskModalClose: () => void;
  onTaskSave: (task: Task) => void | Promise<void>;
}

export function LeadTasksTabView({
  lead,
  tasks,
  isLoadingTasks,
  isTaskModalOpen,
  editingTask,
  onAddTask,
  onTaskComplete,
  onTaskEdit,
  onTaskDelete,
  onTaskModalClose,
  onTaskSave,
}: LeadTasksTabViewProps) {
  return (
    <div className="space-y-4">
      {/* Add Task Button */}
      <button
        onClick={onAddTask}
        className="w-full py-3 rounded-lg border border-dashed border-white/20 text-gray-500 text-sm hover:border-white/30 hover:text-gray-300 transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="w-4 h-4" />
        Add Task for {lead.name}
      </button>

      {/* Task List */}
      <TaskList
        tasks={tasks}
        isLoading={isLoadingTasks}
        onComplete={onTaskComplete}
        onEdit={onTaskEdit}
        onDelete={onTaskDelete}
        showCompleted={true}
      />

      {/* Task Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={onTaskModalClose}
        onSave={onTaskSave}
        task={editingTask}
        leadId={lead.id}
        leadName={lead.name}
      />
    </div>
  );
}

interface LeadNotesTabViewProps {
  notes: string;
  savedNotes: Lead['notes'];
  isSavingNotes: boolean;
  onNotesChange: (notes: string) => void;
  onSaveNotes: () => void;
}

export function LeadNotesTabView({
  notes,
  savedNotes,
  isSavingNotes,
  onNotesChange,
  onSaveNotes,
}: LeadNotesTabViewProps) {
  return (
    <div className="space-y-4">
      <textarea
        value={notes}
        onChange={(event) => onNotesChange(event.target.value)}
        placeholder="Add notes about this lead..."
        rows={12}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-gray-200 outline-none resize-none focus:border-white/20 placeholder-gray-600"
      />
      <button
        onClick={onSaveNotes}
        disabled={isSavingNotes || notes === (savedNotes || '')}
        className="w-full py-3 rounded-lg border border-white/20 bg-white/5 text-gray-200 text-sm font-medium hover:bg-white/10 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
      >
        {isSavingNotes ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <StickyNote className="w-4 h-4" />
            Save Notes
          </>
        )}
      </button>
    </div>
  );
}
