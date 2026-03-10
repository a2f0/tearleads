import { windowManagerTestMock } from '@admin/test/windowManagerTestMock';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminRedisWindow } from './AdminRedisWindow';

vi.mock('@tearleads/window-manager', () => windowManagerTestMock);

vi.mock('@admin/pages/admin/Admin', () => ({
  Admin: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="admin-redis-content">
      <span data-testid="admin-redis-backlink">
        {showBackLink ? 'true' : 'false'}
      </span>
    </div>
  )
}));

describe('AdminRedisWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders in FloatingWindow', () => {
    render(<AdminRedisWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Redis Admin as title', () => {
    render(<AdminRedisWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent('Redis Admin');
  });

  it('renders the admin redis content', () => {
    render(<AdminRedisWindow {...defaultProps} />);
    expect(screen.getByTestId('admin-redis-content')).toBeInTheDocument();
    expect(screen.getByTestId('admin-redis-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminRedisWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 760,
      height: 640,
      x: 100,
      y: 100
    };
    render(
      <AdminRedisWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
      />
    );
    const floatingWindow = screen.getByTestId('floating-window');
    expect(floatingWindow).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('renders menu bar with File and View menus', () => {
    render(<AdminRedisWindow {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-window-controls')).toBeInTheDocument();
  });

  it('calls onClose from File menu Close option', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AdminRedisWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });

  describe('auth gating', () => {
    it('shows loading state when isAuthLoading is true', () => {
      render(<AdminRedisWindow {...defaultProps} isAuthLoading={true} />);
      expect(
        screen.getByTestId('admin-redis-window-loading')
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-redis-content')
      ).not.toBeInTheDocument();
    });

    it('shows locked fallback when isUnlocked is false', () => {
      render(
        <AdminRedisWindow
          {...defaultProps}
          isUnlocked={false}
          lockedFallback={<div data-testid="locked-fallback">Unlock</div>}
        />
      );
      expect(
        screen.getByTestId('admin-redis-window-locked')
      ).toBeInTheDocument();
      expect(screen.getByTestId('locked-fallback')).toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-redis-content')
      ).not.toBeInTheDocument();
    });

    it('shows content when isUnlocked is true (default)', () => {
      render(<AdminRedisWindow {...defaultProps} />);
      expect(screen.getByTestId('admin-redis-content')).toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-redis-window-loading')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-redis-window-locked')
      ).not.toBeInTheDocument();
    });

    it('prioritizes loading state over locked state', () => {
      render(
        <AdminRedisWindow
          {...defaultProps}
          isAuthLoading={true}
          isUnlocked={false}
          lockedFallback={<div data-testid="locked-fallback">Unlock</div>}
        />
      );
      expect(
        screen.getByTestId('admin-redis-window-loading')
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId('admin-redis-window-locked')
      ).not.toBeInTheDocument();
    });
  });
});
