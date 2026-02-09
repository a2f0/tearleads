import { useEffect, useState } from 'react';

interface NewCalendarEventModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendarName: string;
  selectedDate: Date;
  onCreateEvent?:
    | ((input: {
        calendarName: string;
        title: string;
        startAt: Date;
        endAt?: Date | null | undefined;
      }) => Promise<void> | void)
    | undefined;
}

const DEFAULT_EVENT_TIME = '09:00';
const DEFAULT_EVENT_DURATION_MINUTES = '60';

export function NewCalendarEventModal({
  open,
  onOpenChange,
  calendarName,
  selectedDate,
  onCreateEvent
}: NewCalendarEventModalProps) {
  const [title, setTitle] = useState('');
  const [eventTime, setEventTime] = useState(DEFAULT_EVENT_TIME);
  const [durationMinutes, setDurationMinutes] = useState(
    DEFAULT_EVENT_DURATION_MINUTES
  );
  const [creatingEvent, setCreatingEvent] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setTitle('');
    setEventTime(DEFAULT_EVENT_TIME);
    setDurationMinutes(DEFAULT_EVENT_DURATION_MINUTES);
  }, [open]);

  const handleCreate = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !onCreateEvent || creatingEvent) {
      return;
    }

    const [hoursPart, minutesPart] = eventTime.split(':');
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);
    const parsedDurationMinutes = Number(durationMinutes);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return;
    }
    if (!Number.isFinite(parsedDurationMinutes) || parsedDurationMinutes <= 0) {
      return;
    }

    const startAt = new Date(selectedDate);
    startAt.setHours(hours, minutes, 0, 0);

    const endAt = new Date(startAt);
    endAt.setMinutes(endAt.getMinutes() + parsedDurationMinutes);

    try {
      setCreatingEvent(true);
      await onCreateEvent({
        calendarName,
        title: trimmedTitle,
        startAt,
        endAt
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
        className="relative z-10 w-full max-w-md rounded-lg border bg-card p-4 shadow-xl"
      >
        <h2 id="new-calendar-event-title" className="font-semibold text-base">
          New Calendar Item
        </h2>
        <p className="mt-1 text-muted-foreground text-sm">{calendarName}</p>
        <form
          className="mt-4 space-y-3"
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              type="time"
              value={eventTime}
              onChange={(event) => setEventTime(event.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-base"
              aria-label="Event start time"
            />
            <input
              type="number"
              min={1}
              step={1}
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-base"
              aria-label="Event duration in minutes"
            />
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
              className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              Add Event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
