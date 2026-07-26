import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getLeadScoreBand } from '@/lib/business/lead-score-band';
import { prisma } from '@/lib/db';
import {
  createLeadStatusRecord,
  parseLeadStatus,
  TERMINAL_LEAD_STATUS_VALUES,
} from '@/lib/lead-status';
import type { PipelineStats } from '@/types';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all leads for the user
    const leads = await prisma.lead.findMany({
      where: { userId: session.user.id },
      select: {
        status: true,
        leadScore: true,
      },
    });

    // Calculate stats
    const total = leads.length;

    // Count by status
    const byStatus = createLeadStatusRecord(() => 0);

    let totalScore = 0;
    let hotLeads = 0;
    let coldLeads = 0;

    leads.forEach((lead) => {
      byStatus[parseLeadStatus(lead.status)]++;
      totalScore += lead.leadScore;

      const scoreBand = getLeadScoreBand(lead.leadScore);
      if (scoreBand === 'hot') hotLeads++;
      else if (scoreBand === 'cold') coldLeads++;
    });

    // Calculate conversion rate (won / total closed)
    const closedDeals = TERMINAL_LEAD_STATUS_VALUES.reduce(
      (count, status) => count + byStatus[status],
      0
    );
    const conversionRate = closedDeals > 0 ? (byStatus.won / closedDeals) * 100 : 0;

    // Average lead score
    const avgLeadScore = total > 0 ? Math.round(totalScore / total) : 0;

    const stats: PipelineStats = {
      total,
      byStatus,
      conversionRate: Math.round(conversionRate * 10) / 10,
      avgLeadScore,
      hotLeads,
      coldLeads,
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Get stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
