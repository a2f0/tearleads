import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminWindow } from './AdminWindow';

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

vi.mock('@/pages/admin/Admin', () => ({
  Admin: () => <div data-testid="admin-content">Admin Content</div>
}));

describe('AdminWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Admin as title', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Admin');
  });

  it('renders the admin content', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 800,
      height: 700,
      x: 100,
      y: 100
    };
    render(
      <AdminWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(<AdminWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('toggles compact mode from View menu', async () => {
    const user = userEvent.setup();
    render(<AdminWindow {...defaultProps} />);

    const contentContainer = screen.getByTestId('admin-content').parentElement;
    expect(contentContainer).toHaveClass('p-6');

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Compact' }));

    expect(contentContainer).toHaveClass('p-3');
  });
});
