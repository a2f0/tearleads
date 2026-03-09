import { clsx } from 'clsx';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { calendarLocale } from '../constants';

interface CalendarWeekViewProps {
  weekDates: Date[];
  selectedDate: Date;
  eventCountByDay: Map<string, number>;
  getDateKey: (date: Date) => string;
  isSameDay: (date: Date, other: Date) => boolean;
  onContextMenuRequest: (
    event: ReactMouseEvent<HTMLElement>,
    date: Date
  ) => void;
}

export function CalendarWeekView({
  weekDates,
  selectedDate,
  eventCountByDay,
  getDateKey,
  isSameDay,
  onContextMenuRequest
}: CalendarWeekViewProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu surface
    <div
      className="h-full overflow-auto rounded-xl border bg-card p-4 [border-color:var(--soft-border)]"
      data-testid="calendar-week-view"
      onContextMenu={(event) => onContextMenuRequest(event, selectedDate)}
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
              'rounded-md border p-2 text-center [border-color:var(--soft-border)]',
              isSameDay(date, selectedDate) && 'border-primary bg-primary/10'
            )}
            onContextMenu={(event) => {
              event.stopPropagation();
              onContextMenuRequest(event, date);
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
}
