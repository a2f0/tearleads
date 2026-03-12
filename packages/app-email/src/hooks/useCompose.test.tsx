import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type EmailDatabaseState,
  EmailProvider,
  type EmailUIComponents
} from '../context';
import { useCompose } from './useCompose';

const mockUIComponents: EmailUIComponents = {
  BackLink: () => null,
  RefreshButton: () => null
};

const defaultDatabaseState: EmailDatabaseState = {
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: null
};

const createWrapper =
  (options?: { apiBaseUrl?: string; getAuthHeader?: () => string | null }) =>
  ({ children }: { children: ReactNode }) => (
    <EmailProvider
      apiBaseUrl={options?.apiBaseUrl ?? 'http://localhost:5001/v1'}
      databaseState={defaultDatabaseState}
      ui={mockUIComponents}
      {...(options?.getAuthHeader !== undefined && {
        getAuthHeader: options.getAuthHeader
      })}
    >
      {children}
    </EmailProvider>
  );

describe('useCompose', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('sends compose payload through the VFS connect SendEmail route', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    });

    const { result } = renderHook(() => useCompose(), {
      wrapper: createWrapper({ getAuthHeader: () => 'Bearer token123' })
    });

    act(() => {
      result.current.setTo('to@example.com');
      result.current.setCc('cc@example.com');
      result.current.setBcc('bcc@example.com');
      result.current.setSubject('Connect path test');
      result.current.setBody('Body text');
    });

    let sendResult = false;
    await act(async () => {
      sendResult = await result.current.send();
    });

    expect(sendResult).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:5001/v1/connect/tearleads.v2.VfsService/SendEmail',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token123'
        },
        body: JSON.stringify({
          draftId: null,
          to: ['to@example.com'],
          cc: ['cc@example.com'],
          bcc: ['bcc@example.com'],
          subject: 'Connect path test',
          body: 'Body text',
          attachments: []
        })
      }
    );
  });
});
