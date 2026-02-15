import { clsx } from 'clsx';
import type { CalendarEventItem } from './CalendarContent';

interface DayViewEventBlockProps {
  event: CalendarEventItem;
  top: number;
  height: number;
  left: string;
  width: string;
  isRecurring?: boolean;
  onClick?: () => void;
}

const calendarLocale = 'en-US';

function formatTime(date: Date): string {
  return date.toLocaleTimeString(calendarLocale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function DayViewEventBlock({
  event,
  top,
  height,
  left,
  width,
  isRecurring = false,
  onClick
}: DayViewEventBlockProps) {
  const showTimeRange = height >= 24;

  return (
    <button
      type="button"
      data-testid="event-block"
      className={clsx(
        'absolute overflow-hidden rounded-md border border-primary/30 bg-primary/90 px-2 py-1 text-left text-primary-foreground shadow-sm',
        'pointer-events-auto cursor-pointer transition-colors',
        'hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
      )}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left,
        width
      }}
      onClick={onClick}
      aria-label={`Event: ${event.title}`}
    >
      <p className="truncate font-medium text-xs leading-tight">
        {isRecurring && <span className="mr-1">↻</span>}
        {event.title}
      </p>
      {showTimeRange && (
        <p className="truncate text-[10px] leading-tight opacity-80">
          {formatTime(event.startAt)}
          {event.endAt ? ` - ${formatTime(event.endAt)}` : ''}
        </p>
      )}
    </button>
  );
}
