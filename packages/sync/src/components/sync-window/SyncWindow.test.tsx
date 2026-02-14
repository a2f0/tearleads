import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SyncWindow } from './SyncWindow';

// Mock FloatingWindow
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
      children: React.ReactNode;
      title: string;
      onClose: () => void;
      initialDimensions?: {
        width: number;
        height: number;
        x: number;
        y: number;
      };
      fitContent?: boolean;
      maxWidthPercent?: number;
      maxHeightPercent?: number;
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
  };
});

// Mock Sync component
vi.mock('../../pages/sync', () => ({
  Sync: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="sync-content">
      <span data-testid="sync-backlink">{showBackLink ? 'true' : 'false'}</span>
    </div>
  )
}));

describe('SyncWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<SyncWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Sync as title', () => {
    render(<SyncWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Sync');
  });

  it('renders the sync content with showBackLink=false', () => {
    render(<SyncWindow {...defaultProps} />);
    expect(screen.getByTestId('sync-content')).toBeInTheDocument();
    expect(screen.getByTestId('sync-backlink')).toHaveTextContent('false');
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SyncWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 600,
      height: 700,
      x: 100,
      y: 100
    };
    render(
      <SyncWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(<SyncWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SyncWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('renders without error when inside a router context (WindowRenderer is inside BrowserRouter)', () => {
    // This test simulates the real runtime environment where WindowRenderer
    // is rendered inside BrowserRouter. SyncWindow should not create a nested
    // Router, which would cause: "You cannot render a <Router> inside another <Router>"
    expect(() =>
      render(
        <MemoryRouter>
          <SyncWindow {...defaultProps} />
        </MemoryRouter>
      )
    ).not.toThrow();
    expect(screen.getByTestId('sync-content')).toBeInTheDocument();
  });
});
