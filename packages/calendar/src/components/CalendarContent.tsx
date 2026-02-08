import { clsx } from 'clsx';
import { CalendarPlus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

const defaultCalendars = ['Personal'];

export interface CalendarContentProps {
  title?: string;
}

export function CalendarContent({ title = 'Calendar' }: CalendarContentProps) {
  const [calendarName, setCalendarName] = useState('');
  const [calendars, setCalendars] = useState<string[]>(defaultCalendars);
  const [activeCalendar, setActiveCalendar] = useState(defaultCalendars[0]);

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

        <section className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-xl border bg-card p-6 text-center">
            <p className="font-medium text-lg">{activeCalendar}</p>
            <p className="mt-2 text-muted-foreground text-sm">
              Month and events view coming next.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
