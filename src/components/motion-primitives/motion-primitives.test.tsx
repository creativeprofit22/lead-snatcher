import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { SlidingNumber } from './sliding-number';
import { TextEffect } from './text-effect';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function renderedNumber(value: number, options?: { decimalSeparator?: string }) {
  const { container } = render(
    <SlidingNumber value={value} decimalSeparator={options?.decimalSeparator} />
  );
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error('SlidingNumber root was not rendered');
  return root;
}

describe('SlidingNumber', () => {
  test('renders one digit column for every valid integer digit', () => {
    const root = renderedNumber(42);

    expect(root.children).toHaveLength(2);
  });

  test('preserves the sign for a negative value', () => {
    const root = renderedNumber(-7);

    expect(root.childNodes[0]?.textContent).toBe('-');
    expect(root.children).toHaveLength(1);
  });

  test('renders decimal digits with the requested separator', () => {
    const root = renderedNumber(12.34, { decimalSeparator: ',' });

    expect(root.children).toHaveLength(5);
    expect(root.children[2]?.textContent).toBe(',');
  });
});

describe('TextEffect', () => {
  test('renders valid object variants without changing accessible text', () => {
    render(
      <TextEffect
        variants={{
          container: {
            visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
            exit: { opacity: 0 },
          },
          item: {
            hidden: { opacity: 0 },
            visible: { opacity: 1 },
            exit: { opacity: 0 },
          },
        }}
      >
        Object variants
      </TextEffect>
    );

    expect(screen.getByText('Object variants', { selector: '.sr-only' })).toBeTruthy();
  });

  test('tolerates missing variant segments', () => {
    render(
      <TextEffect
        variants={{
          container: { hidden: { opacity: 0 } },
          item: { visible: { opacity: 1 } },
        }}
      >
        Missing segments
      </TextEffect>
    );

    expect(screen.getByText('Missing segments', { selector: '.sr-only' })).toBeTruthy();
  });

  test('tolerates function variants when transitions are applied', () => {
    const resolveVisible = () => ({ opacity: 1 });

    render(
      <TextEffect
        variants={{
          container: { visible: resolveVisible, exit: resolveVisible },
          item: { visible: resolveVisible, exit: resolveVisible },
        }}
        containerTransition={{ duration: 0.2 }}
        segmentTransition={{ duration: 0.1 }}
      >
        Function variants
      </TextEffect>
    );

    expect(screen.getByText('Function variants', { selector: '.sr-only' })).toBeTruthy();
  });
});
