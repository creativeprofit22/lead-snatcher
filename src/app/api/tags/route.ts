import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  isPrismaKnownRequestError,
  parseRouteBody,
  requireRouteUserId,
  routeErrorResponse,
} from '@/lib/route-utils';
import { createTagSchema } from '@/lib/validations';
import type { TagsResponse } from '@/types';

// GET - Fetch user's tags
export async function GET() {
  try {
    const userId = await requireRouteUserId();

    const tags = await prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { leads: true },
        },
      },
    });

    const transformedTags = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      leadCount: tag._count.leads,
      createdAt: tag.createdAt.toISOString(),
    }));

    const response: TagsResponse = { tags: transformedTags };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Get tags error:', error);
    return routeErrorResponse(error, 'Failed to fetch tags');
  }
}

// POST - Create a new tag
export async function POST(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const { name, color } = await parseRouteBody(request, createTagSchema);

    const tag = await prisma.tag.create({
      data: {
        userId,
        name,
        color,
      },
    });

    return NextResponse.json({
      tag: {
        id: tag.id,
        name: tag.name,
        color: tag.color,
        leadCount: 0,
        createdAt: tag.createdAt.toISOString(),
      },
      message: 'Tag created successfully',
    });
  } catch (error) {
    if (isPrismaKnownRequestError(error, 'P2002')) {
      return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 409 });
    }

    console.error('Create tag error:', error);
    return routeErrorResponse(error, 'Failed to create tag');
  }
}
