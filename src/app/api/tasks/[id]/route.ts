import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { updateTaskSchema } from '@/lib/validations';
import { parseRouteBody, requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';
import { toTaskDto } from '@/lib/task-dto';
import type { TaskResponse } from '@/types';

// PATCH - Update a task
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireRouteUserId();
    const { id } = await params;
    const { title, description, type, dueAt, priority, completedAt, leadId } = await parseRouteBody(
      request,
      updateTaskSchema
    );

    // Verify task belongs to user
    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (leadId !== undefined && leadId !== null) {
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

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (type !== undefined) updateData.type = type;
    if (dueAt !== undefined) updateData.dueAt = new Date(dueAt);
    if (priority !== undefined) updateData.priority = priority;
    if (leadId !== undefined) {
      updateData.lead = leadId === null ? { disconnect: true } : { connect: { id: leadId } };
    }
    if (completedAt !== undefined) {
      updateData.completedAt = completedAt ? new Date(completedAt) : null;
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const response = { task: toTaskDto(task) } satisfies TaskResponse;
    return NextResponse.json(response);
  } catch (error) {
    console.error('Update task error:', error);
    return routeErrorResponse(error, 'Failed to update task');
  }
}

// DELETE - Delete a task
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireRouteUserId();
    const { id } = await params;

    // Verify task belongs to user
    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existingTask) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    await prisma.task.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    return routeErrorResponse(error, 'Failed to delete task');
  }
}
