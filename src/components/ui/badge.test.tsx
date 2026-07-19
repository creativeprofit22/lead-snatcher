import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { Badge } from '@/components/ui/badge';

test('Badge preserves link semantics when rendered as a child', () => {
  render(
    <Badge asChild variant="outline">
      <a href="/crm">View leads</a>
    </Badge>
  );

  const link = screen.getByRole('link', { name: 'View leads' });

  expect(link.getAttribute('href')).toBe('/crm');
  expect(link.getAttribute('data-slot')).toBe('badge');
});
