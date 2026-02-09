import {
  CALENDAR_CREATE_EVENT,
  CALENDAR_CREATE_ITEM_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT,
  CalendarContent,
  type CalendarEventItem
} from '@rapid/calendar';
import { CalendarPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { createCalendarEvent, getCalendarEvents } from '@/db/calendar-events';
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
  onFocus: () => void;
  zIndex: number;
  initialDimensions?: WindowDimensions | undefined;
}

export function CalendarWindow({
  id,
  onClose,
  onMinimize,
  onDimensionsChange,
  onFocus,
  zIndex,
  initialDimensions
}: CalendarWindowProps) {
  const { isUnlocked } = useDatabaseContext();
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

  const refreshEvents = useCallback(async () => {
    if (!isUnlocked) {
      setEvents([]);
      return;
    }
    const nextEvents = await getCalendarEvents();
    setEvents(nextEvents);
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

  return (
    <FloatingWindow
      id={id}
      title="Calendar"
      onClose={onClose}
      onMinimize={onMinimize}
      onDimensionsChange={onDimensionsChange}
      onFocus={onFocus}
      zIndex={zIndex}
      {...(initialDimensions && { initialDimensions })}
      defaultWidth={CALENDAR_WINDOW_DEFAULT_WIDTH}
      defaultHeight={CALENDAR_WINDOW_DEFAULT_HEIGHT}
      minWidth={CALENDAR_WINDOW_MIN_WIDTH}
      minHeight={CALENDAR_WINDOW_MIN_HEIGHT}
    >
      <div className="flex h-full flex-col">
        <CalendarWindowMenuBar onClose={onClose} />
        <CalendarContent
          events={events}
          onCreateEvent={handleCreateEvent}
          onSidebarContextMenuRequest={setSidebarContextMenu}
          onViewContextMenuRequest={setViewContextMenu}
        />
      </div>
      {sidebarContextMenu ? (
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
      {viewContextMenu ? (
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
      <NewCalendarDialog
        open={newCalendarDialogOpen}
        onOpenChange={setNewCalendarDialogOpen}
        onCreate={handleCreateCalendarSubmit}
      />
    </FloatingWindow>
  );
}
