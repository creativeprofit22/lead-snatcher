import { prisma } from '@/lib/db';

export interface CreateOwnedContactLogInput {
  type: string;
  summary: string;
  outcome?: string;
}

/**
 * Adds a contact event only when the lead belongs to the user.
 * A null result deliberately keeps foreign and missing lead IDs indistinguishable.
 */
export async function createOwnedContactLog(
  userId: string,
  leadId: string,
  input: CreateOwnedContactLogInput
) {
  return prisma.$transaction(async (transaction) => {
    const lead = await transaction.lead.findFirst({
      where: { id: leadId, userId },
      select: { id: true },
    });
    if (!lead) return null;

    const contactLog = await transaction.contactLog.create({
      data: {
        leadId: lead.id,
        type: input.type,
        summary: input.summary,
        outcome: input.outcome,
      },
    });

    await transaction.lead.update({
      where: { id: lead.id },
      data: { lastContactedAt: new Date() },
    });

    return contactLog;
  });
}
