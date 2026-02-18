import {
  WindowSidebarHeader,
  WindowSidebarItem
} from '@tearleads/window-manager';
import { Plus } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { CALENDAR_CREATE_EVENT } from '../events';

interface CalendarSidebarProps {
  calendars: string[];
  activeCalendar: string;
  onSelectCalendar: (name: string) => void;
  onCalendarContextMenu: (
    event: ReactMouseEvent<Element>,
    name: string
  ) => void;
  onEmptySpaceContextMenu: (position: { x: number; y: number }) => void;
}

export function CalendarSidebar({
  calendars,
  activeCalendar,
  onSelectCalendar,
  onCalendarContextMenu,
  onEmptySpaceContextMenu
}: CalendarSidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20 [border-color:var(--soft-border)]">
      <WindowSidebarHeader
        title="My Calendars"
        actionLabel="New Calendar"
        onAction={() => {
          window.dispatchEvent(new CustomEvent(CALENDAR_CREATE_EVENT));
        }}
        actionIcon={<Plus className="h-4 w-4" />}
      />
      <div className="space-y-1 overflow-y-auto p-3">
        {calendars.map((name) => (
          <WindowSidebarItem
            key={name}
            label={name}
            icon={<span className="h-4 w-4" aria-hidden="true" />}
            selected={name === activeCalendar}
            onClick={() => onSelectCalendar(name)}
            onContextMenu={(event) => onCalendarContextMenu(event, name)}
          />
        ))}
      </div>
      <button
        type="button"
        className="mt-2 flex-1"
        data-testid="calendar-sidebar-empty-space"
        onContextMenu={(event) => {
          event.preventDefault();
          onEmptySpaceContextMenu({ x: event.clientX, y: event.clientY });
        }}
        aria-label="Calendar sidebar empty space"
      />
    </aside>
  );
}
