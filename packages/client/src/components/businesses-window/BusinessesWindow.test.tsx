import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BusinessesWindow } from './BusinessesWindow';

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

vi.mock('@/components/businesses', () => ({
  BusinessesManager: () => <div data-testid="businesses-manager" />
}));

describe('BusinessesWindow', () => {
  const defaultProps = {
    id: 'businesses-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  it('renders the floating window and businesses manager', () => {
    render(<BusinessesWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title')).toHaveTextContent('Businesses');
    expect(screen.getByTestId('businesses-manager')).toBeInTheDocument();
    expect(screen.getByTestId('floating-window')).not.toHaveAttribute(
      'data-initial-dimensions'
    );
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = {
      width: 900,
      height: 650,
      x: 120,
      y: 80
    };

    render(
      <BusinessesWindow
        {...defaultProps}
        initialDimensions={initialDimensions}
      />
    );

    expect(screen.getByTestId('floating-window')).toHaveAttribute(
      'data-initial-dimensions',
      JSON.stringify(initialDimensions)
    );
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BusinessesWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
