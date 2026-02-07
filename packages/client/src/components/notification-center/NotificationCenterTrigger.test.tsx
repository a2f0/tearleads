import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationCenterTrigger } from './NotificationCenterTrigger';

vi.mock('./NotificationCenter', () => ({
  NotificationCenter: ({
    isOpen,
    onClose
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="notification-center-overlay">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null
}));

describe('NotificationCenterTrigger', () => {
  it('renders trigger button', () => {
    render(<NotificationCenterTrigger />);
    expect(
      screen.getByRole('button', { name: /open notification center/i })
    ).toBeInTheDocument();
  });

  it('opens Notification Center when clicked', async () => {
    const user = userEvent.setup();
    render(<NotificationCenterTrigger />);

    expect(
      screen.queryByTestId('notification-center-overlay')
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /open notification center/i })
    );

    expect(
      screen.getByTestId('notification-center-overlay')
    ).toBeInTheDocument();
  });

  it('closes Notification Center when close is triggered', async () => {
    const user = userEvent.setup();
    render(<NotificationCenterTrigger />);

    await user.click(
      screen.getByRole('button', { name: /open notification center/i })
    );
    expect(
      screen.getByTestId('notification-center-overlay')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(
      screen.queryByTestId('notification-center-overlay')
    ).not.toBeInTheDocument();
  });
});
