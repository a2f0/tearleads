import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { V86WindowMenuBar } from './V86WindowMenuBar';

vi.mock('@/components/window-menu/PreserveWindowStateMenuItem', () => ({
  PreserveWindowStateMenuItem: () => (
    <div data-testid="preserve-state-item">Preserve State</div>
  )
}));

describe('V86WindowMenuBar', () => {
  it('renders File, View, and Help menus', () => {
    render(<V86WindowMenuBar onClose={vi.fn()} />);
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Help')).toBeInTheDocument();
  });

  it('calls onClose when Close menu item is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<V86WindowMenuBar onClose={onClose} />);

    await user.click(screen.getByText('File'));
    await user.click(screen.getByText('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders PreserveWindowStateMenuItem in View menu', async () => {
    const user = userEvent.setup();
    render(<V86WindowMenuBar onClose={vi.fn()} />);

    await user.click(screen.getByText('View'));
    expect(screen.getByTestId('preserve-state-item')).toBeInTheDocument();
  });

  it('opens GitHub link in new tab', async () => {
    const user = userEvent.setup();
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<V86WindowMenuBar onClose={vi.fn()} />);

    await user.click(screen.getByText('Help'));
    await user.click(screen.getByText('v86 on GitHub'));

    expect(windowOpen).toHaveBeenCalledWith(
      'https://github.com/copy/v86',
      '_blank',
      'noopener'
    );
    windowOpen.mockRestore();
  });

  it('opens v86 demo link in new tab', async () => {
    const user = userEvent.setup();
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<V86WindowMenuBar onClose={vi.fn()} />);

    await user.click(screen.getByText('Help'));
    await user.click(screen.getByText('v86 Demo'));

    expect(windowOpen).toHaveBeenCalledWith(
      'https://copy.sh/v86/',
      '_blank',
      'noopener'
    );
    windowOpen.mockRestore();
  });
});
