'use client';

import { LEAD_STATUS_METADATA } from '@/lib/lead-status';
import type { LeadStatus } from '@/types';

interface StatusBadgeProps {
  status: LeadStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const metadata = LEAD_STATUS_METADATA[status];

  return <span className={`text-xs font-medium ${metadata.badgeClassName}`}>{metadata.label}</span>;
}
