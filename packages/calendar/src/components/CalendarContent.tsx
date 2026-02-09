import { clsx } from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CALENDAR_CREATE_SUBMIT_EVENT } from '../events';

const defaultCalendarName = 'Personal';
const defaultCalendars = [defaultCalendarName];
const viewModes = ['Day', 'Week', 'Month', 'Year'] as const;
type CalendarViewMode = (typeof viewModes)[number];
const calendarLocale = 'en-US';
const weekDayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const yearMonthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

interface CalendarContentProps {
  events?: CalendarEventItem[] | undefined;
  onCreateEvent?:
    | ((input: CreateCalendarEventInput) => Promise<void> | void)
    | undefined;
  onSidebarContextMenuRequest?:
    | ((position: { x: number; y: number }) => void)
    | undefined;
}

export interface CalendarEventItem {
  id: string;
  calendarName: string;
  title: string;
  startAt: Date;
  endAt?: Date | null | undefined;
}

export interface CreateCalendarEventInput {
  calendarName: string;
  title: string;
  startAt: Date;
  endAt?: Date | null | undefined;
}

export function CalendarContent({
  events = [],
  onCreateEvent,
  onSidebarContextMenuRequest
}: CalendarContentProps = {}) {
  const [calendars, setCalendars] = useState<string[]>(defaultCalendars);
  const [activeCalendar, setActiveCalendar] =
    useState<string>(defaultCalendarName);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('Month');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventTime, setNewEventTime] = useState('09:00');
  const [newEventDurationMinutes, setNewEventDurationMinutes] = useState('60');
  const [creatingEvent, setCreatingEvent] = useState(false);

  const normalizedNames = useMemo(
    () => new Set(calendars.map((name) => name.toLowerCase())),
    [calendars]
  );

  const createCalendar = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      if (normalizedNames.has(trimmedName.toLowerCase())) return;

      setCalendars((prev) => [...prev, trimmedName]);
      setActiveCalendar(trimmedName);
    },
    [normalizedNames]
  );

  const handleCreateCalendarSubmit = useCallback(
    (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { name?: string } | undefined;
      if (!detail?.name) return;
      createCalendar(detail.name);
    },
    [createCalendar]
  );

  useEffect(() => {
    window.addEventListener(
      CALENDAR_CREATE_SUBMIT_EVENT,
      handleCreateCalendarSubmit
    );
    return () => {
      window.removeEventListener(
        CALENDAR_CREATE_SUBMIT_EVENT,
        handleCreateCalendarSubmit
      );
    };
  }, [handleCreateCalendarSubmit]);

  const dayLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString(calendarLocale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }),
    [selectedDate]
  );

  const monthLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString(calendarLocale, {
        month: 'long',
        year: 'numeric'
      }),
    [selectedDate]
  );

  const weekDates = useMemo(() => {
    const weekStart = new Date(selectedDate);
    weekStart.setDate(selectedDate.getDate() - selectedDate.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return date;
    });
  }, [selectedDate]);

  const monthCells = useMemo(() => {
    const monthStart = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      1
    );
    const monthEnd = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth() + 1,
      0
    );
    const monthLeadingDays = monthStart.getDay();
    const monthTrailingDays = 6 - monthEnd.getDay();
    const cells: Array<{ date: Date; inMonth: boolean }> = [];

    for (let i = monthLeadingDays; i > 0; i -= 1) {
      cells.push({
        date: new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          1 - i
        ),
        inMonth: false
      });
    }
    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      cells.push({
        date: new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          day
        ),
        inMonth: true
      });
    }
    for (let i = 1; i <= monthTrailingDays; i += 1) {
      cells.push({
        date: new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth() + 1,
          i
        ),
        inMonth: false
      });
    }

    return cells;
  }, [selectedDate]);

  const yearData = useMemo(() => {
    const currentYear = selectedDate.getFullYear();

    return yearMonthNames.map((monthName, monthIndex) => {
      const start = new Date(currentYear, monthIndex, 1);
      const end = new Date(currentYear, monthIndex + 1, 0);
      const leading = start.getDay();
      const cells: Array<{ day: number; inMonth: boolean; key: string }> = [];

      for (let i = leading; i > 0; i -= 1) {
        cells.push({ day: 0, inMonth: false, key: `leading-${i}` });
      }
      for (let day = 1; day <= end.getDate(); day += 1) {
        cells.push({ day, inMonth: true, key: `day-${day}` });
      }
      let trailing = 0;
      while (cells.length % 7 !== 0) {
        trailing += 1;
        cells.push({ day: 0, inMonth: false, key: `trailing-${trailing}` });
      }

      return { monthName, cells };
    });
  }, [selectedDate]);

  const currentYear = selectedDate.getFullYear();

  const isSameDay = useCallback(
    (date: Date, other: Date) =>
      date.getFullYear() === other.getFullYear() &&
      date.getMonth() === other.getMonth() &&
      date.getDate() === other.getDate(),
    []
  );

  const getDateKey = useCallback(
    (date: Date) =>
      `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    []
  );

  const calendarEvents = useMemo(
    () => events.filter((event) => event.calendarName === activeCalendar),
    [activeCalendar, events]
  );

  const dayEvents = useMemo(
    () =>
      calendarEvents
        .filter((event) => isSameDay(event.startAt, selectedDate))
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime()),
    [calendarEvents, isSameDay, selectedDate]
  );

  const dayEventCount = dayEvents.length;

  const eventCountByDay = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const event of calendarEvents) {
      const key = getDateKey(event.startAt);
      const previousCount = countMap.get(key) ?? 0;
      countMap.set(key, previousCount + 1);
    }
    return countMap;
  }, [calendarEvents, getDateKey]);

  const handleCreateEvent = useCallback(async () => {
    const title = newEventTitle.trim();
    if (!title || !onCreateEvent || creatingEvent) return;

    const [hoursPart, minutesPart] = newEventTime.split(':');
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);
    const durationMinutes = Number(newEventDurationMinutes);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return;

    const startAt = new Date(selectedDate);
    startAt.setHours(hours, minutes, 0, 0);

    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + durationMinutes);

    try {
      setCreatingEvent(true);
      await onCreateEvent({
        calendarName: activeCalendar,
        title,
        startAt,
        endAt
      });
      setNewEventTitle('');
    } finally {
      setCreatingEvent(false);
    }
  }, [
    activeCalendar,
    creatingEvent,
    newEventDurationMinutes,
    newEventTime,
    newEventTitle,
    onCreateEvent,
    selectedDate
  ]);

  const renderDayView = () => (
    <div className="h-full overflow-auto rounded-xl border bg-card p-4">
      <p className="font-medium text-sm uppercase tracking-wide">{dayLabel}</p>
      <form
        className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreateEvent();
        }}
      >
        <input
          type="text"
          value={newEventTitle}
          onChange={(event) => setNewEventTitle(event.target.value)}
          placeholder="Event title"
          className="rounded-md border bg-background px-2 py-1 text-base"
          aria-label="Event title"
        />
        <input
          type="time"
          value={newEventTime}
          onChange={(event) => setNewEventTime(event.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-base"
          aria-label="Event start time"
        />
        <input
          type="number"
          min={1}
          step={1}
          value={newEventDurationMinutes}
          onChange={(event) => setNewEventDurationMinutes(event.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-base"
          aria-label="Event duration in minutes"
        />
        <button
          type="submit"
          disabled={!newEventTitle.trim() || creatingEvent || !onCreateEvent}
          className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add Event
        </button>
      </form>
      <div className="mt-3 space-y-2">
        {dayEvents.length > 0 ? (
          dayEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2"
            >
              <p className="font-medium text-sm">{event.title}</p>
              <p className="text-muted-foreground text-xs">
                {event.startAt.toLocaleTimeString(calendarLocale, {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
                {event.endAt
                  ? ` - ${event.endAt.toLocaleTimeString(calendarLocale, {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}`
                  : ''}
              </p>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground text-xs">
            No events for this day.
          </p>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: 12 }, (_, index) => index + 8).map((hour) => (
          <div
            key={hour}
            className="flex items-center gap-3 border-border/60 border-b pb-2 text-sm"
          >
            <span className="w-14 shrink-0 font-medium text-muted-foreground">
              {hour.toString().padStart(2, '0')}:00
            </span>
            <div className="h-8 flex-1 rounded bg-muted/40" />
          </div>
        ))}
      </div>
    </div>
  );

  const renderWeekView = () => (
    <div className="h-full overflow-auto rounded-xl border bg-card p-4">
      <p className="font-medium text-sm uppercase tracking-wide">
        Week of {weekDates[0]?.toLocaleDateString(calendarLocale)}
      </p>
      <div className="mt-4 grid grid-cols-7 gap-2">
        {weekDates.map((date) => (
          <div
            key={date.toISOString()}
            className={clsx(
              'rounded-md border p-2 text-center',
              isSameDay(date, selectedDate) && 'border-primary bg-primary/10'
            )}
          >
            <p className="text-[11px] text-muted-foreground uppercase">
              {date.toLocaleDateString(calendarLocale, { weekday: 'short' })}
            </p>
            <p className="mt-1 font-medium text-sm">{date.getDate()}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {eventCountByDay.get(getDateKey(date)) ?? 0} events
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  const renderMonthView = () => (
    <div className="h-full overflow-auto rounded-xl border bg-card p-4">
      <p className="font-medium text-sm uppercase tracking-wide">
        {monthLabel}
      </p>
      <div className="mt-4 grid grid-cols-7 gap-2">
        {weekDayHeaders.map((day) => (
          <p
            key={day}
            className="text-center font-medium text-[11px] text-muted-foreground uppercase"
          >
            {day}
          </p>
        ))}
        {monthCells.map(({ date, inMonth }) => {
          const eventCount = eventCountByDay.get(getDateKey(date));

          return (
            <button
              type="button"
              key={date.toISOString()}
              onDoubleClick={() => {
                setSelectedDate(date);
                setViewMode('Day');
              }}
              aria-label={`Open day view for ${date.toLocaleDateString(
                calendarLocale,
                {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric'
                }
              )}`}
              className={clsx(
                'h-12 rounded-md border px-1 py-1 text-right text-sm',
                inMonth
                  ? 'border-border bg-background'
                  : 'border-border/60 bg-muted/20 text-muted-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
              )}
            >
              <span
                className={clsx(isSameDay(date, selectedDate) && 'font-bold')}
              >
                {date.getDate()}
              </span>
              {eventCount ? (
                <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                  {eventCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderYearView = () => (
    <div className="h-full overflow-auto rounded-xl border bg-card p-4">
      <p className="font-medium text-sm uppercase tracking-wide">
        {currentYear}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {yearData.map(({ monthName, cells }, monthIndex) => (
          <div key={monthName} className="rounded-md border bg-background p-2">
            <button
              type="button"
              onClick={() => {
                setSelectedDate(new Date(currentYear, monthIndex, 1));
                setViewMode('Month');
              }}
              aria-label={`Open month view for ${monthName} ${currentYear}`}
              className="mb-1 font-medium text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {monthName}
            </button>
            <div className="grid grid-cols-7 gap-1">
              {weekDayHeaders.map((day) => (
                <span
                  key={`${monthName}-${day}`}
                  className="text-center text-[10px] text-muted-foreground"
                >
                  {day[0]}
                </span>
              ))}
              {cells.map((cell) => {
                if (!cell.inMonth || cell.day === 0) {
                  return (
                    <span
                      key={`${monthName}-${cell.key}`}
                      className="text-center text-[10px] text-muted-foreground"
                    >
                      {cell.day || ''}
                    </span>
                  );
                }

                const monthDate = new Date(currentYear, monthIndex, cell.day);
                return (
                  <button
                    type="button"
                    key={`${monthName}-${cell.key}`}
                    onClick={() => {
                      setSelectedDate(monthDate);
                      setViewMode('Day');
                    }}
                    aria-label={`Open day view for ${monthDate.toLocaleDateString(
                      calendarLocale,
                      {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric'
                      }
                    )}`}
                    className={clsx(
                      'rounded text-center text-[10px] text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderActiveView = () =>
    (
      ({
        Day: renderDayView,
        Week: renderWeekView,
        Month: renderMonthView,
        Year: renderYearView
      }) as const
    )[viewMode]();

  const handlePeriodNavigation = useCallback(
    (direction: -1 | 1) => {
      setSelectedDate((previousDate) => {
        const nextDate = new Date(previousDate);

        switch (viewMode) {
          case 'Day':
            nextDate.setDate(previousDate.getDate() + direction);
            break;
          case 'Week':
            nextDate.setDate(previousDate.getDate() + direction * 7);
            break;
          case 'Month':
            nextDate.setMonth(previousDate.getMonth() + direction);
            break;
          case 'Year':
            nextDate.setFullYear(previousDate.getFullYear() + direction);
            break;
        }

        return nextDate;
      });
    },
    [viewMode]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20 p-3">
          <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            My Calendars
          </p>
          <div className="space-y-1 overflow-y-auto">
            {calendars.map((name) => {
              const isActive = name === activeCalendar;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setActiveCalendar(name)}
                  className={clsx(
                    'w-full rounded-md px-2 py-1 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="mt-2 flex-1"
            data-testid="calendar-sidebar-empty-space"
            onContextMenu={(event) => {
              event.preventDefault();
              onSidebarContextMenuRequest?.({
                x: event.clientX,
                y: event.clientY
              });
            }}
            aria-label="Calendar sidebar empty space"
          />
        </aside>

        <section className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium text-base">{activeCalendar}</p>
            <p className="text-muted-foreground text-xs">
              {dayEventCount} events on selected day
            </p>
            <div className="flex items-center gap-2">
              <div
                className="inline-flex items-center rounded-full border bg-muted/30 p-1"
                role="tablist"
                aria-label="Calendar view mode"
              >
                {viewModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={viewMode === mode}
                    onClick={() => setViewMode(mode)}
                    className={clsx(
                      'rounded-full px-3 py-1 font-medium text-xs transition-colors',
                      viewMode === mode
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="inline-flex items-center rounded-full border bg-muted/30 p-1">
                <button
                  type="button"
                  aria-label="Go to previous period"
                  onClick={() => handlePeriodNavigation(-1)}
                  className="rounded-full px-2 py-1 font-medium text-muted-foreground/60 text-xs transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {'<'}
                </button>
                <button
                  type="button"
                  aria-label="Go to next period"
                  onClick={() => handlePeriodNavigation(1)}
                  className="rounded-full px-2 py-1 font-medium text-muted-foreground/60 text-xs transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {'>'}
                </button>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1">{renderActiveView()}</div>
        </section>
      </div>
    </div>
  );
}
