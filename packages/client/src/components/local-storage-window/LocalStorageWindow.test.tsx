import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageWindow } from './LocalStorageWindow';

const localStorageMount = vi.fn();

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

vi.mock('@/pages/localStorage', () => {
  const { useEffect } = require('react');
  return {
    LocalStorage: ({ showBackLink }: { showBackLink?: boolean }) => {
      useEffect(() => {
        localStorageMount();
      }, []);
      return (
        <div data-testid="local-storage-content">
          <span data-testid="local-storage-backlink">
            {showBackLink ? 'true' : 'false'}
          </span>
        </div>
      );
    }
  };
});

describe('LocalStorageWindow', () => {
  const defaultProps = {
    id: 'local-storage-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<LocalStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
  });

  it('shows Local Storage as title', () => {
    render(<LocalStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title')).toHaveTextContent(
      'Local Storage'
    );
  });

  it('renders the local storage content', () => {
    render(<LocalStorageWindow {...defaultProps} />);
    expect(screen.getByTestId('local-storage-content')).toBeInTheDocument();
    expect(screen.getByTestId('local-storage-backlink')).toHaveTextContent(
      'false'
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<LocalStorageWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('refreshes local storage when Refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<LocalStorageWindow {...defaultProps} />);

    expect(localStorageMount).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(localStorageMount).toHaveBeenCalledTimes(2);
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 600,
      height: 700,
      x: 100,
      y: 100
    };
    render(
      <LocalStorageWindow
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

  it('renders without error when inside a router context (WindowRenderer is inside BrowserRouter)', () => {
    expect(() =>
      render(
        <MemoryRouter>
          <LocalStorageWindow {...defaultProps} />
        </MemoryRouter>
      )
    ).not.toThrow();
    expect(screen.getByTestId('local-storage-content')).toBeInTheDocument();
  });
});
