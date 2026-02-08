import { CALENDAR_CREATE_EVENT } from '@rapid/calendar';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface CalendarWindowMenuBarProps {
  onClose: () => void;
}

export function CalendarWindowMenuBar({ onClose }: CalendarWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          onClick={() => window.dispatchEvent(new Event(CALENDAR_CREATE_EVENT))}
        >
          New Calendar
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Calendar" closeLabel="Close" />
      </DropdownMenu>
    </div>
  );
}
