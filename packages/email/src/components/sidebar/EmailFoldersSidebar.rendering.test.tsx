import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EmailContext,
  type EmailContextValue
} from '../../context/EmailContext.js';
import type { EmailFolder } from '../../types/folder.js';
import { EmailFoldersSidebar } from './EmailFoldersSidebar.js';

// Suppress React act() warnings from async state updates in useEmailFolders hook
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const mockFolders: EmailFolder[] = [
  {
    id: '1',
    name: 'Inbox',
    folderType: 'inbox',
    parentId: null,
    unreadCount: 5
  },
  {
    id: '2',
    name: 'Sent',
    folderType: 'sent',
    parentId: null,
    unreadCount: 0
  },
  {
    id: '3',
    name: 'Work',
    folderType: 'custom',
    parentId: null,
    unreadCount: 2
  },
  {
    id: '4',
    name: 'Projects',
    folderType: 'custom',
    parentId: '3',
    unreadCount: 1
  }
];

function createMockContext(
  overrides: Partial<EmailContextValue> = {}
): EmailContextValue {
  const fetchFolders = vi.fn().mockResolvedValue(mockFolders);
  const createFolder = vi
    .fn()
    .mockImplementation(async (name: string, parentId?: string | null) => ({
      id: 'new-id',
      name,
      folderType: 'custom',
      parentId: parentId ?? null,
      unreadCount: 0
    }));
  const renameFolder = vi.fn().mockResolvedValue(undefined);
  const deleteFolder = vi.fn().mockResolvedValue(undefined);
  const moveFolder = vi.fn().mockResolvedValue(undefined);
  const initializeSystemFolders = vi.fn().mockResolvedValue(undefined);
  const getFolderByType = vi.fn().mockReturnValue(null);

  return {
    apiBaseUrl: 'http://test',
    ui: {
      BackLink: () => null,
      RefreshButton: () => null,
      DropdownMenu: () => null,
      DropdownMenuItem: () => null,
      DropdownMenuSeparator: () => null,
      AboutMenuItem: () => null,
      WindowOptionsMenuItem: () => null
    },
    folderOperations: {
      fetchFolders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveFolder,
      initializeSystemFolders,
      getFolderByType
    },
    ...overrides
  };
}

function createMockContextWithoutFolderOps(): EmailContextValue {
  return {
    apiBaseUrl: 'http://test',
    ui: {
      BackLink: () => null,
      RefreshButton: () => null,
      DropdownMenu: () => null,
      DropdownMenuItem: () => null,
      DropdownMenuSeparator: () => null,
      AboutMenuItem: () => null,
      WindowOptionsMenuItem: () => null
    }
  };
}

function renderWithContext(ui: React.ReactElement, context: EmailContextValue) {
  return render(
    <EmailContext.Provider value={context}>{ui}</EmailContext.Provider>
  );
}

describe('EmailFoldersSidebar - Rendering', () => {
  it('renders loading state initially', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    expect(screen.getByTestId('email-folders-sidebar')).toBeInTheDocument();
  });

  it('renders All Mail option', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByTestId('email-folder-all-mail')).toBeInTheDocument();
    });
    expect(screen.getByText('All Mail')).toBeInTheDocument();
  });

  it('renders system folders after loading', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('Inbox')).toBeInTheDocument();
    });
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('renders custom folders after loading', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument();
    });
  });

  it('highlights selected folder', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId="1"
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      const inboxItem = screen.getByTestId('email-folder-1');
      const button = inboxItem.querySelector('button');
      expect(button).toHaveClass('bg-accent');
    });
  });

  it('displays unread count badge', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('renders without folder operations when not available', () => {
    const context = createMockContextWithoutFolderOps();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    expect(screen.getByTestId('email-folders-sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('email-folder-all-mail')).toBeInTheDocument();
  });

  it('shows Folders section label for custom folders', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument();
    });

    // The Folders section heading should appear
    const foldersHeadings = screen.getAllByText('Folders');
    expect(foldersHeadings.length).toBeGreaterThanOrEqual(1);
  });

  it('shows System section label for system folders', async () => {
    const context = createMockContext();
    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('System')).toBeInTheDocument();
    });
  });

  it('handles error state', async () => {
    const context = createMockContext();
    if (context.folderOperations) {
      context.folderOperations.fetchFolders = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));
    }

    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('sets correct sidebar width style', () => {
    const context = createMockContext();

    renderWithContext(
      <EmailFoldersSidebar
        width={250}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    const sidebar = screen.getByTestId('email-folders-sidebar');
    expect(sidebar).toHaveStyle({ width: '250px' });
  });
});
