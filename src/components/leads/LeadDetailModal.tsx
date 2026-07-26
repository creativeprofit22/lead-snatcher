'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Phone, Globe, MapPin, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { LeadScoreBadge } from './LeadScoreBadge';
import { StatusBadge } from '@/components/crm';
import { parseFollowUpDate, serializeFollowUpInputToIso } from './LeadDetailModal.dates';
import {
  createLeadContactLog,
  deleteLeadTask,
  fetchAllLeadTasks,
  fetchLeadContactLogs,
  patchLeadEditableFields,
  setLeadTaskCompletion,
} from './LeadDetailModal.client';
import {
  LeadActivityTabView,
  LeadDetailsTabView,
  LeadDetailTabBar,
  LeadNotesTabView,
  LeadTasksTabView,
  type LeadDetailTabId,
} from './LeadDetailModal.tabs';
import { useCrmTasks } from '@/lib/hooks/useCrmTasks';
import type { Lead, LeadStatus, ContactLogEntry, Task } from '@/types';

interface LeadDetailModalProps {
  lead: Lead | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedLead: Lead) => void;
}

export function LeadDetailModal({ lead, isOpen, onClose, onUpdate }: LeadDetailModalProps) {
  const [activeTab, setActiveTab] = useState<LeadDetailTabId>('details');
  const [contactLogs, setContactLogs] = useState<ContactLogEntry[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const contactLogsRequestVersion = useRef(0);
  const [notes, setNotes] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [isSavingFollowUp, setIsSavingFollowUp] = useState(false);

  // New contact log form
  const [showAddLog, setShowAddLog] = useState(false);
  const [newLogType, setNewLogType] = useState('call');
  const [newLogSummary, setNewLogSummary] = useState('');
  const [newLogOutcome, setNewLogOutcome] = useState('neutral');
  const [isAddingLog, setIsAddingLog] = useState(false);

  // Tasks
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const tasksRequestVersion = useRef(0);
  const { invalidate: invalidateCrmTasks } = useCrmTasks();

  // Load contact logs
  const fetchContactLogs = useCallback(async () => {
    if (!lead) return;

    const requestVersion = ++contactLogsRequestVersion.current;
    setIsLoadingLogs(true);
    try {
      const result = await fetchLeadContactLogs(lead.id);
      if (result.successful && requestVersion === contactLogsRequestVersion.current) {
        setContactLogs(result.data);
      }
    } catch {
      if (requestVersion === contactLogsRequestVersion.current) {
        console.error('Failed to fetch contact logs');
      }
    } finally {
      if (requestVersion === contactLogsRequestVersion.current) {
        setIsLoadingLogs(false);
      }
    }
  }, [lead]);

  // Load tasks for this lead
  const fetchTasks = useCallback(async () => {
    if (!lead) return;

    const requestVersion = ++tasksRequestVersion.current;
    setIsLoadingTasks(true);
    try {
      const result = await fetchAllLeadTasks(lead.id);
      if (result.successful && requestVersion === tasksRequestVersion.current) {
        setTasks(result.data);
      }
    } catch {
      if (requestVersion === tasksRequestVersion.current) {
        console.error('Failed to fetch tasks');
      }
    } finally {
      if (requestVersion === tasksRequestVersion.current) {
        setIsLoadingTasks(false);
      }
    }
  }, [lead]);

  // Initialize state when lead changes
  useEffect(() => {
    if (lead && isOpen) {
      setNotes(lead.notes || '');
      setFollowUpDate(parseFollowUpDate(lead.nextFollowUpAt)?.inputValue ?? '');
      void fetchContactLogs();
      void fetchTasks();
    }

    return () => {
      contactLogsRequestVersion.current += 1;
      tasksRequestVersion.current += 1;
    };
  }, [lead, isOpen, fetchContactLogs, fetchTasks]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen || !lead) return null;

  const nextFollowUpDate = parseFollowUpDate(lead.nextFollowUpAt);

  // Update status
  const handleUpdateStatus = async (status: LeadStatus) => {
    try {
      const updatedLead = await patchLeadEditableFields(lead.id, { status });
      onUpdate(updatedLead);
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    }
  };

  // Save notes
  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      const updatedLead = await patchLeadEditableFields(lead.id, { notes });
      onUpdate(updatedLead);
      toast.success('Notes saved');
    } catch {
      toast.error('Failed to save notes');
    } finally {
      setIsSavingNotes(false);
    }
  };

  // Save follow-up date
  const handleSaveFollowUp = async () => {
    setIsSavingFollowUp(true);
    const nextFollowUpAt = serializeFollowUpInputToIso(followUpDate);
    try {
      const updatedLead = await patchLeadEditableFields(lead.id, { nextFollowUpAt });
      onUpdate(updatedLead);
      toast.success(followUpDate ? 'Follow-up set' : 'Follow-up cleared');
    } catch {
      toast.error('Failed to save follow-up');
    } finally {
      setIsSavingFollowUp(false);
    }
  };

  // Add contact log
  const handleAddLog = async () => {
    if (!newLogSummary.trim()) {
      toast.error('Please enter a summary');
      return;
    }
    setIsAddingLog(true);
    try {
      const result = await createLeadContactLog(lead.id, {
        type: newLogType as ContactLogEntry['type'],
        summary: newLogSummary,
        outcome: newLogOutcome as ContactLogEntry['outcome'],
      });
      if (result.successful) {
        setContactLogs((prev) => [result.data, ...prev]);
        setNewLogSummary('');
        setShowAddLog(false);
        onUpdate({ ...lead, lastContactedAt: new Date().toISOString() });
        toast.success('Contact log added');
      }
    } catch {
      toast.error('Failed to add contact log');
    } finally {
      setIsAddingLog(false);
    }
  };

  // Task handlers
  const handleTaskComplete = async (taskId: string, completed: boolean) => {
    try {
      const completedAt = completed ? new Date().toISOString() : null;
      await setLeadTaskCompletion(taskId, completedAt);
      await Promise.all([fetchTasks(), invalidateCrmTasks()]);
      toast.success(completed ? 'Task completed' : 'Task reopened');
    } catch (error) {
      toast.error(completed ? 'Failed to complete task' : 'Failed to reopen task');
      throw error;
    }
  };

  const handleTaskEdit = (task: Task) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleTaskDelete = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      const result = await deleteLeadTask(taskId);
      if (!result.successful) {
        throw new Error('Task deletion request failed');
      }

      await Promise.all([fetchTasks(), invalidateCrmTasks()]);
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  };

  const handleTaskSave = async () => {
    await Promise.all([fetchTasks(), invalidateCrmTasks()]);
    setEditingTask(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Slide-over Panel */}
      <div className="relative h-full w-full max-w-2xl bg-black border-l border-white/10 shadow-2xl animate-in slide-in-from-right duration-300 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-white/10 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-xl font-semibold text-gray-200 truncate">{lead.name}</h2>
                <StatusBadge status={lead.status} />
              </div>
              {lead.address && (
                <p className="text-sm text-gray-500 flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  {lead.address}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <LeadScoreBadge score={lead.leadScore} />
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-white transition-colors p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2 mt-4">
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-300 text-sm hover:bg-white/10 transition-colors"
              >
                <Phone className="w-4 h-4" />
                {lead.phone}
              </a>
            )}
            {lead.website && (
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-300 text-sm hover:bg-white/10 transition-colors"
              >
                <Globe className="w-4 h-4" />
                Website
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {lead.mapsUrl && (
              <a
                href={lead.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-gray-300 text-sm hover:bg-white/10 transition-colors"
              >
                <MapPin className="w-4 h-4" />
                Maps
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {/* Tabs */}
        <LeadDetailTabBar
          activeTab={activeTab}
          contactCount={contactLogs.length}
          openTaskCount={tasks.filter((task) => !task.completedAt).length}
          onTabChange={setActiveTab}
        />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Details Tab */}
          {activeTab === 'details' && (
            <LeadDetailsTabView
              lead={lead}
              followUpDate={followUpDate}
              nextFollowUpDisplayValue={nextFollowUpDate?.displayValue ?? null}
              isSavingFollowUp={isSavingFollowUp}
              onStatusChange={handleUpdateStatus}
              onFollowUpDateChange={setFollowUpDate}
              onSaveFollowUp={handleSaveFollowUp}
            />
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <LeadActivityTabView
              contactLogs={contactLogs}
              isLoadingLogs={isLoadingLogs}
              showAddLog={showAddLog}
              newLogType={newLogType}
              newLogSummary={newLogSummary}
              newLogOutcome={newLogOutcome}
              isAddingLog={isAddingLog}
              onShowAddLogChange={setShowAddLog}
              onNewLogTypeChange={setNewLogType}
              onNewLogSummaryChange={setNewLogSummary}
              onNewLogOutcomeChange={setNewLogOutcome}
              onAddLog={handleAddLog}
            />
          )}

          {/* Tasks Tab */}
          {activeTab === 'tasks' && (
            <LeadTasksTabView
              lead={lead}
              tasks={tasks}
              isLoadingTasks={isLoadingTasks}
              isTaskModalOpen={isTaskModalOpen}
              editingTask={editingTask}
              onAddTask={() => {
                setEditingTask(null);
                setIsTaskModalOpen(true);
              }}
              onTaskComplete={handleTaskComplete}
              onTaskEdit={handleTaskEdit}
              onTaskDelete={handleTaskDelete}
              onTaskModalClose={() => {
                setIsTaskModalOpen(false);
                setEditingTask(null);
              }}
              onTaskSave={handleTaskSave}
            />
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <LeadNotesTabView
              notes={notes}
              savedNotes={lead.notes}
              isSavingNotes={isSavingNotes}
              onNotesChange={setNotes}
              onSaveNotes={handleSaveNotes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
