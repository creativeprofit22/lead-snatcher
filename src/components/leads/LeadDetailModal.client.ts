import { isLeadStatus } from '@/lib/lead-status';
import type { ContactLogEntry, Lead, LeadStatus, Task, TasksResponse } from '@/types';

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

interface ContactLogEnvelope {
  contactLog: ContactLogEntry;
}

interface LeadEnvelope {
  lead: Lead;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const unsuccessfulResult = { successful: false, data: null } as const;
const LEAD_UPDATE_ERROR_MESSAGE = 'Lead update request failed';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isLeadEnvelope(value: unknown): value is LeadEnvelope {
  if (!isRecord(value) || !isRecord(value.lead)) return false;

  const lead = value.lead;
  return (
    typeof lead.id === 'string' &&
    typeof lead.placeId === 'string' &&
    typeof lead.name === 'string' &&
    isNullableString(lead.address) &&
    isNullableString(lead.phone) &&
    isNullableString(lead.website) &&
    (typeof lead.rating === 'number' || lead.rating === null) &&
    (typeof lead.reviewCount === 'number' || lead.reviewCount === null) &&
    typeof lead.industryType === 'string' &&
    isNullableString(lead.photoUrl) &&
    isNullableString(lead.mapsUrl) &&
    typeof lead.leadScore === 'number' &&
    (isRecord(lead.scoreBreakdown) || lead.scoreBreakdown === null) &&
    typeof lead.status === 'string' &&
    isLeadStatus(lead.status) &&
    isNullableString(lead.notes) &&
    Array.isArray(lead.opportunities) &&
    lead.opportunities.every((opportunity) => typeof opportunity === 'string') &&
    isNullableString(lead.lastContactedAt) &&
    isNullableString(lead.nextFollowUpAt) &&
    typeof lead.savedAt === 'string' &&
    typeof lead.updatedAt === 'string' &&
    Array.isArray(lead.tags) &&
    lead.tags.every(
      (tag) =>
        isRecord(tag) &&
        typeof tag.id === 'string' &&
        typeof tag.name === 'string' &&
        typeof tag.color === 'string' &&
        typeof tag.createdAt === 'string'
    ) &&
    isNullableString(lead.popularTimesData) &&
    isNullableString(lead.popularTimesScrapedAt)
  );
}

export class LeadUpdateClientError extends Error {
  constructor() {
    super(LEAD_UPDATE_ERROR_MESSAGE);
    this.name = 'LeadUpdateClientError';
  }
}

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

  const data = (await response.json()) as TasksResponse;
  return { successful: true, data: data.tasks ?? [] };
}

export async function patchLeadEditableFields(
  leadId: Lead['id'],
  fields: EditableLeadFields
): Promise<Lead> {
  const response = await fetch(`/api/leads/${leadId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(fields),
  });

  if (!response.ok) throw new LeadUpdateClientError();

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new LeadUpdateClientError();
  }

  if (!isLeadEnvelope(data)) throw new LeadUpdateClientError();
  return data.lead;
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
): Promise<void> {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ completedAt }),
  });

  if (!response.ok) {
    throw new Error('Task completion request failed');
  }
}

export async function deleteLeadTask(
  taskId: Task['id']
): Promise<LeadDetailModalClientResult<null>> {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'DELETE',
  });

  return response.ok ? { successful: true, data: null } : unsuccessfulResult;
}
