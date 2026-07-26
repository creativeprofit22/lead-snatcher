import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { updateTagSchema } from '@/lib/validations';
import {
  isPrismaKnownRequestError,
  parseRouteBody,
  requireRouteUserId,
  routeErrorResponse,
} from '@/lib/route-utils';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH - Update a tag
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const userId = await requireRouteUserId();
    const { id } = await params;
    const { name, color } = await parseRouteBody(request, updateTagSchema);

    const tag = await prisma.tag.findFirst({
      where: { id, userId },
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Build update data
    const updateData: { name?: string; color?: string } = {};

    if (name !== undefined) {
      updateData.name = name;
    }

    if (color !== undefined) {
      updateData.color = color;
    }

    const updatedTag = await prisma.tag.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { leads: true },
        },
      },
    });

    return NextResponse.json({
      tag: {
        id: updatedTag.id,
        name: updatedTag.name,
        color: updatedTag.color,
        leadCount: updatedTag._count.leads,
        createdAt: updatedTag.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (isPrismaKnownRequestError(error, 'P2002')) {
      return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 409 });
    }

    console.error('Update tag error:', error);
    return routeErrorResponse(error, 'Failed to update tag');
  }
}

// DELETE - Delete a tag
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const userId = await requireRouteUserId();
    const { id } = await params;

    const tag = await prisma.tag.findFirst({
      where: { id, userId },
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    await prisma.tag.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Tag deleted successfully' });
  } catch (error) {
    console.error('Delete tag error:', error);
    return routeErrorResponse(error, 'Failed to delete tag');
  }
}
