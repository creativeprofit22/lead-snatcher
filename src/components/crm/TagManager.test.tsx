import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CrmTagsResource } from '@/lib/hooks/useCrmTags';
import { TagManager } from './TagManager';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: successToast, error: errorToast },
}));

const tagCatalog: CrmTagsResource = {
  tags: [
    {
      id: 'tag-1',
      name: 'Priority',
      color: '#3b82f6',
      createdAt: '2026-07-25T10:00:00.000Z',
      leadCount: 0,
    },
  ],
  loading: false,
  error: null,
  refetch: vi.fn().mockResolvedValue(undefined),
};

function renderTagManager(onMutation = vi.fn().mockResolvedValue(undefined)) {
  render(<TagManager isOpen onClose={vi.fn()} tagCatalog={tagCatalog} onMutation={onMutation} />);

  return { onMutation };
}

function openCreateForm(name: string): HTMLInputElement {
  fireEvent.click(screen.getByRole('button', { name: 'Create new tag' }));
  const input = screen.getByRole('textbox', { name: 'New tag name' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: name } });
  return input;
}

function openEditForm(name: string): HTMLInputElement {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Priority' }));
  const input = screen.getByRole('textbox', { name: 'Rename Priority' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: name } });
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TagManager mutation feedback', () => {
  test('reconciles and reports create success when the 2xx body is empty', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetcher);
    const { onMutation } = renderTagManager();

    openCreateForm('  Qualified  ');
    fireEvent.click(screen.getByRole('button', { name: 'Save new tag' }));

    await waitFor(() => expect(onMutation).toHaveBeenCalledWith({ type: 'created' }));
    expect(successToast).toHaveBeenCalledWith('Tag created');
    expect(errorToast).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'New tag name' })).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Qualified', color: '#3b82f6' }),
    });
  });

  test('reconciles and reports update success when the 2xx body is not JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>not JSON</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    vi.stubGlobal('fetch', fetcher);
    const { onMutation } = renderTagManager();

    openEditForm('Qualified');
    fireEvent.click(screen.getByRole('button', { name: 'Save Priority' }));

    await waitFor(() => expect(onMutation).toHaveBeenCalledWith({ type: 'updated' }));
    expect(successToast).toHaveBeenCalledWith('Tag updated');
    expect(errorToast).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Rename Priority' })).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('/api/tags/tag-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Qualified', color: '#3b82f6' }),
    });
  });

  test('shows a validated server error and preserves create state after an HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: 'A tag with this name already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const { onMutation } = renderTagManager();

    const input = openCreateForm('Priority');
    fireEvent.click(screen.getByRole('button', { name: 'Save new tag' }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith('A tag with this name already exists')
    );
    expect(input.value).toBe('Priority');
    expect(screen.getByRole('button', { name: 'Save new tag' })).toBeTruthy();
    expect(onMutation).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });

  test('uses the generic fallback and preserves create state for an HTML error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<html>Server error</html>', {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        })
      )
    );
    const { onMutation } = renderTagManager();

    const input = openCreateForm('Retry me');
    fireEvent.click(screen.getByRole('button', { name: 'Save new tag' }));

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Failed to create tag'));
    expect(input.value).toBe('Retry me');
    expect(screen.getByRole('button', { name: 'Save new tag' })).toBeTruthy();
    expect(onMutation).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });

  test('preserves edit state and skips reconciliation after a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    const { onMutation } = renderTagManager();

    const input = openEditForm('Retry me');
    fireEvent.click(screen.getByRole('button', { name: 'Save Priority' }));

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Failed to update tag'));
    expect(input.value).toBe('Retry me');
    expect(screen.getByRole('button', { name: 'Save Priority' })).toBeTruthy();
    expect(onMutation).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });
});
