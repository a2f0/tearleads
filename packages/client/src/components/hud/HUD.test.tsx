import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HUD } from './HUD';

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: false
  })
}));

vi.mock('./AnalyticsTab', () => ({
  AnalyticsTab: () => <div data-testid="analytics-tab">Analytics Tab</div>
}));

vi.mock('./LogsTab', () => ({
  LogsTab: () => <div data-testid="logs-tab">Logs Tab</div>
}));

describe('HUD', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<HUD isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders when open', () => {
    render(<HUD isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows analytics tab by default', () => {
    render(<HUD isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('analytics-tab')).toBeInTheDocument();
  });

  it('switches to logs tab when clicked', async () => {
    const user = userEvent.setup();
    render(<HUD isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /logs/i }));
    expect(screen.getByTestId('logs-tab')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HUD isOpen={true} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders backdrop when open', () => {
    render(<HUD isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('hud-backdrop')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HUD isOpen={true} onClose={onClose} />);

    await user.click(screen.getByTestId('hud-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render backdrop when closed', () => {
    render(<HUD isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('hud-backdrop')).not.toBeInTheDocument();
  });
});
