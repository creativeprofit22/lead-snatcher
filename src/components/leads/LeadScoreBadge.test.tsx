import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { LeadScoreBadge } from './LeadScoreBadge';

vi.mock('@/components/motion-primitives/sliding-number', () => ({
  SlidingNumber: ({ value }: { value: number }) => <span>{value}</span>,
}));
vi.mock('@/components/motion-primitives/text-effect', () => ({
  TextEffect: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/motion-primitives/glow-effect', () => ({ GlowEffect: () => null }));

afterEach(cleanup);

describe('LeadScoreBadge score bands', () => {
  test.each([
    [34, 'cold', 'Cold', 'snowflake', ['text-blue-300', 'border-blue-500/20', 'bg-blue-500/5']],
    [35, 'mid', 'Warm', 'sparkles', ['text-gray-300', 'border-white/10', 'bg-white/5']],
    [54, 'mid', 'Warm', 'sparkles', ['text-gray-300', 'border-white/10', 'bg-white/5']],
    [55, 'hot', 'Hot', 'flame', ['text-orange-300', 'border-orange-500/30', 'bg-orange-500/10']],
  ] as const)(
    'renders score %i as a %s lead with its label, icon, and palette',
    (score, expectedBand, expectedLabel, expectedIcon, expectedClasses) => {
      const { container } = render(<LeadScoreBadge score={score} />);

      const badge = container.querySelector(`[data-lead-score-band="${expectedBand}"]`);
      const button = screen.getByRole('button', {
        name: `${expectedLabel} lead score: ${score}`,
      });

      expect(badge).not.toBeNull();
      expect(screen.getByText(expectedLabel)).toBeTruthy();
      expect(container.querySelector(`.lucide-${expectedIcon}`)).not.toBeNull();
      expect(expectedClasses.every((className) => button.classList.contains(className))).toBe(true);
    }
  );
});
