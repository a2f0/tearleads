import { clsx } from 'clsx';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { calendarLocale, weekDayHeaders } from '../constants';

interface YearCell {
  day: number;
  inMonth: boolean;
  key: string;
}

interface YearMonth {
  monthName: string;
  cells: YearCell[];
}

interface CalendarYearViewProps {
  currentYear: number;
  selectedDate: Date;
  yearData: YearMonth[];
  onDateSelect: (date: Date, viewMode: 'Day' | 'Month') => void;
  onContextMenuRequest: (
    event: ReactMouseEvent<HTMLElement>,
    date: Date
  ) => void;
}

export function CalendarYearView({
  currentYear,
  selectedDate,
  yearData,
  onDateSelect,
  onContextMenuRequest
}: CalendarYearViewProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click context menu surface
    <div
      className="h-full overflow-auto rounded-xl border bg-card p-4 [border-color:var(--soft-border)]"
      data-testid="calendar-year-view"
      onContextMenu={(event) => onContextMenuRequest(event, selectedDate)}
    >
      <p className="font-medium text-sm uppercase tracking-wide">
        {currentYear}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {yearData.map(({ monthName, cells }, monthIndex) => (
          <div
            key={monthName}
            className="rounded-md border bg-background p-2 [border-color:var(--soft-border)]"
          >
            <button
              type="button"
              onClick={() => {
                onDateSelect(new Date(currentYear, monthIndex, 1), 'Month');
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
                      onDateSelect(monthDate, 'Day');
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
                      onContextMenuRequest(event, monthDate);
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
}
