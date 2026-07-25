'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle,
  Clock,
  Mail,
  Pencil,
  Phone,
  Trash2,
} from 'lucide-react';
import { getTaskDayStatus } from '@/lib/business/task-day';
import type { Task, TaskType } from '@/types';
import { TaskPriorityBadge } from './TaskPriorityBadge';

const typeIcons: Record<TaskType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  follow_up: Clock,
  other: CheckCircle,
};

interface TaskItemProps {
  task: Task;
  onComplete: (taskId: string, completed: boolean) => Promise<void>;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
  compact?: boolean;
}

export function TaskItem({ task, onComplete, onEdit, onDelete, compact = false }: TaskItemProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionOverride, setCompletionOverride] = useState<boolean | null>(null);
  const taskIsCompleted = !!task.completedAt;
  const isCompleted = completionOverride ?? taskIsCompleted;
  const TypeIcon = typeIcons[task.type];

  useEffect(() => {
    if (completionOverride === taskIsCompleted) {
      setCompletionOverride(null);
    }
  }, [completionOverride, taskIsCompleted]);

  const dueDate = new Date(task.dueAt);
  const now = new Date();
  const dayStatus = getTaskDayStatus(dueDate, isCompleted, now);
  const isOverdue = dayStatus === 'overdue';
  const isToday = dayStatus === 'today';

  const handleComplete = async () => {
    const nextIsCompleted = !isCompleted;

    setCompletionOverride(nextIsCompleted);
    setIsCompleting(true);

    try {
      await onComplete(task.id, nextIsCompleted);
    } catch {
      setCompletionOverride(null);
    } finally {
      setIsCompleting(false);
    }
  };

  const formatDueDate = () => {
    const today = now;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    if (dueDate.toDateString() === today.toDateString()) {
      return `Today, ${dueDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    if (dueDate.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow, ${dueDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return dueDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg transition-colors ${
          isCompleted ? 'opacity-50' : 'hover:bg-white/5'
        }`}
      >
        <button
          type="button"
          aria-label={isCompleted ? `Reopen ${task.title}` : `Complete ${task.title}`}
          aria-pressed={isCompleted}
          onClick={handleComplete}
          disabled={isCompleting}
          className={`flex-shrink-0 w-4 h-4 rounded border transition-colors ${
            isCompleted
              ? 'bg-green-500/20 border-green-500 text-green-500'
              : 'border-gray-600 hover:border-gray-400'
          }`}
        >
          {isCompleted && <Check className="w-3 h-3" />}
        </button>
        <span
          className={`flex-1 text-sm truncate ${isCompleted ? 'line-through text-gray-500' : 'text-gray-200'}`}
        >
          {task.title}
        </span>
        <span
          className={`text-xs ${isOverdue ? 'text-red-400' : isToday ? 'text-orange-400' : 'text-gray-500'}`}
        >
          {formatDueDate()}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-start gap-3 py-3 px-4 rounded-lg border transition-all ${
        isCompleted
          ? 'border-white/5 bg-white/[0.02] opacity-60'
          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
      }`}
    >
      {/* Checkbox */}
      <button
        type="button"
        aria-label={isCompleted ? `Reopen ${task.title}` : `Complete ${task.title}`}
        aria-pressed={isCompleted}
        onClick={handleComplete}
        disabled={isCompleting}
        className={`flex-shrink-0 w-5 h-5 mt-0.5 rounded border-2 transition-all flex items-center justify-center ${
          isCompleted
            ? 'bg-green-500/20 border-green-500 text-green-500'
            : 'border-gray-600 hover:border-gray-400'
        } ${isCompleting ? 'animate-pulse' : ''}`}
      >
        {isCompleted && <Check className="w-3 h-3" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <TypeIcon className="w-4 h-4 text-gray-500" />
          <span
            className={`font-medium ${isCompleted ? 'line-through text-gray-500' : 'text-gray-200'}`}
          >
            {task.title}
          </span>
          <TaskPriorityBadge priority={task.priority} />
        </div>

        {task.description && (
          <p className="mt-1 text-sm text-gray-500 line-clamp-1">{task.description}</p>
        )}

        <div className="mt-2 flex items-center gap-3 text-xs">
          <span
            className={`inline-flex items-center gap-1 ${
              isOverdue ? 'text-red-400' : isToday ? 'text-orange-400' : 'text-gray-500'
            }`}
          >
            {isOverdue && <AlertTriangle className="w-3 h-3" aria-hidden="true" />}
            {formatDueDate()}
          </span>
          {task.lead && <span className="text-gray-500">→ {task.lead.name}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          aria-label={`Edit ${task.title}`}
          onClick={() => onEdit(task)}
          className="p-1.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${task.title}`}
          onClick={() => onDelete(task.id)}
          className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
