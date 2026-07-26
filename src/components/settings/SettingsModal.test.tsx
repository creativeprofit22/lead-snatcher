import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ApiKeySettingsGetResponse } from '@/lib/api-key-settings-contract';
import {
  API_KEY_MAX_LENGTH,
  API_KEY_SERVICE_REGISTRY,
  API_KEY_SERVICES,
} from '@/lib/api-key-services';
import { SettingsModal } from './SettingsModal';

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: successToast, error: errorToast },
}));

const emptySettings: ApiKeySettingsGetResponse = API_KEY_SERVICES.map((service) => ({
  service,
  maskedKey: null,
  hasKey: false,
}));

const configuredSettings: ApiKeySettingsGetResponse = [
  { service: 'rapidapi', maskedKey: 'abcd••••wxyz', hasKey: true },
  { service: 'pagespeed', maskedKey: null, hasKey: false },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function methodOf(init?: RequestInit): string {
  return init?.method ?? 'GET';
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SettingsModal API key feedback', () => {
  test('renders every configurable service once and applies the shared input limit', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(emptySettings)));

    render(<SettingsModal isOpen onClose={vi.fn()} />);

    await screen.findByText(API_KEY_SERVICE_REGISTRY[0]!.label);
    for (const service of API_KEY_SERVICE_REGISTRY) {
      expect(screen.getAllByText(service.label)).toHaveLength(1);
    }
    expect(screen.getAllByRole('button', { name: 'Add key' })).toHaveLength(
      API_KEY_SERVICE_REGISTRY.length
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Add key' })[0]!);
    const input = screen.getByPlaceholderText('Enter your RapidAPI Key') as HTMLInputElement;
    expect(input.maxLength).toBe(API_KEY_MAX_LENGTH);
  });

  test('shows a safe load error and retry instead of false add-key state', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'Failed to fetch API keys' }, 500))
      .mockResolvedValueOnce(jsonResponse(emptySettings));
    vi.stubGlobal('fetch', fetcher);

    render(<SettingsModal isOpen onClose={vi.fn()} />);

    expect((await screen.findByRole('alert')).textContent).toContain('Failed to fetch API keys');
    expect(screen.queryByRole('button', { name: 'Add key' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add key' })).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('sends a validated POST error message to the toast and keeps the editor open', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (methodOf(init) === 'POST') {
        return jsonResponse({ error: 'API key is required by this provider' }, 400);
      }
      return jsonResponse(emptySettings);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    const addButtons = await screen.findAllByRole('button', { name: 'Add key' });
    fireEvent.click(addButtons[0]!);
    const input = screen.getByPlaceholderText('Enter your RapidAPI Key') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'replacement-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith('API key is required by this provider')
    );
    expect(input.value).toBe('replacement-key');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(successToast).not.toHaveBeenCalled();
  });

  test('sends a validated DELETE 404 message to the toast and preserves configured state', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (methodOf(init) === 'DELETE') {
        return jsonResponse({ error: 'API key not found' }, 404);
      }
      return jsonResponse(configuredSettings);
    });
    vi.stubGlobal('fetch', fetcher);
    render(<SettingsModal isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove RapidAPI Key' }));

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('API key not found'));
    expect(screen.getByText('abcd••••wxyz')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update key' })).toBeTruthy();
    expect(successToast).not.toHaveBeenCalled();
  });
});
