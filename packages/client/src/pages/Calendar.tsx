import { CalendarContent } from '@tearleads/app-calendar';
import { BackLink } from '@/components/ui/back-link';

export function Calendar() {
  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center gap-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
      </div>
      <div className="min-h-0 flex-1 rounded-lg border bg-card [border-color:var(--soft-border)]">
        <CalendarContent />
      </div>
    </div>
  );
}
