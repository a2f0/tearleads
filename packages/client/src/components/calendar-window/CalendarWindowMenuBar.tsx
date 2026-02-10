import { CALENDAR_CREATE_EVENT, CALENDAR_CREATE_ITEM_EVENT } from '@rapid/calendar';
import { Cake } from 'lucide-react';
import { DropdownMenu, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';

interface CalendarWindowMenuBarProps {
  onClose: () => void;
  showBirthdaysFromContacts: boolean;
  onShowBirthdaysFromContactsChange: (show: boolean) => void;
}

export function CalendarWindowMenuBar({
  onClose,
  showBirthdaysFromContacts,
  onShowBirthdaysFromContactsChange
}: CalendarWindowMenuBarProps) {
  return (
    <div className="flex shrink-0 border-b bg-muted/30 px-1">
      <DropdownMenu trigger="File">
        <DropdownMenuItem
          onClick={() => window.dispatchEvent(new Event(CALENDAR_CREATE_EVENT))}
        >
          New Calendar
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            window.dispatchEvent(new CustomEvent(CALENDAR_CREATE_ITEM_EVENT))
          }
        >
          New Item
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onClose}>Close</DropdownMenuItem>
      </DropdownMenu>
      <DropdownMenu trigger="View">
        <DropdownMenuItem
          onClick={() =>
            onShowBirthdaysFromContactsChange(!showBirthdaysFromContacts)
          }
          checked={showBirthdaysFromContacts}
          icon={<Cake className="h-3 w-3" />}
        >
          Show Contact Birthdays
        </DropdownMenuItem>
        <WindowOptionsMenuItem />
      </DropdownMenu>
      <DropdownMenu trigger="Help">
        <AboutMenuItem appName="Calendar" closeLabel="Close" />
      </DropdownMenu>
    </div>
  );
}
