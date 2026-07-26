import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { LEAD_STATUS_METADATA, LEAD_STATUS_VALUES } from '@/lib/lead-status';

import { StatusBadge } from './StatusBadge';

afterEach(cleanup);

describe('StatusBadge', () => {
  test.each(LEAD_STATUS_VALUES)('uses canonical metadata for %s', (status) => {
    render(<StatusBadge status={status} />);

    const metadata = LEAD_STATUS_METADATA[status];
    const badge = screen.getByText(metadata.label);

    expect(badge.classList).toContain(metadata.badgeClassName);
  });

  test('renders the full Proposal Sent label', () => {
    render(<StatusBadge status="proposal_sent" />);

    expect(screen.getByText('Proposal Sent')).toBeTruthy();
    expect(screen.queryByText('Proposal')).toBeNull();
  });
});
