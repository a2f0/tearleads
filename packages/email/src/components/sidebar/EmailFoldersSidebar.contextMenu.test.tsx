import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function renderWithContext(ui: React.ReactElement, context: EmailContextValue) {
  return render(
    <EmailContext.Provider value={context}>{ui}</EmailContext.Provider>
  );
}

describe('EmailFoldersSidebar - Context Menu', () => {
  it('shows context menu on right-click for custom folder', async () => {
    const user = userEvent.setup();
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

    // Right-click on custom folder to open context menu
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('email-folder-context-menu')
      ).toBeInTheDocument();
    });
  });

  it('opens rename dialog from context menu', async () => {
    const user = userEvent.setup();
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

    // Right-click to open context menu
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument();
    });

    // Click rename
    await user.click(screen.getByText('Rename'));

    // Rename dialog should open
    await waitFor(() => {
      expect(screen.getByTestId('rename-folder-dialog')).toBeInTheDocument();
    });
  });

  it('opens delete dialog from context menu', async () => {
    const user = userEvent.setup();
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

    // Right-click to open context menu
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });

    await waitFor(() => {
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    // Click delete
    await user.click(screen.getByText('Delete'));

    // Delete dialog should open
    await waitFor(() => {
      expect(screen.getByTestId('delete-folder-dialog')).toBeInTheDocument();
    });
  });

  it('opens create subfolder dialog from context menu', async () => {
    const user = userEvent.setup();
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

    // Right-click to open context menu
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });

    await waitFor(() => {
      expect(screen.getByText('New Subfolder')).toBeInTheDocument();
    });

    // Click new subfolder
    await user.click(screen.getByText('New Subfolder'));

    // Create dialog should open with "Create Subfolder" title
    await waitFor(() => {
      expect(screen.getByText('Create Subfolder')).toBeInTheDocument();
    });
  });

  it('closes context menu when clicking backdrop', async () => {
    const user = userEvent.setup();
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

    // Open context menu
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('email-folder-context-menu')
      ).toBeInTheDocument();
    });

    // Click on backdrop to close
    await user.click(screen.getByTestId('email-folder-context-menu-backdrop'));

    // Context menu should close
    await waitFor(() => {
      expect(
        screen.queryByTestId('email-folder-context-menu')
      ).not.toBeInTheDocument();
    });
  });
});
