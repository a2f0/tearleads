import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthWindow } from './HealthWindow';

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

vi.mock('@/pages/Health', () => ({
  Health: ({
    showBackLink,
    refreshToken
  }: {
    showBackLink?: boolean;
    refreshToken?: number;
  }) => (
    <div
      data-testid="health-page"
      data-show-back-link={showBackLink}
      data-refresh-token={refreshToken}
    >
      Health Page
    </div>
  ),
  HEALTH_DRILLDOWN_CARDS: [
    { title: 'Height Tracking', route: 'height', icon: () => null },
    { title: 'Weight Tracking', route: 'weight', icon: () => null },
    { title: 'Blood Pressure', route: 'blood-pressure', icon: () => null },
    { title: 'Exercises', route: 'exercises', icon: () => null },
    { title: 'Workouts', route: 'workouts', icon: () => null }
  ]
}));

describe('HealthWindow', () => {
  const defaultProps = {
    id: 'test-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders in FloatingWindow', () => {
    render(<HealthWindow {...defaultProps} />);
    expect(screen.getByTestId('floating-window')).toBeTruthy();
  });

  it('displays the correct title', () => {
    render(<HealthWindow {...defaultProps} />);
    expect(screen.getByTestId('window-title').textContent).toBe('Health');
  });

  it('renders health page with back link disabled', () => {
    render(<HealthWindow {...defaultProps} />);
    expect(screen.getByTestId('health-page')).toBeTruthy();
    expect(
      screen.getByTestId('health-page').getAttribute('data-show-back-link')
    ).toBe('false');
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HealthWindow {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByTestId('close-window'));
    expect(onClose).toHaveBeenCalled();
  });

  it('passes initialDimensions to FloatingWindow when provided', () => {
    const initialDimensions = { x: 100, y: 100, width: 760, height: 560 };
    render(
      <HealthWindow {...defaultProps} initialDimensions={initialDimensions} />
    );
    const window = screen.getByTestId('floating-window');
    const props = JSON.parse(window.dataset['props'] || '{}');
    expect(props.initialDimensions).toEqual(initialDimensions);
  });

  it('increments refreshToken when refresh is clicked', async () => {
    const user = userEvent.setup();
    render(<HealthWindow {...defaultProps} />);

    const healthPage = screen.getByTestId('health-page');
    expect(healthPage.dataset['refreshToken']).toBe('0');

    await user.click(screen.getByText('File'));
    await user.click(screen.getByText('Refresh'));

    expect(healthPage.dataset['refreshToken']).toBe('1');
  });
});
