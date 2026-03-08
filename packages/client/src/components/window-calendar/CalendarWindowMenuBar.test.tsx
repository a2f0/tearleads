import {
  CALENDAR_CREATE_EVENT,
  CALENDAR_CREATE_ITEM_EVENT
} from '@tearleads/calendar';
import { ThemeProvider } from '@tearleads/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarWindowMenuBar } from './CalendarWindowMenuBar';

vi.mock('@tearleads/calendar/package.json', () => ({
  default: { version: '4.5.6' }
}));

vi.mock('@/hooks/app', () => ({
  useAppVersion: () => '0.0.0'
}));

describe('CalendarWindowMenuBar', () => {
  const renderMenuBar = ({
    onClose = vi.fn(),
    showBirthdaysFromContacts = true,
    onShowBirthdaysFromContactsChange = vi.fn()
  }: {
    onClose?: (() => void) | undefined;
    showBirthdaysFromContacts?: boolean | undefined;
    onShowBirthdaysFromContactsChange?: ((show: boolean) => void) | undefined;
  } = {}) =>
    render(
      <ThemeProvider>
        <CalendarWindowMenuBar
          onClose={onClose}
          showBirthdaysFromContacts={showBirthdaysFromContacts}
          onShowBirthdaysFromContactsChange={onShowBirthdaysFromContactsChange}
        />
      </ThemeProvider>
    );

  it('renders File, View, and Help menu triggers', () => {
    renderMenuBar();

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('shows New Calendar, New Item, and Close in File menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'New Calendar' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'New Item' })
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
    renderMenuBar({ onClose });

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dispatches create-item event from File menu', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener(CALENDAR_CREATE_ITEM_EVENT, listener);
    try {
      renderMenuBar();

      await user.click(screen.getByRole('button', { name: 'File' }));
      await user.click(screen.getByRole('menuitem', { name: 'New Item' }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: CALENDAR_CREATE_ITEM_EVENT,
          detail: null
        })
      );
    } finally {
      window.removeEventListener(CALENDAR_CREATE_ITEM_EVENT, listener);
    }
  });

  it('shows Options in View menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });

  it('shows birthdays toggle in View menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Show Contact Birthdays' })
    ).toBeInTheDocument();
  });

  it('calls onShowBirthdaysFromContactsChange when birthdays toggle is clicked', async () => {
    const user = userEvent.setup();
    const onShowBirthdaysFromContactsChange = vi.fn();
    renderMenuBar({
      showBirthdaysFromContacts: true,
      onShowBirthdaysFromContactsChange
    });

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(
      screen.getByRole('menuitem', { name: 'Show Contact Birthdays' })
    );

    expect(onShowBirthdaysFromContactsChange).toHaveBeenCalledWith(false);
  });

  it('opens About dialog from Help menu', async () => {
    const user = userEvent.setup();
    renderMenuBar();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About' }));

    expect(screen.getByText('About Calendar')).toBeInTheDocument();
    expect(screen.getByTestId('about-version')).toHaveTextContent('4.5.6');
  });
});
