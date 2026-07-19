import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { HoloCard } from './HoloCard';

function renderGlareBackground(glareColor: string, glareOpacity = 0.4) {
  const { container } = render(
    <HoloCard glareColor={glareColor} glareOpacity={glareOpacity}>
      <span>Content</span>
    </HoloCard>
  );
  const overlays = container.querySelectorAll<HTMLElement>('[aria-hidden="true"]');

  return overlays[1]?.style.background ?? '';
}

afterEach(cleanup);

describe('HoloCard glare colors', () => {
  test('expands a 3-digit hex color into an rgba glare', () => {
    expect(renderGlareBackground('#3af')).toContain('rgba(51, 170, 255, 0.4)');
  });

  test('converts a 6-digit hex color into an rgba glare', () => {
    expect(renderGlareBackground('#336699', 0.25)).toContain('rgba(51, 102, 153, 0.25)');
  });

  test('falls back to the default glare when the color is invalid', () => {
    const background = renderGlareBackground('not-a-hex-color');

    expect(background).toContain('rgba(155, 232, 255, 0.4)');
    expect(background).not.toContain('NaN');
  });
});
