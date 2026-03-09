import { CalendarContent } from '../components/CalendarContent';

export function Calendar() {
  return (
    <div className="h-full min-h-0 rounded-lg border bg-card [border-color:var(--soft-border)]">
      <CalendarContent />
    </div>
  );
}
