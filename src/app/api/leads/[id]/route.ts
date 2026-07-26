import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { toLeadDto } from '@/lib/lead-dto';
import { parseRouteBody, requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';
import { updateLeadSchema } from '@/lib/validations';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET - Get a single lead in { lead }; use /api/leads/[id]/contact for contact history
export async function GET(request: Request, context: RouteContext) {
  try {
    const userId = await requireRouteUserId();

    const { id } = await context.params;

    const lead = await prisma.lead.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        tags: { include: { tag: true } },
      },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ lead: toLeadDto(lead) });
  } catch (error) {
    console.error('Get lead error:', error);
    return routeErrorResponse(error, 'Failed to fetch lead');
  }
}

// PATCH - Update lead (status, notes, follow-up)
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const userId = await requireRouteUserId();

    const { id } = await context.params;
    const { status, notes, nextFollowUpAt } = await parseRouteBody(request, updateLeadSchema);

    // Verify ownership
    const existing = await prisma.lead.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (nextFollowUpAt !== undefined) {
      updateData.nextFollowUpAt = nextFollowUpAt ? new Date(nextFollowUpAt) : null;
    }

    // If status changed to contacted/called, update lastContactedAt
    if (status && ['contacted', 'called'].includes(status)) {
      updateData.lastContactedAt = new Date();
    }

    const lead = await prisma.lead.update({
      where: { id },
      data: updateData,
      include: {
        tags: { include: { tag: true } },
      },
    });

    return NextResponse.json({
      lead: toLeadDto(lead),
      message: 'Lead updated successfully',
    });
  } catch (error) {
    console.error('Update lead error:', error);
    return routeErrorResponse(error, 'Failed to update lead');
  }
}

// DELETE - Remove lead
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const userId = await requireRouteUserId();

    const { id } = await context.params;

    // Verify ownership
    const existing = await prisma.lead.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    await prisma.lead.delete({
      where: { id },
    });

    return NextResponse.json({ message: 'Lead deleted successfully' });
  } catch (error) {
    console.error('Delete lead error:', error);
    return routeErrorResponse(error, 'Failed to delete lead');
  }
}
