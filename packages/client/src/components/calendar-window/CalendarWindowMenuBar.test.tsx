import { CALENDAR_CREATE_EVENT } from '@rapid/calendar';
import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarWindowMenuBar } from './CalendarWindowMenuBar';

vi.mock('@/hooks/useAppVersion', () => ({
  useAppVersion: () => '1.2.3'
}));

describe('CalendarWindowMenuBar', () => {
  const renderMenuBar = (onClose = vi.fn()) =>
    render(
      <ThemeProvider>
        <CalendarWindowMenuBar onClose={onClose} />
      </ThemeProvider>
    );

  it('renders File, View, and Help menu triggers', () => {
    renderMenuBar();

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('shows New Calendar and Close in File menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'New Calendar' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('dispatches calendar create event from File menu', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener(CALENDAR_CREATE_EVENT, listener);
    try {
      renderMenuBar();

      await user.click(screen.getByRole('button', { name: 'File' }));
      await user.click(screen.getByRole('menuitem', { name: 'New Calendar' }));

      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(CALENDAR_CREATE_EVENT, listener);
    }
  });

  it('calls onClose when Close is clicked in File menu', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderMenuBar(onClose);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows Options in View menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });

  it('opens About dialog from Help menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('About Calendar')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('1.2.3');
  });
});
