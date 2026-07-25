'use client';

import { createElement, Fragment } from 'react';
import { ListTodo, AlertTriangle, ChevronRight, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getTaskDayStatus } from '@/lib/business/task-day';
import { useCrmTasks } from '@/lib/hooks/useCrmTasks';

interface TasksWidgetProps {
  onOpenSlideOver: () => void;
}

export function TasksWidget({ onOpenSlideOver }: TasksWidgetProps) {
  const { tasks, stats, loading, error, completingTaskIds, refetch, completeTask } = useCrmTasks();

  const handleComplete = async (taskId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const didComplete = await completeTask(taskId);
      if (didComplete) toast.success('Task completed');
    } catch {
      toast.error('Failed to complete task');
    }
  };

  const now = new Date();
  const displayTasks = tasks.slice(0, 4);
  const pendingCount = stats?.pending ?? tasks.length;
  const overdueCount = stats?.overdue ?? 0;
  const hasMore = tasks.length > 4;
  const isInitialLoading = loading && tasks.length === 0;

  if (!isInitialLoading && !error && tasks.length === 0) {
    return null;
  }

  if (isInitialLoading) {
    return (
      <div
        className="mb-6 p-4 bg-white/[0.02] border border-white/10 rounded-xl"
        aria-label="Loading tasks"
      >
        <div className="h-6 w-32 bg-white/5 rounded animate-pulse mb-3" />
        <div className="space-y-2">
          {[1, 2].map((item) =>
            createElement('div', {
              key: item,
              className: 'h-12 bg-white/5 rounded animate-pulse',
            })
          )}
        </div>
      </div>
    );
  }

  if (error && tasks.length === 0) {
    return (
      <div
        className="mb-6 p-4 bg-white/[0.02] border border-white/10 rounded-xl text-center"
        role="alert"
      >
        <p className="text-sm text-gray-400">Could not load tasks</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 px-3 py-1.5 text-xs text-white border border-white/15 rounded hover:bg-white/5 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 p-4 bg-white/[0.02] border border-white/10 rounded-xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-medium text-white">
            Tasks
            <span className="text-gray-500 font-normal ml-1">({pendingCount})</span>
          </h3>
          {overdueCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">
              <AlertTriangle className="w-3 h-3" />
              {overdueCount} overdue
            </span>
          )}
          {error && (
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-xs text-gray-500 hover:text-white transition-colors"
            >
              Refresh failed. Retry
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenSlideOver}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors"
        >
          View all
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-2">
        {displayTasks.map((task) => {
          const dueDate = new Date(task.dueAt);
          const dayStatus = getTaskDayStatus(dueDate, Boolean(task.completedAt), now);
          const isOverdue = dayStatus === 'overdue';
          const isToday = dayStatus === 'today';
          const isCompleting = completingTaskIds.has(task.id);

          return createElement(
            Fragment,
            { key: task.id },
            <div
              onClick={onOpenSlideOver}
              className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/5 rounded-lg hover:bg-white/[0.04] hover:border-white/10 transition-colors cursor-pointer group"
            >
              <button
                type="button"
                onClick={(event) => void handleComplete(task.id, event)}
                disabled={isCompleting}
                aria-label={`Complete ${task.title}`}
                className="flex-shrink-0 w-5 h-5 rounded border border-gray-600 hover:border-green-500 hover:bg-green-500/20 transition-colors flex items-center justify-center group/check disabled:cursor-wait disabled:opacity-50"
              >
                <Check className="w-3 h-3 text-green-500 opacity-0 group-hover/check:opacity-100 transition-opacity" />
              </button>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{task.title}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={`text-xs ${
                      isOverdue ? 'text-red-400' : isToday ? 'text-orange-400' : 'text-gray-500'
                    }`}
                  >
                    {dueDate.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  {task.lead && (
                    <span className="text-xs text-gray-600 truncate">• {task.lead.name}</span>
                  )}
                </div>
              </div>

              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  task.priority === 'urgent'
                    ? 'bg-red-500'
                    : task.priority === 'high'
                      ? 'bg-orange-500'
                      : task.priority === 'medium'
                        ? 'bg-blue-500'
                        : 'bg-gray-500'
                }`}
              />
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={onOpenSlideOver}
          className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-white transition-colors"
        >
          + {tasks.length - 4} more tasks
        </button>
      )}
    </div>
  );
}
