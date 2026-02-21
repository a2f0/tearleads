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

describe('EmailFoldersSidebar - Dialogs', () => {
  it('closes create dialog when cancelled', async () => {
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
      expect(screen.getByTestId('email-new-folder-button')).toBeInTheDocument();
    });

    // Open create dialog
    await user.click(screen.getByTestId('email-new-folder-button'));
    expect(screen.getByTestId('create-folder-dialog')).toBeInTheDocument();

    // Click cancel
    await user.click(screen.getByText('Cancel'));

    // Dialog should close
    await waitFor(() => {
      expect(
        screen.queryByTestId('create-folder-dialog')
      ).not.toBeInTheDocument();
    });
  });

  it('closes rename dialog when cancelled', async () => {
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

    // Open context menu and click rename
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });
    await waitFor(() => expect(screen.getByText('Rename')).toBeInTheDocument());
    await user.click(screen.getByText('Rename'));

    // Verify dialog is open
    await waitFor(() => {
      expect(screen.getByTestId('rename-folder-dialog')).toBeInTheDocument();
    });

    // Click cancel
    await user.click(screen.getByText('Cancel'));

    // Dialog should close
    await waitFor(() => {
      expect(
        screen.queryByTestId('rename-folder-dialog')
      ).not.toBeInTheDocument();
    });
  });

  it('closes delete dialog when cancelled', async () => {
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

    // Open context menu and click delete
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });
    await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument());
    await user.click(screen.getByText('Delete'));

    // Verify dialog is open
    await waitFor(() => {
      expect(screen.getByTestId('delete-folder-dialog')).toBeInTheDocument();
    });

    // Click cancel
    await user.click(screen.getByText('Cancel'));

    // Dialog should close
    await waitFor(() => {
      expect(
        screen.queryByTestId('delete-folder-dialog')
      ).not.toBeInTheDocument();
    });
  });

  it('resets selected folder to All Mail when deleted folder is selected', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    const context = createMockContext();

    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId="3"
        onFolderSelect={onFolderSelect}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument();
    });

    // Open context menu and click delete
    await user.pointer({
      keys: '[MouseRight>]',
      target: screen.getByText('Work')
    });
    await waitFor(() => expect(screen.getByText('Delete')).toBeInTheDocument());
    await user.click(screen.getByText('Delete'));

    // Confirm delete
    await waitFor(() => {
      expect(screen.getByTestId('delete-folder-dialog')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('delete-folder-confirm'));

    // Should reset to All Mail since the selected folder was deleted
    await waitFor(() => {
      expect(onFolderSelect).toHaveBeenCalledWith('__all_mail__', null);
    });
  });
});
