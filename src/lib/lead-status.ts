export const LEAD_STATUS_VALUES = [
  'new',
  'contacted',
  'called',
  'proposal_sent',
  'negotiating',
  'won',
  'lost',
  'not_interested',
] as const;

export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number];

export interface LeadStatusMetadata {
  label: string;
  color: string;
  bgColor: string;
  badgeClassName: string;
  kanbanOrder: number;
  kanbanVisible: boolean;
  terminal: boolean;
  pipeline: boolean;
}

export const LEAD_STATUS_METADATA = {
  new: {
    label: 'New',
    color: '#9ca3af',
    bgColor: 'transparent',
    badgeClassName: 'text-gray-400',
    kanbanOrder: 0,
    kanbanVisible: true,
    terminal: false,
    pipeline: false,
  },
  contacted: {
    label: 'Contacted',
    color: '#9ca3af',
    bgColor: 'transparent',
    badgeClassName: 'text-gray-300',
    kanbanOrder: 1,
    kanbanVisible: true,
    terminal: false,
    pipeline: true,
  },
  called: {
    label: 'Called',
    color: '#9ca3af',
    bgColor: 'transparent',
    badgeClassName: 'text-gray-300',
    kanbanOrder: 2,
    kanbanVisible: true,
    terminal: false,
    pipeline: true,
  },
  proposal_sent: {
    label: 'Proposal Sent',
    color: '#9ca3af',
    bgColor: 'transparent',
    badgeClassName: 'text-gray-200',
    kanbanOrder: 3,
    kanbanVisible: true,
    terminal: false,
    pipeline: true,
  },
  negotiating: {
    label: 'Negotiating',
    color: '#9ca3af',
    bgColor: 'transparent',
    badgeClassName: 'text-gray-200',
    kanbanOrder: 4,
    kanbanVisible: true,
    terminal: false,
    pipeline: true,
  },
  won: {
    label: 'Won',
    color: '#22c55e',
    bgColor: 'transparent',
    badgeClassName: 'text-green-400',
    kanbanOrder: 5,
    kanbanVisible: true,
    terminal: true,
    pipeline: false,
  },
  lost: {
    label: 'Lost',
    color: '#6b7280',
    bgColor: 'transparent',
    badgeClassName: 'text-gray-600',
    kanbanOrder: 6,
    kanbanVisible: true,
    terminal: true,
    pipeline: false,
  },
  not_interested: {
    label: 'Not Interested',
    color: '#6b7280',
    bgColor: 'transparent',
    badgeClassName: 'text-gray-600',
    kanbanOrder: 7,
    kanbanVisible: true,
    terminal: true,
    pipeline: false,
  },
} as const satisfies Record<LeadStatus, LeadStatusMetadata>;

export const LEAD_STATUS_OPTIONS = LEAD_STATUS_VALUES.map((id) => ({
  id,
  ...LEAD_STATUS_METADATA[id],
}));

export const KANBAN_LEAD_STATUSES = LEAD_STATUS_OPTIONS.filter(
  (status) => status.kanbanVisible
).sort((left, right) => left.kanbanOrder - right.kanbanOrder);

export const PIPELINE_LEAD_STATUS_VALUES = LEAD_STATUS_OPTIONS.filter(
  (status) => status.pipeline
).map((status) => status.id);

export const TERMINAL_LEAD_STATUS_VALUES = LEAD_STATUS_OPTIONS.filter(
  (status) => status.terminal
).map((status) => status.id);

const leadStatusSet: ReadonlySet<string> = new Set(LEAD_STATUS_VALUES);

export function isLeadStatus(value: string): value is LeadStatus {
  return leadStatusSet.has(value);
}

export function parseLeadStatus(value: string): LeadStatus {
  if (!isLeadStatus(value)) {
    throw new Error(`Invalid lead status: ${value}`);
  }

  return value;
}

export function createLeadStatusRecord<T>(createValue: (status: LeadStatus) => T) {
  return Object.fromEntries(
    LEAD_STATUS_VALUES.map((status) => [status, createValue(status)])
  ) as Record<LeadStatus, T>;
}
