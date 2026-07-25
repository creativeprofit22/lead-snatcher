'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getTaskDayStatus } from '@/lib/business/task-day';
import type { Task, TaskPriority, TasksWithStatsResponse, TaskStats, TaskType } from '@/types';

const PENDING_TASKS_ENDPOINT = '/api/tasks?status=pending&include=stats';
const TASK_TYPES: TaskType[] = ['call', 'email', 'meeting', 'follow_up', 'other'];
const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export class CrmTasksRequestError extends Error {
  constructor(public readonly status: number) {
    super(`Failed to load CRM tasks (${status})`);
    this.name = 'CrmTasksRequestError';
  }
}

export class CrmTasksResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrmTasksResponseError';
  }
}

export class CrmTaskMutationError extends Error {
  constructor(public readonly status: number) {
    super(`Failed to complete CRM task (${status})`);
    this.name = 'CrmTaskMutationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function parseTask(value: unknown): Task | null {
  if (!isRecord(value)) return null;

  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !TASK_TYPES.includes(value.type as TaskType) ||
    !isIsoDate(value.dueAt) ||
    !TASK_PRIORITIES.includes(value.priority as TaskPriority) ||
    !isIsoDate(value.createdAt)
  ) {
    return null;
  }

  if (
    !('description' in value) ||
    (value.description !== null && typeof value.description !== 'string') ||
    !('completedAt' in value) ||
    (value.completedAt !== null && !isIsoDate(value.completedAt)) ||
    !('leadId' in value) ||
    (value.leadId !== null && typeof value.leadId !== 'string') ||
    !('lead' in value)
  ) {
    return null;
  }

  if (
    value.lead !== null &&
    (!isRecord(value.lead) ||
      typeof value.lead.id !== 'string' ||
      typeof value.lead.name !== 'string')
  ) {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    description: value.description,
    type: value.type as TaskType,
    dueAt: value.dueAt,
    priority: value.priority as TaskPriority,
    completedAt: value.completedAt,
    leadId: value.leadId,
    lead:
      value.lead === null ? null : { id: value.lead.id as string, name: value.lead.name as string },
    createdAt: value.createdAt,
  };
}

function parseTaskStats(value: unknown): TaskStats | null {
  if (!isRecord(value)) return null;

  if (
    !isNonNegativeInteger(value.total) ||
    !isNonNegativeInteger(value.pending) ||
    !isNonNegativeInteger(value.completed) ||
    !isNonNegativeInteger(value.overdue) ||
    !isNonNegativeInteger(value.dueToday)
  ) {
    return null;
  }

  return {
    total: value.total,
    pending: value.pending,
    completed: value.completed,
    overdue: value.overdue,
    dueToday: value.dueToday,
  };
}

function parseTasksResponse(value: unknown): TasksWithStatsResponse {
  if (!isRecord(value) || !Array.isArray(value.tasks)) {
    throw new CrmTasksResponseError('CRM tasks response is malformed');
  }

  const tasks = value.tasks.map(parseTask);
  const stats = parseTaskStats(value.stats);
  if (tasks.some((task) => task === null) || !stats) {
    throw new CrmTasksResponseError('CRM tasks response is malformed');
  }

  return { tasks: tasks as Task[], stats };
}

export async function fetchCrmTasks(
  fetcher: typeof fetch = fetch
): Promise<TasksWithStatsResponse> {
  const response = await fetcher(PENDING_TASKS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new CrmTasksRequestError(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CrmTasksResponseError('CRM tasks response is not valid JSON');
  }

  return parseTasksResponse(body);
}

export interface CrmTasksResource {
  tasks: Task[];
  stats: TaskStats | null;
  loading: boolean;
  error: Error | null;
  completingTaskIds: ReadonlySet<string>;
  refetch: () => Promise<void>;
  invalidate: () => Promise<void>;
  completeTask: (taskId: string) => Promise<boolean>;
}

export function useCrmTasksResource(fetcher: typeof fetch = fetch): CrmTasksResource {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [completingTaskIds, setCompletingTaskIds] = useState<ReadonlySet<string>>(new Set());
  const requestVersion = useRef(0);
  const activeCompletions = useRef(new Set<string>());
  const tasksRef = useRef<Task[]>([]);

  const refetch = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const response = await fetchCrmTasks(fetcher);
      if (version === requestVersion.current) {
        tasksRef.current = response.tasks;
        setTasks(response.tasks);
        setStats(response.stats);
      }
    } catch (caughtError) {
      if (version === requestVersion.current) {
        setError(
          caughtError instanceof Error ? caughtError : new Error('Failed to load CRM tasks')
        );
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
      }
    }
  }, [fetcher]);

  const completeTask = useCallback(
    async (taskId: string) => {
      if (activeCompletions.current.has(taskId)) return false;

      activeCompletions.current.add(taskId);
      setCompletingTaskIds(new Set(activeCompletions.current));
      const completedTask = tasksRef.current.find((task) => task.id === taskId);

      try {
        const response = await fetcher(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedAt: new Date().toISOString() }),
        });

        if (!response.ok) {
          throw new CrmTaskMutationError(response.status);
        }

        if (completedTask) {
          const nextTasks = tasksRef.current.filter((task) => task.id !== taskId);
          tasksRef.current = nextTasks;
          setTasks(nextTasks);
          setStats((currentStats) => {
            if (!currentStats) return currentStats;

            const dayStatus = getTaskDayStatus(completedTask.dueAt, false, new Date());

            return {
              ...currentStats,
              pending: Math.max(0, currentStats.pending - 1),
              completed: currentStats.completed + 1,
              overdue:
                dayStatus === 'overdue'
                  ? Math.max(0, currentStats.overdue - 1)
                  : currentStats.overdue,
              dueToday:
                dayStatus === 'today'
                  ? Math.max(0, currentStats.dueToday - 1)
                  : currentStats.dueToday,
            };
          });
        }

        await refetch();
        return true;
      } finally {
        activeCompletions.current.delete(taskId);
        setCompletingTaskIds(new Set(activeCompletions.current));
      }
    },
    [fetcher, refetch]
  );

  useEffect(() => {
    // Freshness policy: load once, then refresh only after mutations or an explicit retry/invalidation.
    void refetch();

    return () => {
      requestVersion.current += 1;
    };
  }, [refetch]);

  return {
    tasks,
    stats,
    loading,
    error,
    completingTaskIds,
    refetch,
    invalidate: refetch,
    completeTask,
  };
}

const CrmTasksContext = createContext<CrmTasksResource | null>(null);

interface CrmTasksProviderProps {
  children: ReactNode;
  fetcher?: typeof fetch;
}

export function CrmTasksProvider({ children, fetcher = fetch }: CrmTasksProviderProps) {
  const resource = useCrmTasksResource(fetcher);

  return <CrmTasksContext.Provider value={resource}>{children}</CrmTasksContext.Provider>;
}

export function useCrmTasks(): CrmTasksResource {
  const resource = useContext(CrmTasksContext);
  if (!resource) {
    throw new Error('useCrmTasks must be used within a CrmTasksProvider');
  }

  return resource;
}
