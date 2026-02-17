import {
  WindowContextMenu,
  WindowContextMenuItem
} from '@tearleads/window-manager';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';
import { calendarLocale } from '../constants';
import {
  CALENDAR_CREATE_ITEM_EVENT,
  CALENDAR_CREATE_SUBMIT_EVENT
} from '../events';
import {
  selectionToTimeRange,
  useTimeRangeSelection
} from '../hooks/useTimeRangeSelection';
import type { CalendarEventItem } from '../types';
import { CalendarActiveView } from './CalendarActiveView';
import { CalendarSidebar } from './CalendarSidebar';
import { CalendarViewControls } from './CalendarViewControls';
import {
  type CreateCalendarEventInput,
  NewCalendarEventModal
} from './NewCalendarEventModal';
import { useCalendarDerivedState } from './useCalendarDerivedState';

const defaultCalendarName = 'Personal';
const defaultCalendars = [defaultCalendarName];
const viewModes = ['Day', 'Week', 'Month', 'Year'] as const;
type CalendarViewMode = (typeof viewModes)[number];

interface CalendarContentProps {
  events?: CalendarEventItem[] | undefined;
  onCreateEvent?:
    | ((input: CreateCalendarEventInput) => Promise<void> | void)
    | undefined;
  onSidebarContextMenuRequest?:
    | ((position: { x: number; y: number }) => void)
    | undefined;
  onViewContextMenuRequest?:
    | ((position: { x: number; y: number; date: Date }) => void)
    | undefined;
}

export type { CalendarEventItem } from '../types';
export type { CreateCalendarEventInput };

export function CalendarContent({
  events = [],
  onCreateEvent,
  onSidebarContextMenuRequest,
  onViewContextMenuRequest
}: CalendarContentProps = {}) {
  const [calendars, setCalendars] = useState<string[]>(defaultCalendars);
  const [activeCalendar, setActiveCalendar] =
    useState<string>(defaultCalendarName);
  const [viewMode, setViewMode] = useState<CalendarViewMode>('Month');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [createEventModalOpen, setCreateEventModalOpen] = useState(false);
  const [createEventModalDate, setCreateEventModalDate] = useState(
    () => new Date()
  );
  const [createEventInitialStartTime, setCreateEventInitialStartTime] =
    useState<string | undefined>(undefined);
  const [createEventInitialEndTime, setCreateEventInitialEndTime] = useState<
    string | undefined
  >(undefined);
  const [calendarContextMenu, setCalendarContextMenu] = useState<{
    x: number;
    y: number;
    name: string;
  } | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<{
    x: number;
    y: number;
    startTime: string;
    endTime: string;
  } | null>(null);

  const normalizedNames = useMemo(
    () => new Set(calendars.map((name) => name.toLowerCase())),
    [calendars]
  );

  const createCalendar = useCallback(
    (name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) return;
      if (normalizedNames.has(trimmedName.toLowerCase())) return;

      setCalendars((prev) => [...prev, trimmedName]);
      setActiveCalendar(trimmedName);
    },
    [normalizedNames]
  );

  const handleCreateCalendarSubmit = useCallback(
    (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { name?: string } | undefined;
      if (!detail?.name) return;
      createCalendar(detail.name);
    },
    [createCalendar]
  );

  useEffect(() => {
    window.addEventListener(
      CALENDAR_CREATE_SUBMIT_EVENT,
      handleCreateCalendarSubmit
    );
    return () => {
      window.removeEventListener(
        CALENDAR_CREATE_SUBMIT_EVENT,
        handleCreateCalendarSubmit
      );
    };
  }, [handleCreateCalendarSubmit]);

  const handleOpenCreateItemModal = useCallback((date: Date) => {
    setSelectedDate(date);
    setCreateEventModalDate(date);
    setCreateEventInitialStartTime(undefined);
    setCreateEventInitialEndTime(undefined);
    setCreateEventModalOpen(true);
  }, []);

  const handleCreateItemRequest = useCallback(
    (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { date?: string } | undefined;
      if (detail?.date) {
        const date = new Date(detail.date);
        if (!Number.isNaN(date.getTime())) {
          handleOpenCreateItemModal(date);
          return;
        }
      }
      handleOpenCreateItemModal(selectedDate);
    },
    [handleOpenCreateItemModal, selectedDate]
  );

  useEffect(() => {
    window.addEventListener(
      CALENDAR_CREATE_ITEM_EVENT,
      handleCreateItemRequest
    );
    return () => {
      window.removeEventListener(
        CALENDAR_CREATE_ITEM_EVENT,
        handleCreateItemRequest
      );
    };
  }, [handleCreateItemRequest]);

  const isSameDay = useCallback(
    (date: Date, other: Date) =>
      date.getFullYear() === other.getFullYear() &&
      date.getMonth() === other.getMonth() &&
      date.getDate() === other.getDate(),
    []
  );

  const getDateKey = useCallback(
    (date: Date) =>
      `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
    []
  );

  const {
    dayLabel,
    monthLabel,
    weekDates,
    monthCells,
    yearData,
    currentYear,
    positionedDayEvents,
    eventCountByDay
  } = useCalendarDerivedState({
    selectedDate,
    events,
    activeCalendar,
    getDateKey
  });

  const {
    selection: timeSelection,
    isSelecting,
    handleSlotMouseDown,
    handleSlotMouseEnter,
    handleSlotClick,
    clearSelection: clearTimeSelection
  } = useTimeRangeSelection({
    enabled: viewMode === 'Day'
  });

  const handleSelectionContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!timeSelection) return;

      event.preventDefault();
      const { startTime, endTime } = selectionToTimeRange(
        timeSelection,
        selectedDate
      );

      const timeFormatOptions: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      };
      setSelectionContextMenu({
        x: event.clientX,
        y: event.clientY,
        startTime: startTime.toLocaleTimeString(
          calendarLocale,
          timeFormatOptions
        ),
        endTime: endTime.toLocaleTimeString(calendarLocale, timeFormatOptions)
      });
    },
    [timeSelection, selectedDate]
  );

  const handleCloseSelectionContextMenu = useCallback(() => {
    setSelectionContextMenu(null);
  }, []);

  const handleCreateEventFromSelection = useCallback(() => {
    if (!selectionContextMenu) return;

    setCreateEventModalDate(selectedDate);
    setCreateEventInitialStartTime(selectionContextMenu.startTime);
    setCreateEventInitialEndTime(selectionContextMenu.endTime);
    setCreateEventModalOpen(true);
    setSelectionContextMenu(null);
    clearTimeSelection();
  }, [selectionContextMenu, selectedDate, clearTimeSelection]);

  const handleViewContextMenuRequest = useCallback(
    (event: ReactMouseEvent<HTMLElement>, date: Date) => {
      event.preventDefault();
      setSelectedDate(date);
      onViewContextMenuRequest?.({
        x: event.clientX,
        y: event.clientY,
        date
      });
    },
    [onViewContextMenuRequest]
  );

  const handleCloseCalendarContextMenu = useCallback(() => {
    setCalendarContextMenu(null);
  }, []);

  const handleCalendarContextMenuRequest = useCallback(
    (event: ReactMouseEvent<HTMLElement>, name: string) => {
      event.preventDefault();
      event.stopPropagation();
      setCalendarContextMenu({
        x: event.clientX,
        y: event.clientY,
        name
      });
    },
    []
  );

  const renameCalendar = useCallback(
    (currentName: string) => {
      const requestedName = window.prompt('Rename calendar', currentName);
      if (requestedName === null) {
        return;
      }

      const trimmedName = requestedName.trim();
      if (!trimmedName) {
        return;
      }

      if (
        trimmedName.toLowerCase() !== currentName.toLowerCase() &&
        normalizedNames.has(trimmedName.toLowerCase())
      ) {
        return;
      }

      setCalendars((previousCalendars) =>
        previousCalendars.map((calendarName) =>
          calendarName === currentName ? trimmedName : calendarName
        )
      );
      setActiveCalendar((previousActiveCalendar) =>
        previousActiveCalendar === currentName
          ? trimmedName
          : previousActiveCalendar
      );
    },
    [normalizedNames]
  );

  const handleRenameCalendar = useCallback(() => {
    if (!calendarContextMenu) {
      return;
    }
    renameCalendar(calendarContextMenu.name);
    setCalendarContextMenu(null);
  }, [calendarContextMenu, renameCalendar]);

  const handleDateSelect = useCallback(
    (date: Date, viewModeTarget: CalendarViewMode) => {
      setSelectedDate(date);
      setViewMode(viewModeTarget);
    },
    []
  );

  const handlePeriodNavigation = useCallback(
    (direction: -1 | 1) => {
      setSelectedDate((previousDate) => {
        const nextDate = new Date(previousDate);

        switch (viewMode) {
          case 'Day':
            nextDate.setDate(previousDate.getDate() + direction);
            break;
          case 'Week':
            nextDate.setDate(previousDate.getDate() + direction * 7);
            break;
          case 'Month':
            nextDate.setMonth(previousDate.getMonth() + direction);
            break;
          case 'Year':
            nextDate.setFullYear(previousDate.getFullYear() + direction);
            break;
        }

        return nextDate;
      });
    },
    [viewMode]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CalendarSidebar
          calendars={calendars}
          activeCalendar={activeCalendar}
          onSelectCalendar={setActiveCalendar}
          onCalendarContextMenu={handleCalendarContextMenuRequest}
          onEmptySpaceContextMenu={(position) => {
            onSidebarContextMenuRequest?.(position);
          }}
        />

        <section className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium text-base">{activeCalendar}</p>
            <CalendarViewControls
              viewModes={viewModes}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onPeriodNavigation={handlePeriodNavigation}
            />
          </div>
          <div className="min-h-0 flex-1">
            <CalendarActiveView
              viewMode={viewMode}
              dayLabel={dayLabel}
              selectedDate={selectedDate}
              positionedDayEvents={positionedDayEvents}
              timeSelection={timeSelection}
              isSelecting={isSelecting}
              onSlotMouseDown={handleSlotMouseDown}
              onSlotMouseEnter={handleSlotMouseEnter}
              onSlotClick={handleSlotClick}
              onSelectionContextMenu={handleSelectionContextMenu}
              onViewContextMenuRequest={handleViewContextMenuRequest}
              onClearSelection={clearTimeSelection}
              weekDates={weekDates}
              eventCountByDay={eventCountByDay}
              getDateKey={getDateKey}
              isSameDay={isSameDay}
              monthLabel={monthLabel}
              monthCells={monthCells}
              onDateSelect={handleDateSelect}
              currentYear={currentYear}
              yearData={yearData}
            />
          </div>
        </section>
      </div>
      <NewCalendarEventModal
        open={createEventModalOpen}
        onOpenChange={setCreateEventModalOpen}
        calendarName={activeCalendar}
        selectedDate={createEventModalDate}
        initialStartTime={createEventInitialStartTime}
        initialEndTime={createEventInitialEndTime}
        onCreateEvent={onCreateEvent}
      />
      {calendarContextMenu ? (
        <WindowContextMenu
          x={calendarContextMenu.x}
          y={calendarContextMenu.y}
          onClose={handleCloseCalendarContextMenu}
          menuTestId="calendar-sidebar-item-context-menu"
          backdropTestId="calendar-sidebar-item-context-menu-backdrop"
        >
          <WindowContextMenuItem
            onClick={handleRenameCalendar}
            data-testid="calendar-sidebar-item-rename"
          >
            Rename Calendar
          </WindowContextMenuItem>
        </WindowContextMenu>
      ) : null}
      {selectionContextMenu ? (
        <WindowContextMenu
          x={selectionContextMenu.x}
          y={selectionContextMenu.y}
          onClose={handleCloseSelectionContextMenu}
          menuTestId="calendar-selection-context-menu"
          backdropTestId="calendar-selection-context-menu-backdrop"
        >
          <WindowContextMenuItem
            onClick={handleCreateEventFromSelection}
            data-testid="calendar-create-event-from-selection"
          >
            Create Event ({selectionContextMenu.startTime} -{' '}
            {selectionContextMenu.endTime})
          </WindowContextMenuItem>
        </WindowContextMenu>
      ) : null}
    </div>
  );
}
