import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpfsWindow } from './OpfsWindow';

const mockRefresh = vi.fn();
const mockExpandAll = vi.fn();
const mockCollapseAll = vi.fn();

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

vi.mock('@/pages/opfs/OpfsBrowser', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');
  return {
    OpfsBrowser: ReactModule.forwardRef((_props, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        refresh: mockRefresh,
        expandAll: mockExpandAll,
        collapseAll: mockCollapseAll
      }));
      return <div data-testid="opfs-browser" />;
    })
  };
});

describe('OpfsWindow', () => {
  const defaultProps = {
    id: 'opfs-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<OpfsWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows OPFS Browser as title', () => {
    render(<OpfsWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'OPFS Browser'
    );
  });

  it('renders the OPFS browser content', () => {
    render(<OpfsWindow {...defaultProps} />);
    expect(screen.getByTestId('opfs-browser')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OpfsWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 700,
      height: 600,
      x: 100,
      y: 120
    };
    render(
      <OpfsWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(<OpfsWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('calls refresh action from File menu', async () => {
    const user = userEvent.setup();
    render(<OpfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls expand all action from View menu', async () => {
    const user = userEvent.setup();
    render(<OpfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Expand All' }));

    expect(mockExpandAll).toHaveBeenCalledTimes(1);
  });

  it('calls collapse all action from View menu', async () => {
    const user = userEvent.setup();
    render(<OpfsWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Collapse All' }));

    expect(mockCollapseAll).toHaveBeenCalledTimes(1);
  });
});
