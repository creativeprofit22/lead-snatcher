import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ResumeSearchCard } from './ResumeSearchCard';
import { SavedSessionsPanel } from './SavedSessionsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('search session labels', () => {
  test('resume card shows the custom business query', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));

    render(
      <ResumeSearchCard
        businessType="HVAC contractors"
        city="Austin"
        resultCount={12}
        updatedAt="2026-07-26T11:00:00.000Z"
        onResume={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText('Resume: HVAC contractors in Austin')).toBeTruthy();
  });

  test('saved-session summary shows the custom business query', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessions: [
            {
              id: 'session-1',
              name: 'Austin HVAC',
              businessType: 'HVAC contractors',
              industry: 'other',
              city: 'Austin',
              country: 'us',
              resultCount: 12,
              createdAt: '2026-07-26T10:00:00.000Z',
              updatedAt: '2026-07-26T11:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetcher);

    render(<SavedSessionsPanel onLoad={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved' }));

    expect(await screen.findByText('HVAC contractors · Austin')).toBeTruthy();
  });
});
