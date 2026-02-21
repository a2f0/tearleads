import { render, screen } from '@testing-library/react';
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

describe('EmailFoldersSidebar - Resize', () => {
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
});
