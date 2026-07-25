'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ListTodo, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCrmTasks } from '@/lib/hooks/useCrmTasks';
import type { Task } from '@/types';
import { TaskForm } from './TaskForm';
import { TaskList } from './TaskList';

interface TaskSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  initialLeadId?: string;
  initialLeadName?: string;
}

export function TaskSlideOver({
  isOpen,
  onClose,
  initialLeadId,
  initialLeadName,
}: TaskSlideOverProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const tasksRequestVersion = useRef(0);
  const panelTitleId = useId();
  const formTitleId = useId();
  const { invalidate: invalidateCrmTasks } = useCrmTasks();

  const fetchTasks = useCallback(async () => {
    const requestVersion = ++tasksRequestVersion.current;
    setIsLoading(true);
    try {
      const url = initialLeadId
        ? `/api/tasks?leadId=${initialLeadId}&status=all`
        : '/api/tasks?status=all';
      const response = await fetch(url);
      if (response.ok && requestVersion === tasksRequestVersion.current) {
        const data = (await response.json()) as { tasks?: Task[] };
        if (requestVersion === tasksRequestVersion.current) {
          setTasks(data.tasks || []);
        }
      }
    } catch {
      if (requestVersion === tasksRequestVersion.current) {
        console.error('Failed to fetch tasks');
      }
    } finally {
      if (requestVersion === tasksRequestVersion.current) {
        setIsLoading(false);
      }
    }
  }, [initialLeadId]);

  const closeEditor = useCallback(() => {
    setShowForm(false);
    setEditingTask(null);
  }, []);

  const handleClose = useCallback(() => {
    closeEditor();
    onClose();
  }, [closeEditor, onClose]);

  useEffect(() => {
    if (isOpen) {
      void fetchTasks();
    } else {
      closeEditor();
    }

    return () => {
      tasksRequestVersion.current += 1;
    };
  }, [isOpen, fetchTasks, closeEditor]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleClose]);

  const handleSaved = async () => {
    await Promise.all([fetchTasks(), invalidateCrmTasks()]);
    closeEditor();
  };

  const handleComplete = async (taskId: string, completed: boolean) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completedAt: completed ? new Date().toISOString() : null,
        }),
      });

      if (!response.ok) {
        throw new Error('Task completion request failed');
      }

      await Promise.all([fetchTasks(), invalidateCrmTasks()]);
      toast.success(completed ? 'Task completed' : 'Task reopened');
    } catch (error) {
      toast.error(completed ? 'Failed to complete task' : 'Failed to reopen task');
      throw error;
    }
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setShowForm(true);
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Task deletion request failed');
      }

      await Promise.all([fetchTasks(), invalidateCrmTasks()]);
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  };

  const handleNewTask = () => {
    setEditingTask(null);
    setShowForm(true);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
        data-testid="task-slide-over-backdrop"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={panelTitleId}
        className="relative h-full w-full max-w-xl bg-black border-l border-white/10 shadow-2xl animate-in slide-in-from-right duration-300 overflow-hidden flex flex-col"
      >
        <div className="flex-shrink-0 border-b border-white/10 p-4 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white/5">
                <ListTodo className="w-5 h-5 text-gray-400" aria-hidden="true" />
              </div>
              <div>
                <h2 id={panelTitleId} className="text-lg font-semibold text-gray-200">
                  {initialLeadName ? `Tasks for ${initialLeadName}` : 'All Tasks'}
                </h2>
                <p className="text-sm text-gray-500">
                  {tasks.filter((task) => !task.completedAt).length} pending
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close tasks"
              className="text-gray-500 hover:text-white transition-colors p-1"
            >
              <X className="w-6 h-6" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {!showForm ? (
            <button
              type="button"
              onClick={handleNewTask}
              className="w-full mb-6 py-3 rounded-lg border border-dashed border-white/20 text-gray-500 text-sm hover:border-white/30 hover:text-gray-300 transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add New Task
            </button>
          ) : (
            <section
              aria-labelledby={formTitleId}
              className="mb-6 p-4 bg-white/[0.02] border border-white/10 rounded-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 id={formTitleId} className="text-sm font-medium text-gray-200">
                  {editingTask ? 'Edit Task' : 'New Task'}
                </h3>
                <button
                  type="button"
                  onClick={closeEditor}
                  aria-label="Close task form"
                  className="text-gray-500 hover:text-white"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <TaskForm
                task={editingTask}
                initialLeadId={initialLeadId}
                initialLeadName={initialLeadName}
                onSaved={handleSaved}
                onCancel={closeEditor}
              />
            </section>
          )}

          <TaskList
            tasks={tasks}
            isLoading={isLoading}
            onComplete={handleComplete}
            onEdit={handleEdit}
            onDelete={handleDelete}
            showCompleted={true}
          />
        </div>
      </div>
    </div>
  );
}
