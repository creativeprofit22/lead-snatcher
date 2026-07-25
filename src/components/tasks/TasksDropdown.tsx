'use client';

import { createElement, Fragment, useEffect, useRef, useState } from 'react';
import { ListTodo, Plus, ChevronRight, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getTaskDayStatus } from '@/lib/business/task-day';
import { useCrmTasks } from '@/lib/hooks/useCrmTasks';

interface TasksDropdownProps {
  onOpenSlideOver?: () => void;
}

export function TasksDropdown({ onOpenSlideOver }: TasksDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { tasks, stats, loading, error, completingTaskIds, refetch, completeTask } = useCrmTasks();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleComplete = async (taskId: string) => {
    try {
      const didComplete = await completeTask(taskId);
      if (didComplete) toast.success('Task completed');
    } catch {
      toast.error('Failed to update task');
    }
  };

  const now = new Date();
  const displayTasks = tasks.slice(0, 5);
  const pendingCount = stats?.pending || 0;
  const overdueCount = stats?.overdue || 0;
  const isInitialLoading = loading && tasks.length === 0;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Tasks, ${pendingCount} pending`}
        aria-expanded={isOpen}
        className={`relative p-2 rounded-lg transition-colors ${
          isOpen ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
        }`}
      >
        <ListTodo className="w-5 h-5" />
        {pendingCount > 0 && (
          <span
            className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-medium rounded-full ${
              overdueCount > 0 ? 'bg-red-500 text-white' : 'bg-white/20 text-white'
            }`}
          >
            {pendingCount > 99 ? '99+' : pendingCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium text-white">Tasks</h3>
              {overdueCount > 0 && (
                <span className="text-xs text-red-400">{overdueCount} overdue</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenSlideOver?.();
              }}
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-white/5 rounded transition-colors"
            >
              <Plus className="w-3 h-3" />
              New
            </button>
          </div>

          <div className="p-2 max-h-80 overflow-y-auto">
            {isInitialLoading ? (
              <div className="space-y-2 p-2" aria-label="Loading tasks">
                {[1, 2, 3].map((item) =>
                  createElement('div', {
                    key: item,
                    className: 'h-10 bg-white/5 rounded animate-pulse',
                  })
                )}
              </div>
            ) : error && tasks.length === 0 ? (
              <div className="py-8 px-4 text-center" role="alert">
                <p className="text-sm text-gray-400">Could not load tasks</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-3 px-3 py-1.5 text-xs text-white border border-white/15 rounded hover:bg-white/5 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : displayTasks.length === 0 ? (
              <div className="py-8 text-center">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
                  <Check className="w-5 h-5 text-green-400" />
                </div>
                <p className="text-sm text-gray-400">All caught up!</p>
                <p className="text-xs text-gray-600 mt-1">No pending tasks</p>
              </div>
            ) : (
              <div className="space-y-1">
                {displayTasks.map((task) => {
                  const dueDate = new Date(task.dueAt);
                  const dayStatus = getTaskDayStatus(dueDate, Boolean(task.completedAt), now);
                  const isOverdue = dayStatus === 'overdue';
                  const isToday = dayStatus === 'today';
                  const isCompleting = completingTaskIds.has(task.id);

                  return createElement(
                    Fragment,
                    { key: task.id },
                    <div className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 group">
                      <button
                        type="button"
                        onClick={() => void handleComplete(task.id)}
                        disabled={isCompleting}
                        aria-label={`Complete ${task.title}`}
                        className="flex-shrink-0 w-4 h-4 rounded border border-gray-600 hover:border-gray-400 transition-colors disabled:cursor-wait disabled:opacity-50"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{task.title}</p>
                        <p
                          className={`text-xs ${
                            isOverdue
                              ? 'text-red-400'
                              : isToday
                                ? 'text-orange-400'
                                : 'text-gray-500'
                          }`}
                        >
                          {dueDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-white/10 p-2">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onOpenSlideOver?.();
              }}
              className="flex items-center justify-center gap-1 w-full py-2 text-xs text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              View all tasks
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
