import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailFolderOperations } from '../context';
import { mockConsoleError } from '../test/consoleMocks';
import { TestEmailProvider } from '../test/testUtils';
import { Email } from './Email';

const mockEmails = [
  {
    id: 'email-1',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'Test Email Subject',
    receivedAt: '2024-01-15T10:00:00Z',
    size: 2048
  }
];

const mockFolderOperations: EmailFolderOperations = {
  fetchFolders: vi.fn().mockResolvedValue([
    {
      id: 'folder-inbox',
      name: 'Inbox',
      folderType: 'inbox',
      parentId: null,
      unreadCount: 0
    },
    {
      id: 'folder-sent',
      name: 'Sent',
      folderType: 'sent',
      parentId: null,
      unreadCount: 0
    },
    {
      id: 'folder-trash',
      name: 'Trash',
      folderType: 'trash',
      parentId: null,
      unreadCount: 0
    }
  ]),
  createFolder: vi.fn().mockResolvedValue({
    id: 'new-folder',
    name: 'New Folder',
    folderType: 'custom',
    parentId: null,
    unreadCount: 0
  }),
  renameFolder: vi.fn().mockResolvedValue(undefined),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  moveFolder: vi.fn().mockResolvedValue(undefined),
  initializeSystemFolders: vi.fn().mockResolvedValue(undefined),
  getFolderByType: vi.fn().mockResolvedValue(null)
};

describe('Email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  const renderWithProvider = (folderOperations?: EmailFolderOperations) => {
    return render(
      <TestEmailProvider {...(folderOperations && { folderOperations })}>
        <Email />
      </TestEmailProvider>
    );
  };

  it('renders email list after loading', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Test Email Subject')).toBeInTheDocument();
    });

    expect(screen.getByText(/From: sender@example.com/)).toBeInTheDocument();
  });

  it('renders empty state when no emails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('No emails yet')).toBeInTheDocument();
    });
  });

  it('renders error state on fetch failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error'
    });
    const consoleSpy = mockConsoleError();

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText(/Failed to fetch emails/)).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch emails:',
      expect.any(Error)
    );
  });

  it('renders page title and refresh button', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: [] })
    });

    renderWithProvider();

    expect(screen.getByRole('heading', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByTestId('back-link')).toBeInTheDocument();
    expect(screen.getByTestId('refresh-button')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('No emails yet')).toBeInTheDocument();
    });
  });

  it('shows email details when an item is selected', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider();

    await waitFor(() => {
      expect(screen.getByText('Test Email Subject')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Email Subject'));

    expect(
      screen.getByRole('button', { name: /Back to Email/ })
    ).toBeInTheDocument();
    expect(screen.getByText('To: recipient@example.com')).toBeInTheDocument();
  });

  it('switches right panel when selecting Sent folder', async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emails: mockEmails })
    });

    renderWithProvider(mockFolderOperations);

    await waitFor(() => {
      expect(screen.getByText('Sent')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Sent'));

    await waitFor(() => {
      expect(screen.getByText('No emails in Sent')).toBeInTheDocument();
    });
  });
});
