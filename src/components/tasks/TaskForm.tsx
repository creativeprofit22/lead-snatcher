'use client';

import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { TASK_PRIORITIES, TASK_TYPES } from '@/lib/constants';
import type { Lead, Task, TaskPriority, TaskResponse, TaskType } from '@/types';

interface TaskDraft {
  title: string;
  description: string;
  type: TaskType;
  dueAt: string;
  priority: TaskPriority;
  leadId?: string;
}

interface TaskFormProps {
  task?: Task | null;
  initialLeadId?: string;
  initialLeadName?: string;
  onSaved: (task: Task) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
}

export function formatTaskDateTimeLocal(isoString: string) {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function createTaskDraft(
  task?: Task | null,
  initialLeadId?: string,
  now = new Date()
): TaskDraft {
  if (task) {
    return {
      title: task.title,
      description: task.description ?? '',
      type: task.type,
      dueAt: formatTaskDateTimeLocal(task.dueAt),
      priority: task.priority,
      leadId: task.leadId ?? undefined,
    };
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  return {
    title: '',
    description: '',
    type: 'other',
    dueAt: formatTaskDateTimeLocal(tomorrow.toISOString()),
    priority: 'medium',
    leadId: initialLeadId,
  };
}

export function TaskForm({
  task,
  initialLeadId,
  initialLeadName,
  onSaved,
  onCancel,
  className = 'space-y-4',
}: TaskFormProps) {
  const [draft, setDraft] = useState<TaskDraft>(() => createTaskDraft(task, initialLeadId));
  const [leads, setLeads] = useState<Pick<Lead, 'id' | 'name'>[]>([]);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const formId = useId();
  const isEditing = Boolean(task);

  const resetDraft = () => setDraft(createTaskDraft(task, initialLeadId));

  useEffect(() => {
    setDraft(createTaskDraft(task, initialLeadId));
    setIsSaving(false);
  }, [task, initialLeadId]);

  useEffect(() => {
    let ignoreResponse = false;

    const fetchLeads = async () => {
      setIsLoadingLeads(true);
      try {
        const response = await fetch('/api/leads?sortBy=name&sortOrder=asc');
        if (response.ok && !ignoreResponse) {
          const data = (await response.json()) as { leads: Lead[] };
          setLeads(data.leads.map(({ id, name }) => ({ id, name })));
        }
      } catch {
        if (!ignoreResponse) console.error('Failed to load leads');
      } finally {
        if (!ignoreResponse) setIsLoadingLeads(false);
      }
    };

    void fetchLeads();
    return () => {
      ignoreResponse = true;
    };
  }, []);

  const handleCancel = () => {
    resetDraft();
    onCancel();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;

    if (!draft.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!draft.dueAt) {
      toast.error('Due date is required');
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(isEditing ? `/api/tasks/${task?.id}` : '/api/tasks', {
        method: isEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          type: draft.type,
          dueAt: new Date(draft.dueAt).toISOString(),
          priority: draft.priority,
          leadId: draft.leadId || null,
        }),
      });

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        toast.error(error.error || 'Failed to save task');
        return;
      }

      const data = (await response.json()) as TaskResponse;
      await onSaved(data.task);
      resetDraft();
      toast.success(isEditing ? 'Task updated' : 'Task created');
    } catch {
      toast.error('Failed to save task');
    } finally {
      setIsSaving(false);
    }
  };

  const titleId = `${formId}-title`;
  const descriptionId = `${formId}-description`;
  const typeId = `${formId}-type`;
  const priorityId = `${formId}-priority`;
  const dueAtId = `${formId}-due-at`;
  const leadId = `${formId}-lead`;

  return (
    <form onSubmit={handleSubmit} className={className} aria-busy={isSaving}>
      <div>
        <label htmlFor={titleId} className="block text-sm font-medium text-gray-300 mb-1.5">
          Title
          <span className="text-red-400" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id={titleId}
          type="text"
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder="e.g., Call about proposal"
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 outline-none focus:border-white/20"
          aria-required="true"
          autoFocus
        />
      </div>

      <div>
        <label htmlFor={descriptionId} className="block text-sm font-medium text-gray-300 mb-1.5">
          Description
        </label>
        <textarea
          id={descriptionId}
          value={draft.description}
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
          placeholder="Optional notes..."
          rows={2}
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 outline-none focus:border-white/20 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={typeId} className="block text-sm font-medium text-gray-300 mb-1.5">
            Type
          </label>
          <select
            id={typeId}
            value={draft.type}
            onChange={(event) =>
              setDraft((current) => ({ ...current, type: event.target.value as TaskType }))
            }
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white outline-none focus:border-white/20"
          >
            {TASK_TYPES.map((type) => (
              <option key={type.id} value={type.id} className="bg-zinc-900">
                {type.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={priorityId} className="block text-sm font-medium text-gray-300 mb-1.5">
            Priority
          </label>
          <select
            id={priorityId}
            value={draft.priority}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                priority: event.target.value as TaskPriority,
              }))
            }
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white outline-none focus:border-white/20"
          >
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority.id} value={priority.id} className="bg-zinc-900">
                {priority.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={dueAtId} className="block text-sm font-medium text-gray-300 mb-1.5">
          Due Date
          <span className="text-red-400" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id={dueAtId}
          type="datetime-local"
          value={draft.dueAt}
          onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white outline-none focus:border-white/20 [color-scheme:dark]"
          aria-required="true"
        />
      </div>

      <div>
        <label htmlFor={leadId} className="block text-sm font-medium text-gray-300 mb-1.5">
          Link to Lead
          {initialLeadName && (
            <span className="text-gray-500 font-normal ml-2">(pre-selected)</span>
          )}
        </label>
        <select
          id={leadId}
          value={draft.leadId || ''}
          onChange={(event) =>
            setDraft((current) => ({ ...current, leadId: event.target.value || undefined }))
          }
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white outline-none focus:border-white/20"
          disabled={isLoadingLeads}
        >
          <option value="" className="bg-zinc-900">
            No lead (standalone task)
          </option>
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id} className="bg-zinc-900">
              {lead.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={handleCancel}
          className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : isEditing ? 'Update Task' : 'Create Task'}
        </button>
      </div>
    </form>
  );
}
