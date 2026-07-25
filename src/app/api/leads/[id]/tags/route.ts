import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  HttpError,
  parseRouteBody,
  requireRouteUserId,
  routeErrorResponse,
} from '@/lib/route-utils';
import { addTagToLeadSchema } from '@/lib/validations';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function requireTagIdQuery(request: Request): string {
  const tagId = new URL(request.url).searchParams.get('tagId')?.trim();

  if (!tagId) {
    throw new HttpError('Tag ID is required', 400);
  }

  return tagId;
}

// POST - Add tag to lead
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const userId = await requireRouteUserId();
    const { id: leadId } = await params;
    const { tagId } = await parseRouteBody(request, addTagToLeadSchema);

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, userId },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const tag = await prisma.tag.findFirst({
      where: { id: tagId, userId },
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Check if already connected
    const existingLink = await prisma.leadTag.findUnique({
      where: {
        leadId_tagId: {
          leadId,
          tagId,
        },
      },
    });

    if (!existingLink) {
      // Create the link
      await prisma.leadTag.create({
        data: {
          leadId,
          tagId,
        },
      });
    }

    // Get updated tags
    const leadTags = await prisma.leadTag.findMany({
      where: { leadId },
      include: { tag: true },
    });

    return NextResponse.json({
      tags: leadTags.map((lt) => ({
        id: lt.tag.id,
        name: lt.tag.name,
        color: lt.tag.color,
        createdAt: lt.tag.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Add tag to lead error:', error);
    return routeErrorResponse(error, 'Failed to add tag');
  }
}

// DELETE - Remove tag from lead
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const userId = await requireRouteUserId();
    const { id: leadId } = await params;
    const tagId = requireTagIdQuery(request);

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, userId },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const tag = await prisma.tag.findFirst({
      where: { id: tagId, userId },
    });

    if (!tag) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    // Remove the link
    await prisma.leadTag.deleteMany({
      where: {
        leadId,
        tagId,
      },
    });

    // Get updated tags
    const leadTags = await prisma.leadTag.findMany({
      where: { leadId },
      include: { tag: true },
    });

    return NextResponse.json({
      tags: leadTags.map((lt) => ({
        id: lt.tag.id,
        name: lt.tag.name,
        color: lt.tag.color,
        createdAt: lt.tag.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Remove tag from lead error:', error);
    return routeErrorResponse(error, 'Failed to remove tag');
  }
}
