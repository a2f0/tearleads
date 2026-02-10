import {
  CALENDAR_CREATE_EVENT,
  CALENDAR_CREATE_ITEM_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT
} from '@rapid/calendar';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  getCalendarEvents,
  getContactBirthdayEvents
} from '@/db/calendar-events';
import { CalendarWindow } from './index';

interface MockCalendarContentProps {
  events?: { id: string }[] | undefined;
  onSidebarContextMenuRequest?:
    | ((position: { x: number; y: number }) => void)
    | undefined;
  onViewContextMenuRequest?:
    | ((position: { x: number; y: number; date: Date }) => void)
    | undefined;
}

interface MockFloatingWindowProps {
  children: ReactNode;
}

interface MockCalendarWindowMenuBarProps {
  showBirthdaysFromContacts: boolean;
  onShowBirthdaysFromContactsChange: (show: boolean) => void;
}

interface MockContextMenuProps {
  children: ReactNode;
  onClose: () => void;
}

vi.mock('@rapid/calendar', () => ({
  CALENDAR_CREATE_EVENT: 'rapid:calendar:create',
  CALENDAR_CREATE_ITEM_EVENT: 'rapid:calendar:item:create',
  CALENDAR_CREATE_SUBMIT_EVENT: 'rapid:calendar:create:submit',
  CalendarContent: ({
    events,
    onSidebarContextMenuRequest,
    onViewContextMenuRequest
  }: MockCalendarContentProps) => (
    <div>
      <button
        type="button"
        data-testid="sidebar-context-trigger"
        onClick={() => onSidebarContextMenuRequest?.({ x: 120, y: 140 })}
      >
        Trigger Sidebar Context Menu
      </button>
      <button
        type="button"
        data-testid="view-context-trigger"
        onClick={() =>
          onViewContextMenuRequest?.({
            x: 220,
            y: 240,
            date: new Date('2026-02-09T00:00:00.000Z')
          })
        }
      >
        Trigger View Context Menu
      </button>
      <p data-testid="event-count">{events?.length ?? 0}</p>
    </div>
  )
}));

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({ children }: MockFloatingWindowProps) => (
    <div>{children}</div>
  )
}));

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children, onClose }: MockContextMenuProps) => (
    <div>
      <button type="button" data-testid="context-menu-close" onClick={onClose}>
        Close Context Menu
      </button>
      {children}
    </div>
  ),
  ContextMenuItem: ({
    children,
    onClick
  }: {
    children: ReactNode;
    onClick: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  )
}));

vi.mock('./CalendarWindowMenuBar', () => ({
  CalendarWindowMenuBar: ({
    showBirthdaysFromContacts,
    onShowBirthdaysFromContactsChange
  }: MockCalendarWindowMenuBarProps) => (
    <button
      type="button"
      onClick={() =>
        onShowBirthdaysFromContactsChange(!showBirthdaysFromContacts)
      }
      data-testid="toggle-birthdays-menu-item"
    >
      Calendar Menu Bar
    </button>
  )
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true
  })
}));

vi.mock('@/db/calendar-events', () => ({
  getCalendarEvents: vi.fn(async () => []),
  getContactBirthdayEvents: vi.fn(async () => []),
  createCalendarEvent: vi.fn(async () => null)
}));

describe('CalendarWindow', () => {
  it('opens create dialog from shared context menu and submits calendar name', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener(CALENDAR_CREATE_SUBMIT_EVENT, listener);
    try {
      render(
        <CalendarWindow
          id="calendar-window"
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onFocus={vi.fn()}
          zIndex={200}
        />
      );

      await user.click(screen.getByTestId('sidebar-context-trigger'));

      const newCalendarItem = screen.getByRole('button', {
        name: 'New Calendar'
      });
      await user.click(newCalendarItem);
      await user.type(screen.getByTestId('new-calendar-name-input'), 'Work');
      await user.click(screen.getByTestId('new-calendar-create'));

      expect(listener).toHaveBeenCalledTimes(1);
      const firstCall = listener.mock.calls[0];
      const createEvent = firstCall?.[0];
      if (!(createEvent instanceof CustomEvent)) {
        throw new Error('Expected create submit event');
      }
      expect(createEvent.detail).toEqual({ name: 'Work' });
    } finally {
      window.removeEventListener(CALENDAR_CREATE_SUBMIT_EVENT, listener);
    }
  });

  it('opens create dialog when create request event is dispatched', async () => {
    render(
      <CalendarWindow
        id="calendar-window"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={200}
      />
    );

    fireEvent(window, new Event(CALENDAR_CREATE_EVENT));

    expect(
      await screen.findByTestId('new-calendar-dialog')
    ).toBeInTheDocument();
  });

  it('dispatches create-item event from view context menu', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener(CALENDAR_CREATE_ITEM_EVENT, listener);
    try {
      render(
        <CalendarWindow
          id="calendar-window"
          onClose={vi.fn()}
          onMinimize={vi.fn()}
          onFocus={vi.fn()}
          zIndex={200}
        />
      );

      await user.click(screen.getByTestId('view-context-trigger'));
      await user.click(screen.getByRole('button', { name: 'New Item' }));

      expect(listener).toHaveBeenCalledTimes(1);
      const createItemEvent = listener.mock.calls[0]?.[0];
      if (!(createItemEvent instanceof CustomEvent)) {
        throw new Error('Expected create item event');
      }
      expect(createItemEvent.detail).toEqual({
        date: '2026-02-09T00:00:00.000Z'
      });
    } finally {
      window.removeEventListener(CALENDAR_CREATE_ITEM_EVENT, listener);
    }
  });

  it('shows birthdays from contacts by default and hides them when toggled off', async () => {
    const user = userEvent.setup();
    vi.mocked(getCalendarEvents).mockResolvedValueOnce([
      {
        id: 'event-1',
        calendarName: 'Personal',
        title: 'Normal Event',
        startAt: new Date('2026-02-10T10:00:00.000Z'),
        endAt: null,
        createdAt: new Date('2026-02-10T09:00:00.000Z'),
        updatedAt: new Date('2026-02-10T09:00:00.000Z')
      }
    ]);
    vi.mocked(getContactBirthdayEvents).mockResolvedValueOnce([
      {
        id: 'birthday:contact-1:2026',
        calendarName: 'Personal',
        title: "Alex's Birthday",
        startAt: new Date('2026-02-10T00:00:00.000Z'),
        endAt: null
      }
    ]);

    render(
      <CalendarWindow
        id="calendar-window"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={200}
      />
    );

    expect(await screen.findByTestId('event-count')).toHaveTextContent('2');
    await user.click(screen.getByTestId('toggle-birthdays-menu-item'));
    expect(screen.getByTestId('event-count')).toHaveTextContent('1');
  });

  it('closes sidebar context menu when context menu requests close', async () => {
    const user = userEvent.setup();
    render(
      <CalendarWindow
        id="calendar-window"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={200}
      />
    );

    await user.click(screen.getByTestId('sidebar-context-trigger'));
    expect(screen.getByRole('button', { name: 'New Calendar' })).toBeVisible();

    await user.click(screen.getByTestId('context-menu-close'));
    expect(
      screen.queryByRole('button', { name: 'New Calendar' })
    ).not.toBeInTheDocument();
  });

  it('closes view context menu when context menu requests close', async () => {
    const user = userEvent.setup();
    render(
      <CalendarWindow
        id="calendar-window"
        onClose={vi.fn()}
        onMinimize={vi.fn()}
        onFocus={vi.fn()}
        zIndex={200}
      />
    );

    await user.click(screen.getByTestId('view-context-trigger'));
    expect(screen.getByRole('button', { name: 'New Item' })).toBeVisible();

    await user.click(screen.getByTestId('context-menu-close'));
    expect(
      screen.queryByRole('button', { name: 'New Item' })
    ).not.toBeInTheDocument();
  });
});
