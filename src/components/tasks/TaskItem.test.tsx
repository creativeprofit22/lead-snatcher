import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { TaskItem } from './TaskItem';
import { TaskList } from './TaskList';
import type { Task } from '@/types';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type TaskItemCallbackIsAsync = Assert<
  Equal<ReturnType<ComponentProps<typeof TaskItem>['onComplete']>, Promise<void>>
>;
type TaskListCallbackIsAsync = Assert<
  Equal<ReturnType<ComponentProps<typeof TaskList>['onComplete']>, Promise<void>>
>;

const asyncCallbackTypeAssertions: [TaskItemCallbackIsAsync, TaskListCallbackIsAsync] = [
  true,
  true,
];

const task: Task = {
  id: 'task-1',
  title: 'Call Acme',
  type: 'call',
  dueAt: '2099-01-01T12:00:00.000Z',
  priority: 'high',
  createdAt: '2026-01-01T12:00:00.000Z',
};

function createDeferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function renderTaskItem(onComplete: ComponentProps<typeof TaskItem>['onComplete']) {
  render(<TaskItem task={task} onComplete={onComplete} onEdit={vi.fn()} onDelete={vi.fn()} />);
}

afterEach(cleanup);

describe('TaskItem async completion', () => {
  test('keeps a resolved completion complete after pending clears', async () => {
    const completion = createDeferred();
    renderTaskItem(() => completion.promise);

    const completeButton = screen.getByRole('button', { name: 'Complete Call Acme' });
    fireEvent.click(completeButton);

    expect(completeButton.getAttribute('aria-pressed')).toBe('true');
    expect(completeButton.hasAttribute('disabled')).toBe(true);

    await act(async () => completion.resolve());

    expect(screen.getByRole('button', { name: 'Reopen Call Acme' }).hasAttribute('disabled')).toBe(
      false
    );
    expect(completeButton.getAttribute('aria-pressed')).toBe('true');
  });

  test('rolls back a rejected completion and allows retrying it', async () => {
    const rejectedCompletion = createDeferred();
    const onComplete = vi
      .fn<ComponentProps<typeof TaskItem>['onComplete']>()
      .mockImplementationOnce(() => rejectedCompletion.promise)
      .mockResolvedValueOnce();
    renderTaskItem(onComplete);

    const completeButton = screen.getByRole('button', { name: 'Complete Call Acme' });
    fireEvent.click(completeButton);

    expect(completeButton.getAttribute('aria-pressed')).toBe('true');
    expect(completeButton.hasAttribute('disabled')).toBe(true);

    await act(async () => rejectedCompletion.reject(new Error('Request failed')));

    expect(completeButton.getAttribute('aria-pressed')).toBe('false');
    expect(completeButton.hasAttribute('disabled')).toBe(false);

    await act(async () => fireEvent.click(completeButton));

    expect(onComplete).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenLastCalledWith('task-1', true);
    expect(completeButton.getAttribute('aria-pressed')).toBe('true');
    expect(completeButton.hasAttribute('disabled')).toBe(false);
  });

  test('requires TaskItem and TaskList completion callbacks to return promises', () => {
    expect(asyncCallbackTypeAssertions).toEqual([true, true]);
  });
});
