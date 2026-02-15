import { Cake } from 'lucide-react';
import { useCalendarUI } from '../context/CalendarUIContext';
import { CALENDAR_CREATE_EVENT, CALENDAR_CREATE_ITEM_EVENT } from '../events';

interface CalendarWindowMenuBarProps {
  onClose: () => void;
  showBirthdaysFromContacts: boolean;
  onShowBirthdaysFromContactsChange: (show: boolean) => void;
  version: string;
}

export function CalendarWindowMenuBar({
  onClose,
  showBirthdaysFromContacts,
  onShowBirthdaysFromContactsChange,
  version
}: CalendarWindowMenuBarProps) {
  const {
    DropdownMenu,
    DropdownMenuItem,
    WindowOptionsMenuItem,
    AboutMenuItem
  } = useCalendarUI();

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
        <AboutMenuItem
          appName="Calendar"
          version={version}
          closeLabel="Close"
        />
      </DropdownMenu>
    </div>
  );
}
