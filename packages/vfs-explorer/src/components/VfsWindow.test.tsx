import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSyncRemoteState = vi.fn();

// Mock the context
vi.mock('../context', () => ({
  useVfsExplorerContext: vi.fn(() => ({
    ui: {
      FloatingWindow: ({
        children,
        title,
        onClose,
        initialDimensions
      }: {
        children: ReactNode;
        title: string;
        onClose: () => void;
        initialDimensions?: {
          width: number;
          height: number;
          x: number;
          y: number;
        };
      }) => (
        <div
          data-testid="floating-window"
          data-initial-dimensions={
            initialDimensions ? JSON.stringify(initialDimensions) : undefined
          }
        >
          <div data-testid="window-title">{title}</div>
          <button type="button" onClick={onClose} data-testid="close-window">
            Close
          </button>
          {children}
        </div>
      ),
      DropdownMenu: ({
        trigger,
        children
      }: {
        trigger: string;
        children: ReactNode;
      }) => (
        <div>
          <button type="button" aria-haspopup="menu">
            {trigger}
          </button>
          <div role="menu">{children}</div>
        </div>
      ),
      DropdownMenuItem: ({
        children,
        onClick
      }: {
        children: ReactNode;
        onClick?: () => void;
      }) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Test mock
        <div role="menuitem" tabIndex={0} onClick={onClick}>
          {children}
        </div>
      ),
      DropdownMenuSeparator: () => <hr />,
      WindowOptionsMenuItem: () => <div>Options</div>,
      AboutMenuItem: () => <div>About</div>,
      Button: ({ children, ...props }: { children: ReactNode }) => (
        <button {...props}>{children}</button>
      ),
      Input: (props: Record<string, unknown>) => <input {...props} />
    },
    databaseState: {
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test'
    },
    getDatabase: vi.fn(),
    vfsKeys: {
      generateSessionKey: vi.fn(),
      wrapSessionKey: vi.fn()
    },
    auth: {
      isLoggedIn: vi.fn(() => false),
      readStoredAuth: vi.fn(() => ({ user: { id: 'test' } }))
    },
    featureFlags: {
      getFeatureFlagValue: vi.fn(() => false)
    },
    vfsApi: {
      register: vi.fn()
    },
    syncRemoteState: () => mockSyncRemoteState()
  }))
}));

// Mock the VfsExplorer component
vi.mock('./VfsExplorer', () => ({
  VfsExplorer: ({
    viewMode,
    refreshToken,
    onFolderSelect
  }: {
    viewMode?: string;
    refreshToken?: number;
    onFolderSelect?: ((folderId: string | null) => void) | undefined;
  }) => (
    <div>
      <button
        type="button"
        data-testid="select-shared-by-me"
        onClick={() => onFolderSelect?.('__shared_by_me__')}
      >
        Shared By Me
      </button>
      <button
        type="button"
        data-testid="select-unfiled"
        onClick={() => onFolderSelect?.('__unfiled__')}
      >
        Unfiled
      </button>
      <div
        data-testid="vfs-explorer"
        data-view-mode={viewMode}
        data-refresh-token={refreshToken}
      />
    </div>
  )
}));

// Mock the hooks
vi.mock('../hooks', () => ({
  useCreateVfsFolder: () => ({
    createFolder: vi
      .fn()
      .mockResolvedValue({ id: 'new-folder', name: 'New Folder' }),
    isCreating: false,
    error: null
  })
}));

import { VfsWindow } from './VfsWindow';

describe('VfsWindow', () => {
  const defaultProps = {
    id: 'vfs-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncRemoteState.mockResolvedValue(undefined);
  });

  it('renders in FloatingWindow', () => {
    render(<VfsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows VFS Explorer as title', () => {
    render(<VfsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'VFS Explorer'
    );
  });

  it('renders the VFS explorer content', () => {
    render(<VfsWindow {...defaultProps} />);
    expect(screen.getByTestId('vfs-explorer')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VfsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 900,
      height: 600,
      x: 100,
      y: 120
    };
    render(
      <VfsWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File, View, and Help menus', () => {
    render(<VfsWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('passes table view mode to VfsExplorer by default', () => {
    render(<VfsWindow {...defaultProps} />);
    const explorer = screen.getByTestId('vfs-explorer');
    expect(explorer).toHaveAttribute('data-view-mode', 'table');
  });

  it('changes view mode when List menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('menuitem', { name: 'List' }));

    const explorer = screen.getByTestId('vfs-explorer');
    expect(explorer).toHaveAttribute('data-view-mode', 'list');
  });

  it('increments refresh token when Refresh menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    const explorerBefore = screen.getByTestId('vfs-explorer');
    const initialToken = explorerBefore.getAttribute('data-refresh-token');

    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    const explorerAfter = screen.getByTestId('vfs-explorer');
    const newToken = explorerAfter.getAttribute('data-refresh-token');

    expect(Number(newToken)).toBe(Number(initialToken) + 1);
  });

  it('calls onClose from File menu Close item', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VfsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('provides New Folder menu item', () => {
    render(<VfsWindow {...defaultProps} />);

    expect(
      screen.getByRole('menuitem', { name: 'New Folder' })
    ).toBeInTheDocument();
  });

  it('provides Link Item menu item', () => {
    render(<VfsWindow {...defaultProps} />);

    expect(
      screen.getByRole('menuitem', { name: 'Link Item...' })
    ).toBeInTheDocument();
  });

  it('opens New Folder dialog when New Folder menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('menuitem', { name: 'New Folder' }));

    expect(screen.getByTestId('new-folder-dialog')).toBeInTheDocument();
  });

  it('refreshes explorer when folder is created', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    // Initial refresh token is 0
    expect(screen.getByTestId('vfs-explorer')).toHaveAttribute(
      'data-refresh-token',
      '0'
    );

    // Open new folder dialog
    await user.click(screen.getByRole('menuitem', { name: 'New Folder' }));

    // Fill in folder name and submit
    const input = screen.getByRole('textbox');
    await user.type(input, 'Test Folder');
    await user.click(screen.getByRole('button', { name: /create/i }));

    // Refresh token should have incremented
    expect(screen.getByTestId('vfs-explorer')).toHaveAttribute(
      'data-refresh-token',
      '1'
    );
  });

  it('syncs remote state before refreshing shared listings', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-shared-by-me'));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockSyncRemoteState).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('vfs-explorer')).toHaveAttribute(
        'data-refresh-token',
        '1'
      );
    });
  });

  it('syncs remote state for non-shared folders', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByTestId('select-unfiled'));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockSyncRemoteState).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('vfs-explorer')).toHaveAttribute(
        'data-refresh-token',
        '1'
      );
    });
  });
});
