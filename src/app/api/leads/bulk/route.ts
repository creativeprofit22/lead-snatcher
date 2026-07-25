import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { bulkUpdateLeadsSchema, bulkDeleteLeadsSchema } from '@/lib/validations';
import { parseRouteBody, requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';

// PATCH - Bulk update leads (status change or add tag)
export async function PATCH(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const { leadIds, action, status, tagId } = await parseRouteBody(request, bulkUpdateLeadsSchema);

    // Verify all leads belong to user
    const leads = await prisma.lead.findMany({
      where: {
        id: { in: leadIds },
        userId: userId,
      },
    });

    if (leads.length !== leadIds.length) {
      return NextResponse.json({ error: 'Some leads not found' }, { status: 404 });
    }

    if (action === 'status') {
      // Zod refine guarantees status exists when action === 'status'
      const newStatus = status!;

      // Update all leads
      await prisma.lead.updateMany({
        where: {
          id: { in: leadIds },
          userId: userId,
        },
        data: {
          status: newStatus,
          ...(['contacted', 'called'].includes(newStatus) && { lastContactedAt: new Date() }),
        },
      });

      return NextResponse.json({
        message: `Updated ${leads.length} leads to "${newStatus}"`,
        updatedCount: leads.length,
      });
    }

    if (action === 'add_tag') {
      if (!tagId) {
        return NextResponse.json({ error: 'Tag ID is required' }, { status: 400 });
      }

      // Verify tag belongs to user
      const tag = await prisma.tag.findFirst({
        where: {
          id: tagId,
          userId: userId,
        },
      });

      if (!tag) {
        return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
      }

      // Add tag to all leads (skip if already exists)
      let addedCount = 0;
      for (const lead of leads) {
        const existing = await prisma.leadTag.findUnique({
          where: {
            leadId_tagId: {
              leadId: lead.id,
              tagId,
            },
          },
        });

        if (!existing) {
          await prisma.leadTag.create({
            data: {
              leadId: lead.id,
              tagId,
            },
          });

          addedCount++;
        }
      }

      return NextResponse.json({
        message: `Added tag "${tag.name}" to ${addedCount} leads`,
        addedCount,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Bulk update error:', error);
    return routeErrorResponse(error, 'Failed to update leads');
  }
}

// DELETE - Bulk delete leads
export async function DELETE(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const { leadIds } = await parseRouteBody(request, bulkDeleteLeadsSchema);

    // Delete all leads (Prisma will cascade delete related records)
    const result = await prisma.lead.deleteMany({
      where: {
        id: { in: leadIds },
        userId: userId,
      },
    });

    return NextResponse.json({
      message: `Deleted ${result.count} leads`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    return routeErrorResponse(error, 'Failed to delete leads');
  }
}
