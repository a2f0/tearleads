import {
  CALENDAR_CREATE_EVENT,
  CALENDAR_CREATE_ITEM_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT
} from '@rapid/calendar';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CalendarWindow } from './index';

interface MockCalendarContentProps {
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

vi.mock('@rapid/calendar', () => ({
  CALENDAR_CREATE_EVENT: 'rapid:calendar:create',
  CALENDAR_CREATE_ITEM_EVENT: 'rapid:calendar:item:create',
  CALENDAR_CREATE_SUBMIT_EVENT: 'rapid:calendar:create:submit',
  CalendarContent: ({
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
    </div>
  )
}));

vi.mock('@/components/floating-window', () => ({
  FloatingWindow: ({ children }: MockFloatingWindowProps) => (
    <div>{children}</div>
  )
}));

vi.mock('./CalendarWindowMenuBar', () => ({
  CalendarWindowMenuBar: () => <div>Calendar Menu Bar</div>
}));

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => ({
    isUnlocked: true
  })
}));

vi.mock('@/db/calendar-events', () => ({
  getCalendarEvents: vi.fn(async () => []),
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
});
