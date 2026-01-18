import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheStorageWindow } from './CacheStorageWindow';

const cacheStorageMount = vi.fn();

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

vi.mock('@/pages/cache-storage', () => ({
  CacheStorage: () => {
    useEffect(() => {
      cacheStorageMount();
    }, []);
    return <div data-testid="cache-storage-content">Cache Storage</div>;
  }
}));

describe('CacheStorageWindow', () => {
  const defaultProps = {
    id: 'cache-storage-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<CacheStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Cache Storage as title', () => {
    render(<CacheStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Cache Storage'
    );
  });

  it('renders the cache storage content', () => {
    render(<CacheStorageWindow {...defaultProps} />);
    expect(
      screen.getByTestId('cache-storage-content')
    ).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CacheStorageWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('refreshes cache storage when Refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<CacheStorageWindow {...defaultProps} />);

    expect(cacheStorageMount).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(cacheStorageMount).toHaveBeenCalledTimes(2);
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 640,
      height: 480,
      x: 120,
      y: 80
    };
    render(
      <CacheStorageWindow
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
});
