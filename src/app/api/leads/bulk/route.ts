import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { bulkUpdateLeadsSchema, bulkDeleteLeadsSchema } from '@/lib/validations';
import { parseRouteBody, requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';

// PATCH - Bulk update leads (status change or add tag)
export async function PATCH(request: Request) {
  try {
    const userId = await requireRouteUserId();
    const update = await parseRouteBody(request, bulkUpdateLeadsSchema);

    // Verify all leads belong to user.
    const leads = await prisma.lead.findMany({
      where: {
        id: { in: update.leadIds },
        userId,
      },
      select: { id: true },
    });

    if (leads.length !== update.leadIds.length) {
      return NextResponse.json({ error: 'Some leads not found' }, { status: 404 });
    }

    if (update.action === 'status') {
      await prisma.lead.updateMany({
        where: {
          id: { in: update.leadIds },
          userId,
        },
        data: {
          status: update.status,
          ...(['contacted', 'called'].includes(update.status) && {
            lastContactedAt: new Date(),
          }),
        },
      });

      return NextResponse.json({
        message: `Updated ${leads.length} leads to "${update.status}"`,
        updatedCount: leads.length,
      });
    }

    const result = await prisma.$transaction(async (transaction) => {
      const tag = await transaction.tag.findFirst({
        where: {
          id: update.tagId,
          userId,
        },
        select: { name: true },
      });

      if (!tag) {
        return null;
      }

      const existingLinks = await transaction.leadTag.findMany({
        where: {
          leadId: { in: update.leadIds },
          tagId: update.tagId,
        },
        select: { leadId: true },
      });
      const existingLeadIds = new Set(existingLinks.map((link) => link.leadId));
      const missingLeadIds = update.leadIds.filter((leadId) => !existingLeadIds.has(leadId));

      const created = missingLeadIds.length
        ? await transaction.leadTag.createMany({
            data: missingLeadIds.map((leadId) => ({ leadId, tagId: update.tagId })),
          })
        : { count: 0 };

      return {
        tagName: tag.name,
        requestedCount: update.leadIds.length,
        alreadyPresentCount: existingLinks.length,
        addedCount: created.count,
      };
    });

    if (!result) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: `Added tag "${result.tagName}" to ${result.addedCount} leads`,
      requestedCount: result.requestedCount,
      alreadyPresentCount: result.alreadyPresentCount,
      addedCount: result.addedCount,
    });
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
