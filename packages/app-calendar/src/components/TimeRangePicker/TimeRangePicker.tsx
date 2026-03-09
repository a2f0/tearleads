import { useMemo } from 'react';

interface TimeRangePickerProps {
  startTime: string;
  endTime: string;
  onStartTimeChange: (time: string) => void;
  onEndTimeChange: (time: string) => void;
  disabled?: boolean;
}

function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

function formatDuration(minutes: number): string {
  if (minutes < 0) {
    return formatDuration(minutes + 24 * 60);
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

export function TimeRangePicker({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  disabled = false
}: TimeRangePickerProps) {
  const duration = useMemo(() => {
    const start = parseTime(startTime);
    const end = parseTime(endTime);

    if (!start || !end) return null;

    const startMinutes = start.hours * 60 + start.minutes;
    let endMinutes = end.hours * 60 + end.minutes;

    if (endMinutes <= startMinutes) {
      endMinutes += 24 * 60;
    }

    return formatDuration(endMinutes - startMinutes);
  }, [startTime, endTime]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={startTime}
        onChange={(e) => onStartTimeChange(e.target.value)}
        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-base"
        aria-label="Event start time"
        disabled={disabled}
        data-testid="time-range-start"
      />
      <span className="text-muted-foreground text-sm">to</span>
      <input
        type="time"
        value={endTime}
        onChange={(e) => onEndTimeChange(e.target.value)}
        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-base"
        aria-label="Event end time"
        disabled={disabled}
        data-testid="time-range-end"
      />
      {duration && (
        <span
          className="shrink-0 rounded-full bg-muted px-2 py-1 text-muted-foreground text-xs"
          data-testid="time-range-duration"
        >
          {duration}
        </span>
      )}
    </div>
  );
}
