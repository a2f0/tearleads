import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassicWindow } from './index';

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    DesktopFloatingWindow: ({
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
        <button type="button" data-testid="close-window" onClick={onClose}>
          Close
        </button>
        {children}
      </div>
    )
  };
});

vi.mock('@/components/classic-workspace/ClassicWorkspace', () => ({
  ClassicWorkspace: ({
    tagSortOrder,
    entrySortOrder
  }: {
    tagSortOrder?: string;
    entrySortOrder?: string;
  }) => (
    <div data-testid="classic-workspace">
      <span data-testid="workspace-tag-sort">{tagSortOrder}</span>
      <span data-testid="workspace-entry-sort">{entrySortOrder}</span>
      Classic Workspace
    </div>
  )
}));

describe('ClassicWindow', () => {
  const defaultProps = {
    id: 'classic-window-1',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow with title', () => {
    render(<ClassicWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Classic');
  });

  it('renders Classic workspace content', () => {
    render(<ClassicWindow {...defaultProps} />);

    expect(screen.getByTestId('classic-workspace')).toBeInTheDocument();
  });

  it('renders File, Edit, Tags, Entries, View, and Help menus', () => {
    render(<ClassicWindow {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entries' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close item', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ClassicWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows About option in Help menu', async () => {
    const user = userEvent.setup();

    render(<ClassicWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Help' }));

    expect(screen.getByRole('menuitem', { name: 'About' })).toBeInTheDocument();
  });

  it('handles no-op menu actions without closing', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ClassicWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'New Entry' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when window close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<ClassicWindow {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByTestId('close-window'));

    expect(onClose).toHaveBeenCalled();
  });

  it('updates workspace entry sort from Entries menu selection', async () => {
    const user = userEvent.setup();
    render(<ClassicWindow {...defaultProps} />);

    expect(screen.getByTestId('workspace-entry-sort')).toHaveTextContent(
      'user-defined'
    );

    await user.click(screen.getByRole('button', { name: 'Entries' }));
    await user.click(
      screen.getByRole('menuitem', {
        name: 'Sort by Date Tagged (Newest First)'
      })
    );

    expect(screen.getByTestId('workspace-entry-sort')).toHaveTextContent(
      'date-tagged-desc'
    );
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 980,
      height: 700,
      x: 10,
      y: 20
    };

    render(
      <ClassicWindow {...defaultProps} initialDimensions={initialDimensions} />
    );

    expect(screen.getByTestId('floating-window')).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });
});
