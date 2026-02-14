import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VehiclesWindow } from './VehiclesWindow';

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({
    children,
    title,
    onClose,
    ...rest
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="floating-window"
      data-props={JSON.stringify(rest)}
      data-props-keys={JSON.stringify(Object.keys(rest))}
    >
      <div data-testid="window-title">{title}</div>
      <button type="button" onClick={onClose} data-testid="close-window">
        Close
      </button>
      {children}
    </div>
  )
}));

vi.mock('@/pages/Vehicles', () => ({
  Vehicles: ({ showBackLink }: { showBackLink?: boolean }) => (
    <div data-testid="vehicles-page" data-show-back-link={showBackLink}>
      Vehicles Page
    </div>
  )
}));

describe('VehiclesWindow', () => {
  const defaultProps = {
    id: 'vehicles-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the floating window and title', () => {
    render(<VehiclesWindow {...defaultProps} />);

    expect(screen.getByTestId('floating-window')).toBeInTheDocument();
    expect(screen.getByTestId('window-title').textContent).toBe('Vehicles');
  });

  it('renders vehicles page with back link disabled', () => {
    render(<VehiclesWindow {...defaultProps} />);

    expect(screen.getByTestId('vehicles-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('vehicles-page').getAttribute('data-show-back-link')
    ).toBe('false');
  });

  it('passes initialDimensions when provided', () => {
    const initialDimensions = { x: 90, y: 60, width: 900, height: 620 };
    render(
      <VehiclesWindow {...defaultProps} initialDimensions={initialDimensions} />
    );

    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] ?? '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<VehiclesWindow {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByTestId('close-window'));

    expect(onClose).toHaveBeenCalled();
  });
});
