import {
  CALENDAR_CREATE_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT,
  CalendarContent
} from '@rapid/calendar';
import { CalendarPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { WindowDimensions } from '@/components/floating-window';
import { FloatingWindow } from '@/components/floating-window';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
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
  const [sidebarContextMenu, setSidebarContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [newCalendarDialogOpen, setNewCalendarDialogOpen] = useState(false);

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

  const handleCreateCalendar = useCallback(() => {
    setNewCalendarDialogOpen(true);
    setSidebarContextMenu(null);
  }, []);

  const handleCreateCalendarSubmit = useCallback((name: string) => {
    window.dispatchEvent(
      new CustomEvent(CALENDAR_CREATE_SUBMIT_EVENT, {
        detail: { name }
      })
    );
  }, []);

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
          onSidebarContextMenuRequest={(position) => {
            setSidebarContextMenu(position);
          }}
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
      <NewCalendarDialog
        open={newCalendarDialogOpen}
        onOpenChange={setNewCalendarDialogOpen}
        onCreate={handleCreateCalendarSubmit}
      />
    </FloatingWindow>
  );
}
