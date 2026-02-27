import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarContent } from '../components/CalendarContent';
import {
  CALENDAR_CREATE_ITEM_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT
} from '../events';
import { Calendar } from './Calendar';

describe('Calendar', () => {
  it('creates and selects a new calendar from create submit event', () => {
    render(<Calendar />);

    fireEvent(
      window,
      new CustomEvent(CALENDAR_CREATE_SUBMIT_EVENT, {
        detail: { name: 'Work' }
      })
    );

    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('switches between day, week, month, and year views', () => {
    render(<Calendar />);

    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('23:00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    expect(screen.getByText(/Week of/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Year' }));
    expect(screen.getByText('January')).toBeInTheDocument();
    expect(screen.getByText('December')).toBeInTheDocument();
  });

  it('routes to day view when a month day is double-clicked', () => {
    render(<Calendar />);

    const monthDayButtons = screen.getAllByRole('button', {
      name: /Open day view for/
    });
    const monthDayButton = monthDayButtons[0];
    if (!monthDayButton) {
      throw new Error('Expected at least one month day button');
    }

    fireEvent.doubleClick(monthDayButton);

    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('00:00')).toBeInTheDocument();
  });

  it(
    'routes to day view when a year day is clicked',
    { timeout: 10000 },
    () => {
      render(<Calendar />);

      fireEvent.click(screen.getByRole('tab', { name: 'Year' }));

      const yearDayButtons = screen.getAllByRole('button', {
        name: /Open day view for/
      });
      const yearDayButton = yearDayButtons[0];
      if (!yearDayButton) {
        throw new Error('Expected at least one year day button');
      }

      fireEvent.click(yearDayButton);

      expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByText('00:00')).toBeInTheDocument();
    }
  );

  it('highlights work hours differently in day view', () => {
    render(<Calendar />);

    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));

    const preWorkHourQuarter = screen.getByTestId('hour-slot-8-q0');
    const workHourQuarter = screen.getByTestId('hour-slot-9-q0');
    const lastWorkHourQuarter = screen.getByTestId('hour-slot-16-q0');
    const postWorkHourQuarter = screen.getByTestId('hour-slot-17-q0');

    expect(preWorkHourQuarter).toHaveClass('bg-muted/40');
    expect(workHourQuarter).toHaveClass('bg-accent/35');
    expect(lastWorkHourQuarter).toHaveClass('bg-accent/35');
    expect(postWorkHourQuarter).toHaveClass('bg-muted/40');
  });

  it(
    'routes to month view when a year month is clicked',
    { timeout: 10000 },
    () => {
      render(<Calendar />);

      fireEvent.click(screen.getByRole('tab', { name: 'Year' }));
      const year = new Date().getFullYear();

      fireEvent.click(
        screen.getByRole('button', {
          name: `Open month view for January ${year}`
        })
      );

      expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(
        screen.getByText(new RegExp(`January ${year}`))
      ).toBeInTheDocument();
    }
  );

  it('emits sidebar blank-space context menu coordinates', () => {
    const onSidebarContextMenuRequest = vi.fn();
    render(
      <CalendarContent
        onSidebarContextMenuRequest={onSidebarContextMenuRequest}
      />
    );

    fireEvent.contextMenu(screen.getByTestId('calendar-sidebar-empty-space'), {
      clientX: 120,
      clientY: 140
    });

    expect(onSidebarContextMenuRequest).toHaveBeenCalledTimes(1);
    expect(onSidebarContextMenuRequest).toHaveBeenCalledWith({
      x: 120,
      y: 140
    });
  });

  it('renames a sidebar calendar from its context menu', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('Work Renamed'));
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<CalendarContent />);

    fireEvent(
      window,
      new CustomEvent(CALENDAR_CREATE_SUBMIT_EVENT, {
        detail: { name: 'Work' }
      })
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Work' }), {
      clientX: 220,
      clientY: 180
    });
    await user.click(screen.getByTestId('calendar-sidebar-item-rename'));

    expect(promptSpy).toHaveBeenCalledWith('Rename calendar', 'Work');
    expect(
      screen.getByRole('button', { name: 'Work Renamed' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Work' })
    ).not.toBeInTheDocument();
    promptSpy.mockRestore();
  });

  it('does not rename calendar for cancel, empty, or duplicate names', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('prompt', vi.fn());
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<CalendarContent />);

    fireEvent(
      window,
      new CustomEvent(CALENDAR_CREATE_SUBMIT_EVENT, {
        detail: { name: 'Work' }
      })
    );

    const openRenameMenu = () => {
      fireEvent.contextMenu(screen.getByRole('button', { name: 'Work' }), {
        clientX: 220,
        clientY: 180
      });
    };

    promptSpy.mockReturnValueOnce(null);
    openRenameMenu();
    await user.click(screen.getByTestId('calendar-sidebar-item-rename'));
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();

    promptSpy.mockReturnValueOnce('   ');
    openRenameMenu();
    await user.click(screen.getByTestId('calendar-sidebar-item-rename'));
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();

    promptSpy.mockReturnValueOnce('Personal');
    openRenameMenu();
    await user.click(screen.getByTestId('calendar-sidebar-item-rename'));
    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Personal' })
    ).toBeInTheDocument();

    promptSpy.mockRestore();
  });

  it('navigates month view with previous and next controls', () => {
    render(<Calendar />);

    const currentDate = new Date();
    const currentMonthLabel = currentDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });
    const nextMonthDate = new Date(currentDate);
    nextMonthDate.setMonth(currentDate.getMonth() + 1);
    const nextMonthLabel = nextMonthDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });

    expect(screen.getByText(currentMonthLabel)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go to next period' }));

    expect(screen.getByText(nextMonthLabel)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Go to previous period' })
    );

    expect(screen.getByText(currentMonthLabel)).toBeInTheDocument();
  });

  it(
    'navigates year view with previous and next controls',
    { timeout: 20000 },
    () => {
      render(<Calendar />);

      const currentYear = new Date().getFullYear();

      fireEvent.click(screen.getByRole('tab', { name: 'Year' }));
      expect(screen.getByText(String(currentYear))).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Go to next period' })
      );
      expect(screen.getByText(String(currentYear + 1))).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Go to previous period' })
      );
      expect(screen.getByText(String(currentYear))).toBeInTheDocument();
    }
  );

  it('displays day events for active calendar', () => {
    const selectedDate = new Date();
    const eventDate = new Date(selectedDate);
    eventDate.setHours(9, 0, 0, 0);

    render(
      <CalendarContent
        events={[
          {
            id: 'event-1',
            calendarName: 'Personal',
            title: 'Team Standup',
            startAt: eventDate,
            endAt: new Date(eventDate.getTime() + 30 * 60 * 1000)
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    expect(screen.getByText('Team Standup')).toBeInTheDocument();
  });

  it('creates an event from create-item modal', async () => {
    const user = userEvent.setup();
    const onCreateEvent = vi.fn<
      (input: {
        calendarName: string;
        title: string;
        startAt: Date;
        endAt?: Date | null | undefined;
      }) => Promise<void>
    >(async () => {});
    render(<CalendarContent onCreateEvent={onCreateEvent} />);

    fireEvent(
      window,
      new CustomEvent(CALENDAR_CREATE_ITEM_EVENT, {
        detail: { date: new Date().toISOString() }
      })
    );
    await user.type(screen.getByLabelText('Event title'), 'Dentist');
    await user.clear(screen.getByLabelText('Event start time'));
    await user.type(screen.getByLabelText('Event start time'), '14:30');
    await user.clear(screen.getByLabelText('Event end time'));
    await user.type(screen.getByLabelText('Event end time'), '15:15');

    await user.click(screen.getByRole('button', { name: 'Add Event' }));

    expect(onCreateEvent).toHaveBeenCalledTimes(1);
    expect(onCreateEvent.mock.calls[0]?.[0]).toMatchObject({
      calendarName: 'Personal',
      title: 'Dentist'
    });
  });

  it('opens create event modal from create item event', () => {
    render(<CalendarContent />);

    fireEvent(
      window,
      new CustomEvent(CALENDAR_CREATE_ITEM_EVENT, {
        detail: { date: new Date().toISOString() }
      })
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('New Calendar Item')).toBeInTheDocument();
  });

  it('emits view context menu coordinates from day/week/month/year views', () => {
    const onViewContextMenuRequest = vi.fn();
    render(
      <CalendarContent onViewContextMenuRequest={onViewContextMenuRequest} />
    );

    fireEvent.contextMenu(screen.getByTestId('calendar-month-view'), {
      clientX: 10,
      clientY: 20
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    fireEvent.contextMenu(screen.getByTestId('calendar-week-view'), {
      clientX: 30,
      clientY: 40
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    fireEvent.contextMenu(screen.getByTestId('calendar-day-view'), {
      clientX: 50,
      clientY: 60
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Year' }));
    fireEvent.contextMenu(screen.getByTestId('calendar-year-view'), {
      clientX: 70,
      clientY: 80
    });

    expect(onViewContextMenuRequest).toHaveBeenCalledTimes(4);
    expect(onViewContextMenuRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        x: 10,
        y: 20
      })
    );
    expect(onViewContextMenuRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        x: 30,
        y: 40
      })
    );
    expect(onViewContextMenuRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        x: 50,
        y: 60
      })
    );
    expect(onViewContextMenuRequest).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        x: 70,
        y: 80
      })
    );
  });
});
