import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Lead } from '@/types';

import { KanbanCard } from './KanbanCard';
import { LeadsTableRow } from './LeadsTableRow';

vi.mock('@hello-pangea/dnd', () => ({
  Draggable: ({
    children,
  }: {
    children: (
      provided: {
        innerRef: () => void;
        draggableProps: Record<string, never>;
        dragHandleProps: Record<string, never>;
      },
      snapshot: { isDragging: boolean }
    ) => ReactNode;
  }) =>
    children(
      {
        innerRef: () => undefined,
        draggableProps: {},
        dragHandleProps: {},
      },
      { isDragging: false }
    ),
}));

vi.mock('./LeadsTableActions', () => ({
  LeadsTableActions: () => null,
}));

function createLead(website: string | null, leadScore = 50): Lead {
  return {
    id: 'lead-1',
    placeId: 'place-1',
    name: 'Example lead',
    address: null,
    phone: null,
    website,
    rating: null,
    reviewCount: null,
    industryType: 'other',
    photoUrl: null,
    mapsUrl: null,
    leadScore,
    scoreBreakdown: null,
    status: 'new',
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

function renderCard(website: string | null) {
  return render(
    <KanbanCard lead={createLead(website)} index={0} onLeadClick={vi.fn()} onDelete={vi.fn()} />
  );
}

afterEach(cleanup);

describe('KanbanCard website display', () => {
  test.each([
    ['http://www.example.com/about', 'www.example.com'],
    ['https://example.org/contact?from=crm', 'example.org'],
  ])('shows the hostname for a full HTTP(S) URL', (website, hostname) => {
    renderCard(website);

    expect(screen.getByText(hostname)).toBeTruthy();
  });

  test('shows the hostname for an unambiguous scheme-less URL', () => {
    renderCard('example.com/services');

    expect(screen.getByText('example.com')).toBeTruthy();
  });

  test.each(['https://[broken', 'ftp://example.com'])(
    'falls back for unsafe value %s',
    (website) => {
      renderCard(website);

      expect(screen.getByText('Invalid website')).toBeTruthy();
    }
  );

  test('omits the website row when no website is persisted', () => {
    const { container } = renderCard(null);

    expect(screen.queryByText('Invalid website')).toBeNull();
    expect(container.querySelector('.lucide-globe')).toBeNull();
  });
});

describe('CRM lead score bands', () => {
  test.each([
    [34, 'cold'],
    [35, 'mid'],
    [54, 'mid'],
    [55, 'hot'],
  ] as const)('keeps List and Kanban aligned for a score of %i', (leadScore, expectedBand) => {
    const lead = createLead(null, leadScore);
    const { container } = render(
      <>
        <table>
          <tbody>
            <LeadsTableRow lead={lead} onLeadClick={vi.fn()} onDelete={vi.fn()} />
          </tbody>
        </table>
        <KanbanCard lead={lead} index={0} onLeadClick={vi.fn()} onDelete={vi.fn()} />
      </>
    );

    const renderedBands = Array.from(
      container.querySelectorAll('[data-lead-score-band]'),
      (element) => element.getAttribute('data-lead-score-band')
    );

    expect(renderedBands).toEqual([expectedBand, expectedBand]);
  });
});
