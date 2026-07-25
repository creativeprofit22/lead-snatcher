import { describe, expect, test } from 'vitest';
import type { Task as PrismaTask } from '@/generated/prisma/client';
import type { TaskDto } from '@/types';
import { toTaskDto } from './task-dto';

const dueAt = new Date('2026-07-25T09:00:00.000Z');
const createdAt = new Date('2026-07-24T08:00:00.000Z');
const updatedAt = new Date('2026-07-24T10:00:00.000Z');

const persistedTask: PrismaTask = {
  id: 'task-1',
  userId: 'user-1',
  title: 'Follow up',
  description: null,
  type: 'call',
  dueAt,
  priority: 'high',
  completedAt: null,
  leadId: null,
  createdAt,
  updatedAt,
};

describe('task endpoint response mapper contract', () => {
  test('serializes a pending standalone task with explicit nulls and ISO timestamps', () => {
    const task = toTaskDto({ ...persistedTask, lead: null });

    expect(task).toEqual({
      id: 'task-1',
      title: 'Follow up',
      description: null,
      type: 'call',
      dueAt: dueAt.toISOString(),
      priority: 'high',
      completedAt: null,
      leadId: null,
      lead: null,
      createdAt: createdAt.toISOString(),
    } satisfies TaskDto);
  });

  test('serializes a completed task and its lead relation', () => {
    const completedAt = new Date('2026-07-25T11:30:00.000Z');
    const task = toTaskDto({
      ...persistedTask,
      description: 'Discuss proposal',
      completedAt,
      leadId: 'lead-1',
      lead: { id: 'lead-1', name: 'Acme Dental' },
    });

    expect(task.completedAt).toBe(completedAt.toISOString());
    expect(task.lead).toEqual({ id: 'lead-1', name: 'Acme Dental' });
  });
});
