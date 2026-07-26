import { NextResponse } from 'next/server';
import { getTaskDayBoundaries } from '@/lib/business/task-day';
import { TASK_PRIORITY_RANK } from '@/lib/constants';
import { parseTaskListQuery } from '@/lib/crm-task-query';
import { prisma } from '@/lib/db';
import { createTaskSchema } from '@/lib/validations';
import {
  parseRouteBody,
  parseRouteQuery,
  requireRouteUserId,
  routeErrorResponse,
} from '@/lib/route-utils';
import { toTaskDto } from '@/lib/task-dto';
import type {
  CreateTaskResponse,
  TaskPriority,
  TasksResponse,
  TasksWithStatsResponse,
  TaskStats,
} from '@/types';

// GET - Fetch user's tasks with optional filters
export async function GET(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const { searchParams } = new URL(request.url);
    const { status, due, leadId, includeStats } = parseRouteQuery(searchParams, parseTaskListQuery);

    // Build where clause
    const where: Record<string, unknown> = {
      userId,
    };

    // Status filter
    if (status === 'pending') {
      where.completedAt = null;
    } else if (status === 'completed') {
      where.completedAt = { not: null };
    }

    // Lead filter
    if (leadId) {
      where.leadId = leadId;
    }

    // Due date filter
    const now = new Date();
    const { startOfToday, startOfTomorrow, startOfNextWeek } = getTaskDayBoundaries(now);

    if (due === 'today') {
      where.dueAt = {
        gte: startOfToday,
        lt: startOfTomorrow,
      };
    } else if (due === 'overdue') {
      where.dueAt = {
        lt: startOfToday,
      };
      where.completedAt = null; // Only show overdue if not completed
    } else if (due === 'week') {
      where.dueAt = {
        gte: startOfToday,
        lt: startOfNextWeek,
      };
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { dueAt: 'asc' },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    tasks.sort((left, right) => {
      const dueAtDifference = left.dueAt.getTime() - right.dueAt.getTime();
      if (dueAtDifference !== 0) return dueAtDifference;

      const leftRank = TASK_PRIORITY_RANK[left.priority as TaskPriority] ?? -1;
      const rightRank = TASK_PRIORITY_RANK[right.priority as TaskPriority] ?? -1;
      return rightRank - leftRank;
    });

    const response = { tasks: tasks.map(toTaskDto) } satisfies TasksResponse;
    if (!includeStats) {
      return NextResponse.json(response);
    }

    const [pending, completed, overdue, dueToday] = await Promise.all([
      prisma.task.count({ where: { userId, completedAt: null } }),
      prisma.task.count({ where: { userId, completedAt: { not: null } } }),
      prisma.task.count({
        where: { userId, completedAt: null, dueAt: { lt: startOfToday } },
      }),
      prisma.task.count({
        where: {
          userId,
          completedAt: null,
          dueAt: { gte: startOfToday, lt: startOfTomorrow },
        },
      }),
    ]);
    const stats: TaskStats = {
      total: pending + completed,
      pending,
      completed,
      overdue,
      dueToday,
    };
    const responseWithStats = { ...response, stats } satisfies TasksWithStatsResponse;
    return NextResponse.json(responseWithStats);
  } catch (error) {
    console.error('Get tasks error:', error);
    return routeErrorResponse(error, 'Failed to fetch tasks');
  }
}

// POST - Create a new task
export async function POST(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const { title, description, type, dueAt, priority, leadId } = await parseRouteBody(
      request,
      createTaskSchema
    );

    // Verify lead belongs to user if provided
    if (leadId) {
      const lead = await prisma.lead.findFirst({
        where: {
          id: leadId,
          userId,
        },
      });
      if (!lead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      }
    }

    const task = await prisma.task.create({
      data: {
        userId,
        title,
        description,
        type,
        dueAt: new Date(dueAt),
        priority,
        leadId,
      },
      include: {
        lead: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const response = {
      task: toTaskDto(task),
      message: 'Task created successfully',
    } satisfies CreateTaskResponse;
    return NextResponse.json(response);
  } catch (error) {
    console.error('Create task error:', error);
    return routeErrorResponse(error, 'Failed to create task');
  }
}
