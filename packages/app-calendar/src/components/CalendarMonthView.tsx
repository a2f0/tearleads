import { clsx } from 'clsx';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { calendarLocale, weekDayHeaders } from '../constants';

interface MonthCell {
  date: Date;
  inMonth: boolean;
}

interface CalendarMonthViewProps {
  monthLabel: string;
  monthCells: MonthCell[];
  selectedDate: Date;
  eventCountByDay: Map<string, number>;
  getDateKey: (date: Date) => string;
  isSameDay: (date: Date, other: Date) => boolean;
  onDateSelect: (date: Date, viewMode: 'Day') => void;
  onContextMenuRequest: (
    event: ReactMouseEvent<HTMLElement>,
    date: Date
  ) => void;
}

export function CalendarMonthView({
  monthLabel,
  monthCells,
  selectedDate,
  eventCountByDay,
  getDateKey,
  isSameDay,
  onDateSelect,
  onContextMenuRequest
}: CalendarMonthViewProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu surface
    <div
      className="h-full overflow-auto rounded-xl border bg-card p-4 [border-color:var(--soft-border)]"
      data-testid="calendar-month-view"
      onContextMenu={(event) => onContextMenuRequest(event, selectedDate)}
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
                onDateSelect(date, 'Day');
              }}
              onContextMenu={(event) => {
                event.stopPropagation();
                onContextMenuRequest(event, date);
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
                  ? 'bg-background [border-color:var(--soft-border)]'
                  : 'bg-muted/20 text-muted-foreground [border-color:var(--soft-border)]',
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
}
