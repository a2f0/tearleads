import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailProvider, type EmailUIComponents } from '../context';
import { mockConsoleError } from '../test/consoleMocks';
import { useEmails } from './useEmails';

const mockUIComponents: EmailUIComponents = {
  AboutMenuItem: () => null,
  BackLink: () => null,
  DropdownMenu: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
  RefreshButton: () => null,
  WindowOptionsMenuItem: () => null
};

const mockEmails = [
  {
    id: 'email-1',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'Test Subject',
    receivedAt: '2024-01-15T10:00:00Z',
    size: 1024
  }
];

describe('useEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const createWrapper =
    (options?: { apiBaseUrl?: string; getAuthHeader?: () => string | null }) =>
    ({ children }: { children: ReactNode }) => (
      <EmailProvider
        apiBaseUrl={options?.apiBaseUrl ?? 'http://localhost:5001/v1'}
        ui={mockUIComponents}
        {...(options?.getAuthHeader !== undefined && {
          getAuthHeader: options.getAuthHeader
        })}
      >
        {children}
      </EmailProvider>
    );

  it('returns initial state with empty emails and no loading', () => {
    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper()
    });

    expect(result.current.emails).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(typeof result.current.fetchEmails).toBe('function');
  });

  it('fetches emails successfully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper()
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(result.current.emails).toEqual(mockEmails);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('sets loading state during fetch', async () => {
    let resolvePromise: ((value: unknown) => void) | undefined;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(promise);

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper()
    });

    act(() => {
      result.current.fetchEmails();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });

    await act(async () => {
      resolvePromise?.({
        ok: true,
        json: async () => ({ emails: [] })
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('handles fetch error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error'
    });
    const consoleSpy = mockConsoleError();

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper()
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(result.current.error).toBe(
      'Failed to fetch emails: Internal Server Error'
    );
    expect(result.current.loading).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch emails:',
      expect.any(Error)
    );
  });

  it('handles network error', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error')
    );
    const consoleSpy = mockConsoleError();

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper()
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.loading).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch emails:',
      expect.any(Error)
    );
  });

  it('clears error on new fetch', async () => {
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: false,
        statusText: 'Error'
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ emails: mockEmails })
      });
    mockConsoleError();

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper()
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(result.current.error).toBe('Failed to fetch emails: Error');

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(result.current.error).toBe(null);
    expect(result.current.emails).toEqual(mockEmails);
  });

  it('uses apiBaseUrl from context', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper({ apiBaseUrl: 'http://custom-api.com/v1' })
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://custom-api.com/v1/vfs/emails',
      {}
    );
  });

  it('includes auth header when getAuthHeader is provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper({ getAuthHeader: () => 'Bearer token123' })
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5001/v1/vfs/emails',
      { headers: { Authorization: 'Bearer token123' } }
    );
  });

  it('does not include auth header when getAuthHeader returns null', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper({ getAuthHeader: () => null })
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5001/v1/vfs/emails',
      {}
    );
  });

  it('handles missing emails array in response', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({})
    });

    const { result } = renderHook(() => useEmails(), {
      wrapper: createWrapper()
    });

    await act(async () => {
      await result.current.fetchEmails();
    });

    expect(result.current.emails).toEqual([]);
  });
});
