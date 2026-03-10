import { CalendarContent } from '@tearleads/app-calendar';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import { BackLink } from '@/components/ui/back-link';

export function Calendar() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded p-1 hover:bg-accent md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Toggle calendars sidebar"
          data-testid="calendar-sidebar-toggle"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
      </div>
      <div className="min-h-0 flex-1 rounded-lg border bg-card [border-color:var(--soft-border)]">
        <CalendarContent
          sidebarOpen={sidebarOpen}
          onSidebarOpenChange={setSidebarOpen}
        />
      </div>
    </div>
  );
}
