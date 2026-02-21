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

describe('EmailFoldersSidebar - Interactions', () => {
  it('calls onFolderSelect when clicking a folder', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    const context = createMockContext();

    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={onFolderSelect}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByText('Inbox')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Inbox'));
    expect(onFolderSelect).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ id: '1', folderType: 'inbox', name: 'Inbox' })
    );
  });

  it('calls onFolderSelect with ALL_MAIL_ID when clicking All Mail', async () => {
    const user = userEvent.setup();
    const onFolderSelect = vi.fn();
    const context = createMockContext();

    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId="1"
        onFolderSelect={onFolderSelect}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByTestId('email-folder-all-mail')).toBeInTheDocument();
    });

    const allMailItem = screen.getByTestId('email-folder-all-mail');
    const button = allMailItem.querySelector('button');
    if (!button) throw new Error('Button not found in All Mail item');
    await user.click(button);
    expect(onFolderSelect).toHaveBeenCalledWith('__all_mail__', null);
  });

  it('opens create folder dialog when clicking new folder button', async () => {
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

    await user.click(screen.getByTestId('email-new-folder-button'));
    expect(screen.getByTestId('create-folder-dialog')).toBeInTheDocument();
  });

  it('can expand and collapse folders with children', async () => {
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

    // Click expand button
    const expandButton = screen.getByLabelText('Expand');
    await user.click(expandButton);

    // Now should show the child folder
    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
  });

  it('calls onFolderChanged when folder is created', async () => {
    const user = userEvent.setup();
    const onFolderChanged = vi.fn();
    const context = createMockContext();

    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={vi.fn()}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
        onFolderChanged={onFolderChanged}
      />,
      context
    );

    await waitFor(() => {
      expect(screen.getByTestId('email-new-folder-button')).toBeInTheDocument();
    });

    // Open create dialog
    await user.click(screen.getByTestId('email-new-folder-button'));

    // Fill in folder name and submit
    await user.type(
      screen.getByTestId('create-folder-input'),
      'New Test Folder'
    );
    await user.click(screen.getByTestId('create-folder-submit'));

    await waitFor(() => {
      expect(onFolderChanged).toHaveBeenCalled();
    });
  });
});
