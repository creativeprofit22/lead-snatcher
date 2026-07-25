import type { ContactLogEntry, Lead, LeadStatus, Task } from '@/types';

export type LeadDetailModalClientResult<T> =
  | { successful: true; data: T }
  | { successful: false; data: null };

export interface EditableLeadFields {
  status?: LeadStatus;
  notes?: Lead['notes'];
  nextFollowUpAt?: Lead['nextFollowUpAt'];
}

export type NewContactLog = Pick<ContactLogEntry, 'type' | 'summary' | 'outcome'>;
export type TaskCompletionTime = NonNullable<Task['completedAt']> | null;

interface ContactLogsEnvelope {
  contactLogs?: ContactLogEntry[];
}

interface TasksEnvelope {
  tasks?: Task[];
}

interface ContactLogEnvelope {
  contactLog: ContactLogEntry;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const unsuccessfulResult = { successful: false, data: null } as const;

export async function fetchLeadContactLogs(
  leadId: Lead['id']
): Promise<LeadDetailModalClientResult<ContactLogEntry[]>> {
  const response = await fetch(`/api/leads/${leadId}/contact`);
  if (!response.ok) return unsuccessfulResult;

  const data = (await response.json()) as ContactLogsEnvelope;
  return { successful: true, data: data.contactLogs || [] };
}

export async function fetchAllLeadTasks(
  leadId: Lead['id']
): Promise<LeadDetailModalClientResult<Task[]>> {
  const response = await fetch(`/api/tasks?leadId=${leadId}&status=all`);
  if (!response.ok) return unsuccessfulResult;

  const data = (await response.json()) as TasksEnvelope;
  return { successful: true, data: data.tasks || [] };
}

export async function patchLeadEditableFields(
  leadId: Lead['id'],
  fields: EditableLeadFields
): Promise<LeadDetailModalClientResult<null>> {
  const response = await fetch(`/api/leads/${leadId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  });

  return response.ok ? { successful: true, data: null } : unsuccessfulResult;
}

export async function createLeadContactLog(
  leadId: Lead['id'],
  contactLog: NewContactLog
): Promise<LeadDetailModalClientResult<ContactLogEntry>> {
  const response = await fetch(`/api/leads/${leadId}/contact`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(contactLog),
  });
  if (!response.ok) return unsuccessfulResult;

  const data = (await response.json()) as ContactLogEnvelope;
  return { successful: true, data: data.contactLog };
}

export async function setLeadTaskCompletion(
  taskId: Task['id'],
  completedAt: TaskCompletionTime
): Promise<LeadDetailModalClientResult<null>> {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ completedAt }),
  });

  return response.ok ? { successful: true, data: null } : unsuccessfulResult;
}

export async function deleteLeadTask(
  taskId: Task['id']
): Promise<LeadDetailModalClientResult<null>> {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'DELETE',
  });

  return response.ok ? { successful: true, data: null } : unsuccessfulResult;
}
