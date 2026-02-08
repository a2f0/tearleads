import { clsx } from 'clsx';
import { CalendarPlus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

const defaultCalendars = ['Personal'];
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

export interface CalendarContentProps {
  title?: string;
}

export function CalendarContent({ title = 'Calendar' }: CalendarContentProps) {
  const [calendarName, setCalendarName] = useState('');
  const [calendars, setCalendars] = useState<string[]>(defaultCalendars);
  const [activeCalendar, setActiveCalendar] = useState(defaultCalendars[0]);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('Month');
  const selectedDate = useMemo(() => new Date(), []);

  const normalizedNames = useMemo(
    () => new Set(calendars.map((name) => name.toLowerCase())),
    [calendars]
  );

  const handleCreateCalendar = () => {
    const trimmedName = calendarName.trim();
    if (!trimmedName) return;
    if (normalizedNames.has(trimmedName.toLowerCase())) return;

    setCalendars((prev) => [...prev, trimmedName]);
    setActiveCalendar(trimmedName);
    setCalendarName('');
  };

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

  const isSameDay = (date: Date, other: Date) =>
    date.getFullYear() === other.getFullYear() &&
    date.getMonth() === other.getMonth() &&
    date.getDate() === other.getDate();

  const renderDayView = () => (
    <div className="h-full overflow-auto rounded-xl border bg-card p-4">
      <p className="font-medium text-sm uppercase tracking-wide">{dayLabel}</p>
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
        {monthCells.map(({ date, inMonth }) => (
          <div
            key={date.toISOString()}
            className={clsx(
              'h-12 rounded-md border px-1 py-1 text-right text-sm',
              inMonth
                ? 'border-border bg-background'
                : 'border-border/60 bg-muted/20 text-muted-foreground'
            )}
          >
            <span
              className={clsx(isSameDay(date, selectedDate) && 'font-bold')}
            >
              {date.getDate()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderYearView = () => (
    <div className="h-full overflow-auto rounded-xl border bg-card p-4">
      <p className="font-medium text-sm uppercase tracking-wide">
        {currentYear}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {yearData.map(({ monthName, cells }) => (
          <div key={monthName} className="rounded-md border bg-background p-2">
            <p className="mb-1 font-medium text-sm">{monthName}</p>
            <div className="grid grid-cols-7 gap-1">
              {weekDayHeaders.map((day) => (
                <span
                  key={`${monthName}-${day}`}
                  className="text-center text-[10px] text-muted-foreground"
                >
                  {day[0]}
                </span>
              ))}
              {cells.map((cell) => (
                <span
                  key={`${monthName}-${cell.key}`}
                  className={clsx(
                    'text-center text-[10px]',
                    cell.inMonth ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {cell.day || ''}
                </span>
              ))}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">{title}</h2>
        </div>
      </div>

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

          <div className="mt-3 border-t pt-3">
            <label htmlFor="new-calendar" className="sr-only">
              New calendar
            </label>
            <div className="flex items-center gap-2">
              <input
                id="new-calendar"
                type="text"
                value={calendarName}
                onChange={(event) => setCalendarName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCreateCalendar();
                  }
                }}
                placeholder="New calendar"
                className="h-9 w-full rounded-md border bg-background px-2 text-base"
              />
              <button
                type="button"
                onClick={handleCreateCalendar}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-accent"
                aria-label="Create calendar"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium text-base">{activeCalendar}</p>
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
          </div>
          <div className="min-h-0 flex-1">{renderActiveView()}</div>
        </section>
      </div>
    </div>
  );
}
