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

describe('EmailFoldersSidebar', () => {
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
    expect(onFolderSelect).toHaveBeenCalledWith('1');
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

    await user.click(screen.getByTestId('email-folder-all-mail'));
    expect(onFolderSelect).toHaveBeenCalledWith('__all_mail__');
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

  it('handles resize via mouse drag', async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    const context = createMockContext();

    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={onWidthChange}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    const resizeHandle = screen.getByRole('separator');

    // Start drag
    await user.pointer({ keys: '[MouseLeft>]', target: resizeHandle });

    // Move mouse
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250 }));

    // End drag
    document.dispatchEvent(new MouseEvent('mouseup'));

    // Width change should have been called
    expect(onWidthChange).toHaveBeenCalled();
  });

  it('handles keyboard resize via arrow keys', async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    const context = createMockContext();

    renderWithContext(
      <EmailFoldersSidebar
        width={200}
        onWidthChange={onWidthChange}
        selectedFolderId={null}
        onFolderSelect={vi.fn()}
      />,
      context
    );

    const resizeHandle = screen.getByRole('separator');
    resizeHandle.focus();

    await user.keyboard('{ArrowRight}');
    expect(onWidthChange).toHaveBeenCalledWith(210);

    await user.keyboard('{ArrowLeft}');
    expect(onWidthChange).toHaveBeenCalledWith(190);
  });

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
      expect(onFolderSelect).toHaveBeenCalledWith('__all_mail__');
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
