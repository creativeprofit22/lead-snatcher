import { z } from 'zod';

export const TASK_LIST_STATUSES = ['pending', 'completed', 'all'] as const;
export const TASK_LIST_DUE_FILTERS = ['today', 'overdue', 'week', 'all'] as const;

export type TaskListStatus = (typeof TASK_LIST_STATUSES)[number];
export type TaskListDueFilter = (typeof TASK_LIST_DUE_FILTERS)[number];

export interface TaskListQuery {
  status: TaskListStatus;
  due: TaskListDueFilter;
  leadId?: string;
  includeStats: boolean;
}

const taskListQuerySchema = z
  .object({
    status: z.enum(TASK_LIST_STATUSES).optional(),
    due: z.enum(TASK_LIST_DUE_FILTERS).optional(),
    leadId: z.string().trim().min(1, 'leadId cannot be blank').optional(),
    include: z.literal('stats').optional(),
  })
  .transform(
    (query): TaskListQuery => ({
      status: query.status ?? 'pending',
      due: query.due ?? 'all',
      leadId: query.leadId,
      includeStats: query.include === 'stats',
    })
  );

/** Parses and validates task-list URL query parameters. Throws a ZodError for malformed input. */
export function parseTaskListQuery(searchParams: URLSearchParams): TaskListQuery {
  const value = (key: string) => searchParams.get(key) ?? undefined;

  return taskListQuerySchema.parse({
    status: value('status'),
    due: value('due'),
    leadId: value('leadId'),
    include: value('include'),
  });
}
