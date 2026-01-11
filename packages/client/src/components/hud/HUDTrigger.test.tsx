import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HUDTrigger } from './HUDTrigger';

vi.mock('./HUD', () => ({
  HUD: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="hud-overlay">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null
}));

describe('HUDTrigger', () => {
  it('renders trigger button', () => {
    render(<HUDTrigger />);
    expect(
      screen.getByRole('button', { name: /open hud/i })
    ).toBeInTheDocument();
  });

  it('opens HUD when clicked', async () => {
    const user = userEvent.setup();
    render(<HUDTrigger />);

    expect(screen.queryByTestId('hud-overlay')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open hud/i }));

    expect(screen.getByTestId('hud-overlay')).toBeInTheDocument();
  });

  it('closes HUD when close is triggered', async () => {
    const user = userEvent.setup();
    render(<HUDTrigger />);

    await user.click(screen.getByRole('button', { name: /open hud/i }));
    expect(screen.getByTestId('hud-overlay')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId('hud-overlay')).not.toBeInTheDocument();
  });
});
