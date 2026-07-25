import type { Task as PrismaTask } from '@/generated/prisma/client';
import type { TaskDto, TaskPriority, TaskType } from '@/types';

type PersistedTask = PrismaTask & {
  lead: { id: string; name: string } | null;
};

/** The sole serializer for persisted tasks returned by the API. */
export function toTaskDto(task: PersistedTask): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    type: task.type as TaskType,
    dueAt: task.dueAt.toISOString(),
    priority: task.priority as TaskPriority,
    completedAt: task.completedAt?.toISOString() ?? null,
    leadId: task.leadId,
    lead: task.lead,
    createdAt: task.createdAt.toISOString(),
  };
}
