'use client';

import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import type { Task } from '@/types';
import { TaskForm } from './TaskForm';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Task) => void | Promise<void>;
  task?: Task | null;
  leadId?: string;
  leadName?: string;
}

export function TaskModal({ isOpen, onClose, onSave, task, leadId, leadName }: TaskModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.stopImmediatePropagation();
      onClose();
    };

    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/60"
        onClick={onClose}
        data-testid="task-modal-backdrop"
      />

      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="relative bg-zinc-900 border border-white/10 rounded-xl w-full max-w-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
            <h2 id={titleId} className="text-lg font-medium text-white">
              {task ? 'Edit Task' : 'New Task'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close task editor"
              className="p-1 rounded-lg text-gray-500 hover:text-white hover:bg-white/5"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <TaskForm
            task={task}
            initialLeadId={leadId}
            initialLeadName={leadName}
            onSaved={async (savedTask) => {
              await onSave(savedTask);
              onClose();
            }}
            onCancel={onClose}
            className="p-6 space-y-4"
          />
        </div>
      </div>
    </div>
  );
}
