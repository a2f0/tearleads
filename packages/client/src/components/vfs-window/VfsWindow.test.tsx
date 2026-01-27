import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsWindow } from './VfsWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    initialDimensions
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    initialDimensions?: { width: number; height: number; x: number; y: number };
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
  )
}));

vi.mock('@/components/vfs-explorer', () => ({
  VfsExplorer: ({
    viewMode,
    refreshToken
  }: {
    viewMode?: string;
    refreshToken?: number;
  }) => (
    <div
      data-testid="vfs-explorer"
      data-view-mode={viewMode}
      data-refresh-token={refreshToken}
    />
  )
}));

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

  it('renders menu bar with File and View menus', () => {
    render(<VfsWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('passes list view mode to VfsExplorer by default', () => {
    render(<VfsWindow {...defaultProps} />);
    const explorer = screen.getByTestId('vfs-explorer');
    expect(explorer).toHaveAttribute('data-view-mode', 'list');
  });

  it('changes view mode when Table menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    const explorer = screen.getByTestId('vfs-explorer');
    expect(explorer).toHaveAttribute('data-view-mode', 'table');
  });

  it('increments refresh token when Refresh menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    const explorerBefore = screen.getByTestId('vfs-explorer');
    const initialToken = explorerBefore.getAttribute('data-refresh-token');

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    const explorerAfter = screen.getByTestId('vfs-explorer');
    const newToken = explorerAfter.getAttribute('data-refresh-token');

    expect(Number(newToken)).toBe(Number(initialToken) + 1);
  });

  it('calls onClose from File menu Close item', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VfsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('provides New Folder menu item', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'New Folder' })
    ).toBeInTheDocument();
  });

  it('provides Link Item menu item', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Link Item...' })
    ).toBeInTheDocument();
  });

  it('changes view mode back to list when List menu item is clicked', async () => {
    const user = userEvent.setup();
    render(<VfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    const explorer = screen.getByTestId('vfs-explorer');
    expect(explorer).toHaveAttribute('data-view-mode', 'table');

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'List' }));

    expect(explorer).toHaveAttribute('data-view-mode', 'list');
  });
});
