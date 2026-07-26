import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  SavedSessionCorruptSummary,
  SavedSessionReadySummary,
  SavedSessionRecord,
} from '@/lib/business/saved-sessions-store';
import {
  SEARCH_SNAPSHOT_VERSION,
  type PersistedSearchPayload,
} from '@/lib/business/search-snapshot';
import { SavedSessionsPanel } from './SavedSessionsPanel';

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({ toast }));

const payload: PersistedSearchPayload = {
  version: SEARCH_SNAPSHOT_VERSION,
  results: [],
  businessType: 'retail',
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
  timestamp: 1_725_000_123_456,
};

const readySummary: SavedSessionReadySummary = {
  id: 'session-1',
  name: 'Leeds retail',
  status: 'ready',
  businessType: 'retail',
  industry: 'retail',
  city: 'Leeds',
  country: 'gb',
  resultCount: 0,
  createdAt: '2026-07-25T09:00:00.000Z',
  updatedAt: '2026-07-25T10:00:00.000Z',
};

const corruptSummary: SavedSessionCorruptSummary = {
  id: 'session-corrupt',
  name: 'Damaged session',
  status: 'corrupt',
  message: 'Saved session data is corrupted and cannot be loaded.',
  createdAt: '2026-07-25T09:00:00.000Z',
  updatedAt: '2026-07-25T10:00:00.000Z',
};

function response(data: unknown, ok = true): Response {
  return { ok, json: vi.fn().mockResolvedValue(data) } as unknown as Response;
}

function openPanel(onLoad = vi.fn()) {
  render(<SavedSessionsPanel onLoad={onLoad} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved' }));
  return onLoad;
}

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SavedSessionsPanel', () => {
  test('renders a corrupt listed row as unavailable with Delete still enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ sessions: [corruptSummary] })));

    openPanel();

    expect(await screen.findByText('Unavailable')).toBeTruthy();
    expect(screen.getByText(/Saved session data is corrupted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Delete "Damaged session"' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  test('deletes a corrupt row and returns to the empty recovery state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ sessions: [corruptSummary] }))
      .mockResolvedValueOnce(response({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    openPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete "Damaged session"' }));

    await waitFor(() => expect(screen.queryByText('Damaged session')).toBeNull());
    expect(screen.getByText('No saved sessions yet.')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/business/saved-sessions/session-corrupt', {
      method: 'DELETE',
    });
    expect(toast.success).toHaveBeenCalledWith('Deleted "Damaged session"');
  });

  test('turns a stale ready row into an unavailable row when member loading detects corruption', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ sessions: [readySummary] }))
      .mockResolvedValueOnce(response({ session: corruptSummary }));
    vi.stubGlobal('fetch', fetchMock);
    const onLoad = openPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));

    expect(await screen.findByText('Unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete "Damaged session"' })).toBeTruthy();
    expect(onLoad).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      '"Leeds retail" is unavailable because its saved data is corrupted'
    );
  });

  test('loads a valid saved session payload and closes the panel', async () => {
    const record: SavedSessionRecord = { ...readySummary, payload };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ sessions: [readySummary] }))
        .mockResolvedValueOnce(response({ session: record }))
    );
    const onLoad = openPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));

    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(payload));
    expect(screen.queryByRole('heading', { name: 'Saved Sessions' })).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Loaded "Leeds retail"');
  });
});
