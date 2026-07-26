import { NextResponse } from 'next/server';
import { createOwnedContactLog } from '@/lib/business/contact-log-store';
import { prisma } from '@/lib/db';
import { parseRouteBody, requireRouteUserId, routeErrorResponse } from '@/lib/route-utils';
import { createContactLogSchema } from '@/lib/validations';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET - Get contact logs for a lead
export async function GET(request: Request, context: RouteContext) {
  try {
    const userId = await requireRouteUserId();

    const { id } = await context.params;

    // Verify ownership
    const lead = await prisma.lead.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const contactLogs = await prisma.contactLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ contactLogs });
  } catch (error) {
    console.error('Get contact logs error:', error);
    return routeErrorResponse(error, 'Failed to fetch contact logs');
  }
}

// POST - Add contact log entry
export async function POST(request: Request, context: RouteContext) {
  try {
    const userId = await requireRouteUserId();

    const { id } = await context.params;
    const { type, summary, outcome } = await parseRouteBody(request, createContactLogSchema);

    const contactLog = await createOwnedContactLog(userId, id, { type, summary, outcome });

    if (!contactLog) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({
      contactLog,
      message: 'Contact log added successfully',
    });
  } catch (error) {
    console.error('Add contact log error:', error);
    return routeErrorResponse(error, 'Failed to add contact log');
  }
}
