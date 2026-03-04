import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailBodyOperations, EmailUIComponents } from '../context';
import { EmailProvider } from '../context';
import type { ParsedEmailBody } from '../types/emailBody';
import { useEmailBody } from './useEmailBody';

vi.mock('../lib/mimeParser.js', () => ({
  parseMimeMessage: vi.fn()
}));

async function getMimeParserMock() {
  const mod = await import('../lib/mimeParser.js');
  return vi.mocked(mod.parseMimeMessage);
}

const mockUI: EmailUIComponents = {
  DropdownMenu: () => null,
  DropdownMenuItem: () => null,
  DropdownMenuSeparator: () => null,
  WindowOptionsMenuItem: () => null,
  AboutMenuItem: () => null,
  BackLink: () => null,
  RefreshButton: () => null
};

const PLAIN_TEXT_BODY: ParsedEmailBody = {
  text: 'Hello world',
  html: null,
  attachments: []
};

const MULTIPART_BODY: ParsedEmailBody = {
  text: 'Plain text',
  html: '<p>HTML content</p>',
  attachments: []
};

describe('useEmailBody', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockParse = await getMimeParserMock();
    mockParse.mockResolvedValue(PLAIN_TEXT_BODY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null body when emailId is null', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider apiBaseUrl="http://test" ui={mockUI}>
        {children}
      </EmailProvider>
    );

    const { result } = renderHook(() => useEmailBody(null), { wrapper });

    expect(result.current.body).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error when bodyOperations are not provided', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider apiBaseUrl="http://test" ui={mockUI}>
        {children}
      </EmailProvider>
    );

    const { result } = renderHook(() => useEmailBody('email-1'), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe(
        'Email body operations are not configured'
      );
    });
    expect(result.current.body).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('fetches and parses plain text email body', async () => {
    const mockBodyOps: EmailBodyOperations = {
      fetchDecryptedBody: vi.fn().mockResolvedValue('raw mime data')
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider
        apiBaseUrl="http://test"
        ui={mockUI}
        bodyOperations={mockBodyOps}
      >
        {children}
      </EmailProvider>
    );

    const { result } = renderHook(() => useEmailBody('email-1'), { wrapper });

    await waitFor(() => {
      expect(result.current.body).not.toBeNull();
    });

    expect(result.current.body?.text).toBe('Hello world');
    expect(result.current.body?.html).toBeNull();
    expect(result.current.viewMode).toBe('text');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockBodyOps.fetchDecryptedBody).toHaveBeenCalledWith('email-1');
  });

  it('fetches and parses multipart email, defaults to html view', async () => {
    const mockParse = await getMimeParserMock();
    mockParse.mockResolvedValue(MULTIPART_BODY);

    const mockBodyOps: EmailBodyOperations = {
      fetchDecryptedBody: vi.fn().mockResolvedValue('raw mime data')
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider
        apiBaseUrl="http://test"
        ui={mockUI}
        bodyOperations={mockBodyOps}
      >
        {children}
      </EmailProvider>
    );

    const { result } = renderHook(() => useEmailBody('email-2'), { wrapper });

    await waitFor(() => {
      expect(result.current.body).not.toBeNull();
    });

    expect(result.current.body?.text).toBe('Plain text');
    expect(result.current.body?.html).toContain('HTML content');
    expect(result.current.viewMode).toBe('html');
  });

  it('handles fetch error gracefully', async () => {
    const mockBodyOps: EmailBodyOperations = {
      fetchDecryptedBody: vi.fn().mockRejectedValue(new Error('Decrypt failed'))
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider
        apiBaseUrl="http://test"
        ui={mockUI}
        bodyOperations={mockBodyOps}
      >
        {children}
      </EmailProvider>
    );

    const { result } = renderHook(() => useEmailBody('email-3'), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe('Decrypt failed');
    });

    expect(result.current.body).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('caches parsed results and does not re-fetch', async () => {
    const mockBodyOps: EmailBodyOperations = {
      fetchDecryptedBody: vi.fn().mockResolvedValue('raw mime')
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider
        apiBaseUrl="http://test"
        ui={mockUI}
        bodyOperations={mockBodyOps}
      >
        {children}
      </EmailProvider>
    );

    const { result, rerender } = renderHook(({ id }) => useEmailBody(id), {
      wrapper,
      initialProps: { id: 'email-cache' }
    });

    await waitFor(() => {
      expect(result.current.body).not.toBeNull();
    });

    expect(mockBodyOps.fetchDecryptedBody).toHaveBeenCalledTimes(1);

    rerender({ id: 'email-cache' });

    await waitFor(() => {
      expect(result.current.body).not.toBeNull();
    });

    expect(mockBodyOps.fetchDecryptedBody).toHaveBeenCalledTimes(1);
  });

  it('allows toggling view mode', async () => {
    const mockParse = await getMimeParserMock();
    mockParse.mockResolvedValue(MULTIPART_BODY);

    const mockBodyOps: EmailBodyOperations = {
      fetchDecryptedBody: vi.fn().mockResolvedValue('raw mime')
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider
        apiBaseUrl="http://test"
        ui={mockUI}
        bodyOperations={mockBodyOps}
      >
        {children}
      </EmailProvider>
    );

    const { result } = renderHook(() => useEmailBody('email-toggle'), {
      wrapper
    });

    await waitFor(() => {
      expect(result.current.body).not.toBeNull();
    });

    expect(result.current.viewMode).toBe('html');

    act(() => {
      result.current.setViewMode('text');
    });

    expect(result.current.viewMode).toBe('text');
  });

  it('resets state when emailId changes to null', async () => {
    const mockBodyOps: EmailBodyOperations = {
      fetchDecryptedBody: vi.fn().mockResolvedValue('raw mime')
    };

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmailProvider
        apiBaseUrl="http://test"
        ui={mockUI}
        bodyOperations={mockBodyOps}
      >
        {children}
      </EmailProvider>
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useEmailBody(id),
      { wrapper, initialProps: { id: 'email-reset' as string | null } }
    );

    await waitFor(() => {
      expect(result.current.body).not.toBeNull();
    });

    rerender({ id: null });

    expect(result.current.body).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
