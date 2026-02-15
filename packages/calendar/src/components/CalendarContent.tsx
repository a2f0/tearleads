import {
  WindowContextMenu,
  WindowContextMenuItem
} from '@tearleads/window-manager';
import { clsx } from 'clsx';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  CALENDAR_CREATE_ITEM_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT
} from '../events';
import {
  isSlotInSelection,
  selectionToTimeRange,
  useTimeRangeSelection
} from '../hooks/useTimeRangeSelection';
import type { CalendarEventItem } from '../types';
import { getPositionedEventsForDay } from '../utils/eventPositioning';
import { DayViewEventBlock } from './DayViewEventBlock';
import { DayViewHourSlot } from './DayViewHourSlot';
import {
  type CreateCalendarEventInput,
  NewCalendarEventModal
} from './NewCalendarEventModal';

const defaultCalendarName = 'Personal';
const defaultCalendars = [defaultCalendarName];
const viewModes = ['Day', 'Week', 'Month', 'Year'] as const;
type CalendarViewMode = (typeof viewModes)[number];
const calendarLocale = 'en-US';
const weekDayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayViewHours = Array.from({ length: 24 }, (_, hour) => hour);
const workHourStart = 9;
const workHourEnd = 17;
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
  onViewContextMenuRequest?:
    | ((position: { x: number; y: number; date: Date }) => void)
    | undefined;
}

export type { CalendarEventItem } from '../types';
export type { CreateCalendarEventInput };

export function CalendarContent({
  events = [],
  onCreateEvent,
  onSidebarContextMenuRequest,
  onViewContextMenuRequest
}: CalendarContentProps = {}) {
  const [calendars, setCalendars] = useState<string[]>(defaultCalendars);
  const [activeCalendar, setActiveCalendar] =
    useState<string>(defaultCalendarName);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('Month');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [createEventModalOpen, setCreateEventModalOpen] = useState(false);
  const [createEventModalDate, setCreateEventModalDate] = useState(
    () => new Date()
  );
  const [createEventInitialStartTime, setCreateEventInitialStartTime] =
    useState<string | undefined>(undefined);
  const [createEventInitialEndTime, setCreateEventInitialEndTime] = useState<
    string | undefined
  >(undefined);
  const [calendarContextMenu, setCalendarContextMenu] = useState<{
    x: number;
    y: number;
    name: string;
  } | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<{
    x: number;
    y: number;
    startTime: string;
    endTime: string;
  } | null>(null);

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

  const handleOpenCreateItemModal = useCallback((date: Date) => {
    setSelectedDate(date);
    setCreateEventModalDate(date);
    setCreateEventInitialStartTime(undefined);
    setCreateEventInitialEndTime(undefined);
    setCreateEventModalOpen(true);
  }, []);

  const handleCreateItemRequest = useCallback(
    (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { date?: string } | undefined;
      if (detail?.date) {
        const date = new Date(detail.date);
        if (!Number.isNaN(date.getTime())) {
          handleOpenCreateItemModal(date);
          return;
        }
      }
      handleOpenCreateItemModal(selectedDate);
    },
    [handleOpenCreateItemModal, selectedDate]
  );

  useEffect(() => {
    window.addEventListener(
      CALENDAR_CREATE_ITEM_EVENT,
      handleCreateItemRequest
    );
    return () => {
      window.removeEventListener(
        CALENDAR_CREATE_ITEM_EVENT,
        handleCreateItemRequest
      );
    };
  }, [handleCreateItemRequest]);

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

  const positionedDayEvents = useMemo(
    () => getPositionedEventsForDay(calendarEvents, selectedDate),
    [calendarEvents, selectedDate]
  );

  const {
    selection: timeSelection,
    isSelecting,
    handleSlotMouseDown,
    handleSlotMouseEnter,
    handleSlotClick,
    clearSelection: clearTimeSelection
  } = useTimeRangeSelection({
    enabled: viewMode === 'Day'
  });

  const handleSelectionContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!timeSelection) return;

      event.preventDefault();
      const { startTime, endTime } = selectionToTimeRange(
        timeSelection,
        selectedDate
      );

      setSelectionContextMenu({
        x: event.clientX,
        y: event.clientY,
        startTime: `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`,
        endTime: `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`
      });
    },
    [timeSelection, selectedDate]
  );

  const handleCloseSelectionContextMenu = useCallback(() => {
    setSelectionContextMenu(null);
  }, []);

  const handleCreateEventFromSelection = useCallback(() => {
    if (!selectionContextMenu) return;

    setCreateEventModalDate(selectedDate);
    setCreateEventInitialStartTime(selectionContextMenu.startTime);
    setCreateEventInitialEndTime(selectionContextMenu.endTime);
    setCreateEventModalOpen(true);
    setSelectionContextMenu(null);
    clearTimeSelection();
  }, [selectionContextMenu, selectedDate, clearTimeSelection]);

  const eventCountByDay = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const event of calendarEvents) {
      const key = getDateKey(event.startAt);
      const previousCount = countMap.get(key) ?? 0;
      countMap.set(key, previousCount + 1);
    }
    return countMap;
  }, [calendarEvents, getDateKey]);

  const handleViewContextMenuRequest = useCallback(
    (event: ReactMouseEvent<HTMLElement>, date: Date) => {
      event.preventDefault();
      setSelectedDate(date);
      onViewContextMenuRequest?.({
        x: event.clientX,
        y: event.clientY,
        date
      });
    },
    [onViewContextMenuRequest]
  );

  const handleCloseCalendarContextMenu = useCallback(() => {
    setCalendarContextMenu(null);
  }, []);

  const handleCalendarContextMenuRequest = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, name: string) => {
      event.preventDefault();
      event.stopPropagation();
      setCalendarContextMenu({
        x: event.clientX,
        y: event.clientY,
        name
      });
    },
    []
  );

  const renameCalendar = useCallback(
    (currentName: string) => {
      const requestedName = window.prompt('Rename calendar', currentName);
      if (requestedName === null) {
        return;
      }

      const trimmedName = requestedName.trim();
      if (!trimmedName) {
        return;
      }

      if (
        trimmedName.toLowerCase() !== currentName.toLowerCase() &&
        normalizedNames.has(trimmedName.toLowerCase())
      ) {
        return;
      }

      setCalendars((previousCalendars) =>
        previousCalendars.map((calendarName) =>
          calendarName === currentName ? trimmedName : calendarName
        )
      );
      setActiveCalendar((previousActiveCalendar) =>
        previousActiveCalendar === currentName
          ? trimmedName
          : previousActiveCalendar
      );
    },
    [normalizedNames]
  );

  const handleRenameCalendar = useCallback(() => {
    if (!calendarContextMenu) {
      return;
    }
    renameCalendar(calendarContextMenu.name);
    setCalendarContextMenu(null);
  }, [calendarContextMenu, renameCalendar]);

  const renderDayView = () => {
    const getQuarterSelections = (
      hour: number
    ): [boolean, boolean, boolean, boolean] => [
      isSlotInSelection({ hour, quarter: 0 }, timeSelection),
      isSlotInSelection({ hour, quarter: 1 }, timeSelection),
      isSlotInSelection({ hour, quarter: 2 }, timeSelection),
      isSlotInSelection({ hour, quarter: 3 }, timeSelection)
    ];

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: container with child interactive elements
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard navigation handled by child hour slots
      <div
        className="h-full overflow-auto rounded-xl border bg-card p-4"
        data-testid="calendar-day-view"
        onContextMenu={(event) => {
          if (timeSelection) {
            handleSelectionContextMenu(event);
          } else {
            handleViewContextMenuRequest(event, selectedDate);
          }
        }}
        onClick={(event) => {
          if (
            !(event.target as HTMLElement).closest('[data-testid^="hour-slot"]')
          ) {
            clearTimeSelection();
          }
        }}
      >
        <p className="font-medium text-sm uppercase tracking-wide">
          {dayLabel}
        </p>
        <div className="relative mt-4">
          <div>
            {dayViewHours.map((hour) => {
              const isWorkHour = hour >= workHourStart && hour < workHourEnd;
              return (
                <DayViewHourSlot
                  key={hour}
                  hour={hour}
                  isWorkHour={isWorkHour}
                  quarterSelections={getQuarterSelections(hour)}
                  isSelecting={isSelecting}
                  onMouseDown={handleSlotMouseDown}
                  onMouseEnter={handleSlotMouseEnter}
                  onClick={handleSlotClick}
                />
              );
            })}
          </div>
          <div className="pointer-events-none absolute inset-0 ml-14">
            {positionedDayEvents.map((positioned) => (
              <DayViewEventBlock
                key={positioned.event.id}
                event={positioned.event}
                top={positioned.top}
                height={positioned.height}
                left={positioned.left}
                width={positioned.width}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu surface
    <div
      className="h-full overflow-auto rounded-xl border bg-card p-4"
      data-testid="calendar-week-view"
      onContextMenu={(event) =>
        handleViewContextMenuRequest(event, selectedDate)
      }
    >
      <p className="font-medium text-sm uppercase tracking-wide">
        Week of {weekDates[0]?.toLocaleDateString(calendarLocale)}
      </p>
      <div className="mt-4 grid grid-cols-7 gap-2">
        {weekDates.map((date) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu per day card
          <div
            key={date.toISOString()}
            className={clsx(
              'rounded-md border p-2 text-center',
              isSameDay(date, selectedDate) && 'border-primary bg-primary/10'
            )}
            onContextMenu={(event) => {
              event.stopPropagation();
              handleViewContextMenuRequest(event, date);
            }}
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
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu surface
    <div
      className="h-full overflow-auto rounded-xl border bg-card p-4"
      data-testid="calendar-month-view"
      onContextMenu={(event) =>
        handleViewContextMenuRequest(event, selectedDate)
      }
    >
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
              onContextMenu={(event) => {
                event.stopPropagation();
                handleViewContextMenuRequest(event, date);
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
                'flex aspect-square items-start justify-end rounded-md border px-1 py-1 text-sm',
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
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu surface
    <div
      className="h-full overflow-auto rounded-xl border bg-card p-4"
      data-testid="calendar-year-view"
      onContextMenu={(event) =>
        handleViewContextMenuRequest(event, selectedDate)
      }
    >
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
                    onContextMenu={(event) => {
                      event.stopPropagation();
                      handleViewContextMenuRequest(event, monthDate);
                    }}
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
                  onContextMenu={(event) =>
                    handleCalendarContextMenuRequest(event, name)
                  }
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
      <NewCalendarEventModal
        open={createEventModalOpen}
        onOpenChange={setCreateEventModalOpen}
        calendarName={activeCalendar}
        selectedDate={createEventModalDate}
        initialStartTime={createEventInitialStartTime}
        initialEndTime={createEventInitialEndTime}
        onCreateEvent={onCreateEvent}
      />
      {calendarContextMenu ? (
        <WindowContextMenu
          x={calendarContextMenu.x}
          y={calendarContextMenu.y}
          onClose={handleCloseCalendarContextMenu}
          menuTestId="calendar-sidebar-item-context-menu"
          backdropTestId="calendar-sidebar-item-context-menu-backdrop"
        >
          <WindowContextMenuItem
            onClick={handleRenameCalendar}
            data-testid="calendar-sidebar-item-rename"
          >
            Rename Calendar
          </WindowContextMenuItem>
        </WindowContextMenu>
      ) : null}
      {selectionContextMenu ? (
        <WindowContextMenu
          x={selectionContextMenu.x}
          y={selectionContextMenu.y}
          onClose={handleCloseSelectionContextMenu}
          menuTestId="calendar-selection-context-menu"
          backdropTestId="calendar-selection-context-menu-backdrop"
        >
          <WindowContextMenuItem
            onClick={handleCreateEventFromSelection}
            data-testid="calendar-create-event-from-selection"
          >
            Create Event ({selectionContextMenu.startTime} -{' '}
            {selectionContextMenu.endTime})
          </WindowContextMenuItem>
        </WindowContextMenu>
      ) : null}
    </div>
  );
}
