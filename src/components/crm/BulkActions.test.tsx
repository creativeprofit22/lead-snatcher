import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Lead } from '@/types';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: successToast, error: errorToast },
}));

import { BulkActions } from './BulkActions';

function lead(id: string): Lead {
  return {
    id,
    placeId: `place-${id}`,
    name: `Lead ${id}`,
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BulkActions tag feedback', () => {
  test('reports the server addedCount instead of the selected lead count', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestedCount: 3,
        alreadyPresentCount: 2,
        addedCount: 1,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const tagCatalog = {
      tags: [
        {
          id: 'tag-1',
          name: 'Priority',
          color: '#3b82f6',
          createdAt: '2026-07-25T10:00:00.000Z',
          leadCount: 2,
        },
      ],
      loading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue(undefined),
    };

    render(
      <BulkActions
        selectedLeads={[lead('lead-1'), lead('lead-2'), lead('lead-3')]}
        onClearSelection={vi.fn()}
        onBulkUpdate={vi.fn().mockResolvedValue(undefined)}
        tagCatalog={tagCatalog}
      />
    );

    const addTagButton = screen.getByRole('button', { name: 'Add Tag' });
    fireEvent.click(addTagButton);
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));

    await waitFor(() => {
      expect(successToast).toHaveBeenCalledWith('Added "Priority" to 1 lead');
    });
    expect(errorToast).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/leads/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leadIds: ['lead-1', 'lead-2', 'lead-3'],
        action: 'add_tag',
        tagId: 'tag-1',
      }),
    });
  });
});
