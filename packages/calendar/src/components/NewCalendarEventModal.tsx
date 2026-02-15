import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import type { CreateCalendarEventInput } from '../types';
import { RecurrenceEditor } from './RecurrenceEditor';
import { TimeRangePicker } from './TimeRangePicker';

export type { CreateCalendarEventInput };

interface NewCalendarEventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendarName: string;
  selectedDate: Date;
  initialStartTime?: string | undefined;
  initialEndTime?: string | undefined;
  onCreateEvent?:
    | ((input: CreateCalendarEventInput) => Promise<void> | void)
    | undefined;
}

const DEFAULT_EVENT_START_TIME = '09:00';
const DEFAULT_EVENT_END_TIME = '10:00';

function addHourToTime(time: string): string {
  const [hoursPart, minutesPart] = time.split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return DEFAULT_EVENT_END_TIME;
  }

  const newHours = (hours + 1) % 24;
  return `${newHours.toString().padStart(2, '0')}:${minutesPart}`;
}

export function NewCalendarEventModal({
  open,
  onOpenChange,
  calendarName,
  selectedDate,
  initialStartTime,
  initialEndTime,
  onCreateEvent
}: NewCalendarEventModalProps) {
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState(DEFAULT_EVENT_START_TIME);
  const [endTime, setEndTime] = useState(DEFAULT_EVENT_END_TIME);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setTitle('');
    setStartTime(initialStartTime ?? DEFAULT_EVENT_START_TIME);
    setEndTime(
      initialEndTime ??
        addHourToTime(initialStartTime ?? DEFAULT_EVENT_START_TIME)
    );
    setRepeatEnabled(false);
    setRecurrenceRule(null);
  }, [open, initialStartTime, initialEndTime]);

  const handleCreate = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !onCreateEvent || creatingEvent) {
      return;
    }

    const [startHoursPart, startMinutesPart] = startTime.split(':');
    const startHours = Number(startHoursPart);
    const startMinutes = Number(startMinutesPart);

    const [endHoursPart, endMinutesPart] = endTime.split(':');
    const endHours = Number(endHoursPart);
    const endMinutes = Number(endMinutesPart);

    if (
      !Number.isFinite(startHours) ||
      !Number.isFinite(startMinutes) ||
      !Number.isFinite(endHours) ||
      !Number.isFinite(endMinutes)
    ) {
      return;
    }

    const startAt = new Date(selectedDate);
    startAt.setHours(startHours, startMinutes, 0, 0);

    const endAt = new Date(selectedDate);
    endAt.setHours(endHours, endMinutes, 0, 0);

    if (endAt <= startAt) {
      endAt.setDate(endAt.getDate() + 1);
    }

    try {
      setCreatingEvent(true);
      await onCreateEvent({
        calendarName,
        title: trimmedTitle,
        startAt,
        endAt,
        recurrence:
          repeatEnabled && recurrenceRule ? { rrule: recurrenceRule } : null
      });
      onOpenChange(false);
    } finally {
      setCreatingEvent(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close new event dialog"
        className="absolute inset-0 bg-black/45"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-calendar-event-title"
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-4 shadow-xl"
      >
        <h2 id="new-calendar-event-title" className="font-semibold text-base">
          New Calendar Item
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">{calendarName}</p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Event title"
            className="w-full rounded-md border bg-background px-3 py-2 text-base"
            aria-label="Event title"
          />

          <TimeRangePicker
            startTime={startTime}
            endTime={endTime}
            onStartTimeChange={setStartTime}
            onEndTimeChange={setEndTime}
          />

          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(e) => setRepeatEnabled(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="font-medium text-sm">Repeat</span>
            </label>

            {repeatEnabled && (
              <div className="rounded-md border bg-muted/20 p-3">
                <RecurrenceEditor
                  value={recurrenceRule}
                  onChange={setRecurrenceRule}
                  startDate={selectedDate}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 font-medium text-sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || creatingEvent || !onCreateEvent}
              className={clsx(
                'rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm',
                'disabled:cursor-not-allowed disabled:opacity-60'
              )}
            >
              Add Event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
