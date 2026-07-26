import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { LEAD_STATUS_METADATA, LEAD_STATUS_VALUES } from '@/lib/lead-status';
import type { Lead, LeadStatus } from '@/types';

import { KanbanBoard } from './KanbanBoard';

vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  Droppable: ({
    children,
  }: {
    children: (
      provided: {
        innerRef: () => void;
        droppableProps: Record<string, never>;
        placeholder: null;
      },
      snapshot: { isDraggingOver: boolean }
    ) => ReactNode;
  }) =>
    children(
      {
        innerRef: () => undefined,
        droppableProps: {},
        placeholder: null,
      },
      { isDraggingOver: false }
    ),
}));

vi.mock('./KanbanCard', () => ({
  KanbanCard: ({ lead }: { lead: Lead }) => <article>{lead.name}</article>,
}));

function createLead(status: LeadStatus): Lead {
  return {
    id: `lead-${status}`,
    placeId: `place-${status}`,
    name: `Lead: ${status}`,
    address: null,
    phone: null,
    website: null,
    rating: null,
    reviewCount: null,
    industryType: 'other',
    photoUrl: null,
    mapsUrl: null,
    leadScore: 0,
    scoreBreakdown: null,
    status,
    notes: null,
    opportunities: [],
    lastContactedAt: null,
    nextFollowUpAt: null,
    savedAt: '2026-07-25T10:00:00.000Z',
    updatedAt: '2026-07-25T10:00:00.000Z',
    tags: [],
    popularTimesData: null,
    popularTimesScrapedAt: null,
  };
}

afterEach(cleanup);

describe('KanbanBoard status coverage', () => {
  test('renders every valid status and its lead exactly once', () => {
    render(
      <KanbanBoard
        leads={LEAD_STATUS_VALUES.map(createLead)}
        onLeadClick={vi.fn()}
        onDelete={vi.fn()}
        onStatusChange={vi.fn().mockResolvedValue(undefined)}
      />
    );

    for (const status of LEAD_STATUS_VALUES) {
      const label = LEAD_STATUS_METADATA[status].label;
      const headings = screen.getAllByRole('heading', { name: label });
      const leadName = `Lead: ${status}`;

      expect(headings).toHaveLength(1);
      expect(screen.getAllByText(leadName)).toHaveLength(1);

      const column = headings[0]?.closest('.flex-col');
      expect(column).not.toBeNull();
      expect(within(column as HTMLElement).getByText(leadName)).toBeTruthy();
    }

    expect(screen.getByRole('heading', { name: 'Not Interested' })).toBeTruthy();
    expect(screen.getByText('Lead: not_interested')).toBeTruthy();
  });
});
