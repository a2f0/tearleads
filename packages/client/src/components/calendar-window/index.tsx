import {
  CALENDAR_CREATE_EVENT,
  CALENDAR_CREATE_ITEM_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT,
  CalendarContent,
  type CalendarEventItem
} from '@tearleads/calendar';
import { WindowControlBar } from '@tearleads/window-manager';
import { CalendarPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DesktopFloatingWindow as FloatingWindow,
  type WindowDimensions
} from '@tearleads/window-manager';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import {
  DesktopContextMenu as ContextMenu,
  DesktopContextMenuItem as ContextMenuItem
} from '@tearleads/window-manager';
import {
  createCalendarEvent,
  getCalendarEvents,
  getContactBirthdayEvents
} from '@/db/calendar-events';
import { useDatabaseContext } from '@/db/hooks';
import { CalendarWindowMenuBar } from './CalendarWindowMenuBar';
import { NewCalendarDialog } from './NewCalendarDialog';

const CALENDAR_WINDOW_DEFAULT_WIDTH = 900;
const CALENDAR_WINDOW_DEFAULT_HEIGHT = 640;
const CALENDAR_WINDOW_MIN_WIDTH = 680;
const CALENDAR_WINDOW_MIN_HEIGHT = 420;

interface CalendarWindowProps {
  id: string;
  onClose: () => void;
  onMinimize: (dimensions: WindowDimensions) => void;
  onDimensionsChange?: ((dimensions: WindowDimensions) => void) | undefined;
  onRename?: ((title: string) => void) | undefined;
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function CalendarWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onRename,
  onFocus,
  zIndex,
  initialDimensions
}: CalendarWindowProps) {
  const { isUnlocked, isLoading: isDatabaseLoading } = useDatabaseContext();
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [viewContextMenu, setViewContextMenu] = useState<{
    x: number;
    y: number;
    date: Date;
  } | null>(null);
  const [newCalendarDialogOpen, setNewCalendarDialogOpen] = useState(false);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [birthdayEvents, setBirthdayEvents] = useState<CalendarEventItem[]>([]);
  const [showBirthdaysFromContacts, setShowBirthdaysFromContacts] =
    useState(true);

  const refreshEvents = useCallback(async () => {
    if (!isUnlocked) {
      setEvents([]);
      setBirthdayEvents([]);
      return;
    }

    const [nextEvents, nextBirthdayEvents] = await Promise.all([
      getCalendarEvents(),
      getContactBirthdayEvents()
    ]);

    setEvents(nextEvents);
    setBirthdayEvents(nextBirthdayEvents);
  }, [isUnlocked]);

  useEffect(() => {
    void refreshEvents();
  }, [refreshEvents]);

  useEffect(() => {
    const handleCreateRequest = () => {
      setNewCalendarDialogOpen(true);
    };

    window.addEventListener(CALENDAR_CREATE_EVENT, handleCreateRequest);
    return () => {
      window.removeEventListener(CALENDAR_CREATE_EVENT, handleCreateRequest);
    };
  }, []);

  const handleCloseSidebarContextMenu = useCallback(() => {
    setSidebarContextMenu(null);
  }, []);

  const handleCloseViewContextMenu = useCallback(() => {
    setViewContextMenu(null);
  }, []);

  const handleCreateCalendar = useCallback(() => {
    setNewCalendarDialogOpen(true);
    setSidebarContextMenu(null);
  }, []);

  const handleCreateItem = useCallback(() => {
    if (!viewContextMenu) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(CALENDAR_CREATE_ITEM_EVENT, {
        detail: { date: viewContextMenu.date.toISOString() }
      })
    );
    setViewContextMenu(null);
  }, [viewContextMenu]);

  const handleCreateCalendarSubmit = useCallback((name: string) => {
    window.dispatchEvent(
      new CustomEvent(CALENDAR_CREATE_SUBMIT_EVENT, {
        detail: { name }
      })
    );
  }, []);

  const handleCreateEvent = useCallback(
    async (input: {
      calendarName: string;
      title: string;
      startAt: Date;
      endAt?: Date | null | undefined;
    }) => {
      await createCalendarEvent(input);
      await refreshEvents();
    },
    [refreshEvents]
  );

  const visibleEvents = useMemo(
    () =>
      showBirthdaysFromContacts ? [...events, ...birthdayEvents] : [...events],
    [birthdayEvents, events, showBirthdaysFromContacts]
  );

  return (
    <FloatingWindow
      id={id}
      title="Calendar"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onRename={onRename}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={CALENDAR_WINDOW_DEFAULT_WIDTH}
      defaultHeight={CALENDAR_WINDOW_DEFAULT_HEIGHT}
      minWidth={CALENDAR_WINDOW_MIN_WIDTH}
      minHeight={CALENDAR_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full flex-col">
        <CalendarWindowMenuBar
          onClose={onClose}
          showBirthdaysFromContacts={showBirthdaysFromContacts}
          onShowBirthdaysFromContactsChange={setShowBirthdaysFromContacts}
        />
        <WindowControlBar>{null}</WindowControlBar>
        {isDatabaseLoading ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border p-8 text-center text-muted-foreground">
            Loading database...
          </div>
        ) : !isUnlocked ? (
          <div className="flex flex-1 items-center justify-center p-4">
            <InlineUnlock description="calendar events" />
          </div>
        ) : (
          <CalendarContent
            events={visibleEvents}
            onCreateEvent={handleCreateEvent}
            onSidebarContextMenuRequest={setSidebarContextMenu}
            onViewContextMenuRequest={setViewContextMenu}
          />
        )}
      </div>
      {isUnlocked && sidebarContextMenu ? (
        <ContextMenu
          x={sidebarContextMenu.x}
          y={sidebarContextMenu.y}
          onClose={handleCloseSidebarContextMenu}
        >
          <ContextMenuItem
            icon={<CalendarPlus className="h-4 w-4" />}
            onClick={handleCreateCalendar}
          >
            New Calendar
          </ContextMenuItem>
        </ContextMenu>
      ) : null}
      {isUnlocked && viewContextMenu ? (
        <ContextMenu
          x={viewContextMenu.x}
          y={viewContextMenu.y}
          onClose={handleCloseViewContextMenu}
        >
          <ContextMenuItem
            icon={<CalendarPlus className="h-4 w-4" />}
            onClick={handleCreateItem}
          >
            New Item
          </ContextMenuItem>
        </ContextMenu>
      ) : null}
      {isUnlocked && (
        <NewCalendarDialog
          open={newCalendarDialogOpen}
          onOpenChange={setNewCalendarDialogOpen}
          onCreate={handleCreateCalendarSubmit}
        />
      )}
    </FloatingWindow>
  );
}
