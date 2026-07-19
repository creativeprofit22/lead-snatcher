import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useCyclingPlaceholder } from './useCyclingPlaceholder';

function advanceTimer(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useCyclingPlaceholder phrase safety', () => {
  test('stays empty when no phrases are available', () => {
    const { result } = renderHook(() =>
      useCyclingPlaceholder({
        phrases: [],
        typeSpeedMs: 10,
        deleteSpeedMs: 10,
        holdMs: 20,
      })
    );

    advanceTimer(1_000);

    expect(result.current).toBe('');
  });

  test('truncates safely and keeps cycling when the current phrase is shortened', () => {
    const { result, rerender } = renderHook(
      ({ phrases }: { phrases: string[] }) =>
        useCyclingPlaceholder({
          phrases,
          typeSpeedMs: 10,
          deleteSpeedMs: 10,
          holdMs: 20,
        }),
      { initialProps: { phrases: ['abcdef'] } }
    );

    advanceTimer(10);
    advanceTimer(10);
    advanceTimer(10);
    advanceTimer(10);
    expect(result.current).toBe('abcd');

    rerender({ phrases: ['ab'] });
    expect(result.current).toBe('ab');

    advanceTimer(20);
    advanceTimer(10);
    expect(result.current).toBe('a');
  });
});
