import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { Lead } from '@/types';
import { LeadDetailModal } from './LeadDetailModal';

vi.mock('@/components/crm', () => ({ StatusBadge: () => null }));
vi.mock('@/components/tasks', () => ({
  TaskList: () => null,
  TaskModal: () => null,
}));
vi.mock('./LeadScoreBadge', () => ({ LeadScoreBadge: () => null }));
vi.mock('./OpportunitiesList', () => ({ OpportunitiesList: () => null }));
vi.mock('./StatusSelector', () => ({ StatusSelector: () => null }));

const baseLead = {
  id: 'lead-1',
  placeId: 'place-1',
  name: 'Acme Dental',
  status: 'new',
  photoCount: 0,
  types: [],
  socialLinks: {},
  contactPoints: 0,
  leadScore: 50,
  scoreBreakdown: {},
  opportunities: [],
  industryType: 'medical',
  savedAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-01-01T12:00:00.000Z',
} as unknown as Lead;

function renderFollowUpDate(nextFollowUpAt: string | null, onUpdate = vi.fn()) {
  const lead = { ...baseLead, nextFollowUpAt } as unknown as Lead;
  const { container, getByRole } = render(
    <LeadDetailModal lead={lead} isOpen onClose={vi.fn()} onUpdate={onUpdate} />
  );
  const input = container.querySelector<HTMLInputElement>('input[type="date"]');
  if (!input) throw new Error('Follow-up date input was not rendered');

  return { container, getByRole, input, onUpdate };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LeadDetailModal follow-up date safety', () => {
  test('renders a null follow-up date as empty', () => {
    const { container, input } = renderFollowUpDate(null);

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('Currently set:');
  });

  test('renders an empty follow-up date as empty', () => {
    const { container, input } = renderFollowUpDate('');

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('Currently set:');
  });

  test('preserves a valid date-only follow-up value and display', () => {
    const { container, input } = renderFollowUpDate('2026-07-19');
    const expectedDisplay = new Date(2026, 6, 19).toLocaleDateString();

    expect(input.value).toBe('2026-07-19');
    expect(container.textContent).toContain(`Currently set: ${expectedDisplay}`);
  });

  test('preserves a valid ISO timestamp date and display', () => {
    const timestamp = '2026-07-19T15:30:00.000Z';
    const { container, input } = renderFollowUpDate(timestamp);

    expect(input.value).toBe('2026-07-19');
    expect(container.textContent).toContain(
      `Currently set: ${new Date(timestamp).toLocaleDateString()}`
    );
  });

  test('ignores a malformed follow-up date without crashing', () => {
    const { container, input } = renderFollowUpDate('not-a-date');

    expect(input.value).toBe('');
    expect(container.textContent).not.toContain('Currently set:');
    expect(container.textContent).not.toContain('Invalid Date');
  });

  test('saves a date-only follow-up as the agreed ISO timestamp', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve({ ok: init?.method === 'PATCH' } as Response)
    );
    const { getByRole, input, onUpdate } = renderFollowUpDate(null);

    fireEvent.change(input, { target: { value: '2026-07-19' } });
    fireEvent.click(getByRole('button', { name: 'Set' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leads/lead-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ nextFollowUpAt: '2026-07-19T12:00:00.000Z' }),
        })
      );
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ nextFollowUpAt: '2026-07-19T12:00:00.000Z' })
    );
  });

  test('clears a follow-up with null', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve({ ok: init?.method === 'PATCH' } as Response)
    );
    const { getByRole, input, onUpdate } = renderFollowUpDate('2026-07-19T12:00:00.000Z');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(getByRole('button', { name: 'Set' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leads/lead-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ nextFollowUpAt: null }),
        })
      );
    });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ nextFollowUpAt: null }));
  });
});
