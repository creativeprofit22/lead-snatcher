import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Lead, LeadStatus, Task } from '@/types';
import {
  LeadActivityTabView,
  LeadDetailsTabView,
  LeadDetailTabBar,
  LeadNotesTabView,
  LeadTasksTabView,
  type LeadDetailTabId,
} from './LeadDetailModal.tabs';

vi.mock('./StatusSelector', () => ({
  StatusSelector: ({
    value,
    onChange,
  }: {
    value: LeadStatus;
    onChange: (status: LeadStatus) => void;
  }) => (
    <label>
      Lead status
      <select value={value} onChange={(event) => onChange(event.target.value as LeadStatus)}>
        <option value="new">New</option>
        <option value="won">Won</option>
      </select>
    </label>
  ),
}));

vi.mock('./OpportunitiesList', () => ({
  OpportunitiesList: ({
    opportunities,
    maxVisible,
  }: {
    opportunities: string[];
    maxVisible: number;
  }) => (
    <section aria-label="Opportunities">
      {opportunities.join(', ')}; maximum visible: {maxVisible}
    </section>
  ),
}));

vi.mock('@/components/tasks', () => ({
  TaskList: ({
    tasks,
    isLoading,
    showCompleted,
    onComplete,
    onEdit,
    onDelete,
  }: {
    tasks: Task[];
    isLoading: boolean;
    showCompleted: boolean;
    onComplete: (taskId: string, completed: boolean) => Promise<void>;
    onEdit: (task: Task) => void;
    onDelete: (taskId: string) => void;
  }) => (
    <section aria-label="Task list">
      <p>Loading: {isLoading ? 'yes' : 'no'}</p>
      <p>Completed tasks: {showCompleted ? 'shown' : 'hidden'}</p>
      {tasks.map((task) => (
        <div key={task.id}>
          <button onClick={() => void onComplete(task.id, true)}>Complete {task.title}</button>
          <button onClick={() => onEdit(task)}>Edit {task.title}</button>
          <button onClick={() => onDelete(task.id)}>Delete {task.title}</button>
        </div>
      ))}
    </section>
  ),
  TaskModal: ({
    isOpen,
    task,
    leadId,
    leadName,
    onClose,
    onSave,
  }: {
    isOpen: boolean;
    task: Task | null;
    leadId: string;
    leadName: string;
    onClose: () => void;
    onSave: (task: Task) => void;
  }) =>
    isOpen ? (
      <section aria-label="Task modal">
        <p>
          {task?.title ?? 'New task'} for {leadName} ({leadId})
        </p>
        <button onClick={() => task && onSave(task)}>Save task</button>
        <button onClick={onClose}>Close task modal</button>
      </section>
    ) : null,
}));

const lead: Lead = {
  id: 'lead-1',
  placeId: 'place-1',
  name: 'Acme Dental',
  address: '123 Main Street',
  phone: null,
  website: null,
  rating: 4.5,
  reviewCount: 12,
  industryType: 'medical',
  photoUrl: null,
  mapsUrl: null,
  leadScore: 80,
  scoreBreakdown: null,
  status: 'new',
  notes: 'Saved notes',
  opportunities: ['Improve booking flow'],
  lastContactedAt: '2026-07-20T10:00:00.000Z',
  nextFollowUpAt: '2026-08-01T12:00:00.000Z',
  savedAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
  tags: [],
  popularTimesData: null,
  popularTimesScrapedAt: null,
};

const task: Task = {
  id: 'task-1',
  title: 'Call Acme',
  description: null,
  type: 'call',
  dueAt: '2026-08-01T09:00:00.000Z',
  priority: 'high',
  completedAt: null,
  leadId: null,
  lead: null,
  createdAt: '2026-07-20T09:00:00.000Z',
};

afterEach(cleanup);

describe('LeadDetailModal controlled tabs', () => {
  test('renders exact tab labels and reports the selected tab', () => {
    const onTabChange = vi.fn<(tab: LeadDetailTabId) => void>();

    render(
      <LeadDetailTabBar
        activeTab="activity"
        contactCount={3}
        openTaskCount={2}
        onTabChange={onTabChange}
      />
    );

    expect(screen.getByRole('button', { name: 'Details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Contacts (3)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tasks (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tasks (2)' }));
    expect(onTabChange).toHaveBeenCalledWith('tasks');
  });

  test('renders controlled details and wires status and follow-up callbacks', () => {
    const onStatusChange = vi.fn<(status: LeadStatus) => void>();
    const onFollowUpDateChange = vi.fn<(value: string) => void>();
    const onSaveFollowUp = vi.fn();

    render(
      <LeadDetailsTabView
        lead={lead}
        followUpDate="2026-08-01"
        nextFollowUpDisplayValue="8/1/2026"
        isSavingFollowUp={false}
        onStatusChange={onStatusChange}
        onFollowUpDateChange={onFollowUpDateChange}
        onSaveFollowUp={onSaveFollowUp}
      />
    );

    expect(screen.getByText('Currently set: 8/1/2026')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Opportunities' }).textContent).toContain(
      'maximum visible: 10'
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Lead status' }), {
      target: { value: 'won' },
    });
    fireEvent.change(screen.getByDisplayValue('2026-08-01'), {
      target: { value: '2026-08-02' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    expect(onStatusChange).toHaveBeenCalledWith('won');
    expect(onFollowUpDateChange).toHaveBeenCalledWith('2026-08-02');
    expect(onSaveFollowUp).toHaveBeenCalledOnce();
  });

  test('renders controlled activity data and wires draft callbacks', () => {
    const onShowAddLogChange = vi.fn<(show: boolean) => void>();
    const onNewLogTypeChange = vi.fn<(type: string) => void>();
    const onNewLogSummaryChange = vi.fn<(summary: string) => void>();
    const onNewLogOutcomeChange = vi.fn<(outcome: string) => void>();
    const onAddLog = vi.fn();

    const { rerender } = render(
      <LeadActivityTabView
        contactLogs={[]}
        isLoadingLogs={false}
        showAddLog={false}
        newLogType="call"
        newLogSummary=""
        newLogOutcome="neutral"
        isAddingLog={false}
        onShowAddLogChange={onShowAddLogChange}
        onNewLogTypeChange={onNewLogTypeChange}
        onNewLogSummaryChange={onNewLogSummaryChange}
        onNewLogOutcomeChange={onNewLogOutcomeChange}
        onAddLog={onAddLog}
      />
    );

    expect(screen.getByText('No contact history yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Contact Log' }));
    expect(onShowAddLogChange).toHaveBeenCalledWith(true);

    rerender(
      <LeadActivityTabView
        contactLogs={[
          {
            id: 'log-1',
            type: 'email',
            summary: 'Sent proposal',
            outcome: 'positive',
            createdAt: '2026-07-20T10:00:00.000Z',
          },
        ]}
        isLoadingLogs={false}
        showAddLog
        newLogType="call"
        newLogSummary="Ready to send"
        newLogOutcome="neutral"
        isAddingLog={false}
        onShowAddLogChange={onShowAddLogChange}
        onNewLogTypeChange={onNewLogTypeChange}
        onNewLogSummaryChange={onNewLogSummaryChange}
        onNewLogOutcomeChange={onNewLogOutcomeChange}
        onAddLog={onAddLog}
      />
    );

    expect(screen.getByText('Sent proposal')).toBeTruthy();
    expect(screen.getByText('positive')).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('Phone Call'), { target: { value: 'email' } });
    fireEvent.change(screen.getByDisplayValue('Neutral'), { target: { value: 'positive' } });
    fireEvent.change(screen.getByPlaceholderText('What happened?'), {
      target: { value: 'Updated summary' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Log' }));

    expect(onNewLogTypeChange).toHaveBeenCalledWith('email');
    expect(onNewLogOutcomeChange).toHaveBeenCalledWith('positive');
    expect(onNewLogSummaryChange).toHaveBeenCalledWith('Updated summary');
    expect(onAddLog).toHaveBeenCalledOnce();
  });

  test('wires task list and modal callbacks with completed tasks visible', () => {
    const onAddTask = vi.fn();
    const onTaskComplete = vi.fn(async () => undefined);
    const onTaskEdit = vi.fn<(task: Task) => void>();
    const onTaskDelete = vi.fn<(taskId: string) => void>();
    const onTaskModalClose = vi.fn();
    const onTaskSave = vi.fn<(task: Task) => void>();

    render(
      <LeadTasksTabView
        lead={lead}
        tasks={[task]}
        isLoadingTasks={false}
        isTaskModalOpen
        editingTask={task}
        onAddTask={onAddTask}
        onTaskComplete={onTaskComplete}
        onTaskEdit={onTaskEdit}
        onTaskDelete={onTaskDelete}
        onTaskModalClose={onTaskModalClose}
        onTaskSave={onTaskSave}
      />
    );

    expect(screen.getByRole('region', { name: 'Task list' })).toBeTruthy();
    expect(screen.getByText('Completed tasks: shown')).toBeTruthy();
    expect(screen.getByText('Call Acme for Acme Dental (lead-1)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Task for Acme Dental' }));
    fireEvent.click(screen.getByRole('button', { name: 'Complete Call Acme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Call Acme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Call Acme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close task modal' }));

    expect(onAddTask).toHaveBeenCalledOnce();
    expect(onTaskComplete).toHaveBeenCalledWith('task-1', true);
    expect(onTaskEdit).toHaveBeenCalledWith(task);
    expect(onTaskDelete).toHaveBeenCalledWith('task-1');
    expect(onTaskSave).toHaveBeenCalledWith(task);
    expect(onTaskModalClose).toHaveBeenCalledOnce();
  });

  test('renders controlled notes and wires editing and saving', () => {
    const onNotesChange = vi.fn<(notes: string) => void>();
    const onSaveNotes = vi.fn();

    render(
      <LeadNotesTabView
        notes="Draft notes"
        savedNotes="Saved notes"
        isSavingNotes={false}
        onNotesChange={onNotesChange}
        onSaveNotes={onSaveNotes}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Add notes about this lead...'), {
      target: { value: 'Revised notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }));

    expect(onNotesChange).toHaveBeenCalledWith('Revised notes');
    expect(onSaveNotes).toHaveBeenCalledOnce();
  });
});
