import type { MouseEvent as ReactMouseEvent } from 'react';
import { CalendarDayView } from './CalendarDayView';
import { CalendarMonthView } from './CalendarMonthView';
import { CalendarWeekView } from './CalendarWeekView';
import { CalendarYearView } from './CalendarYearView';
import type { TimeRangeSelection, TimeSlot } from '../hooks/useTimeRangeSelection';
import type { PositionedEvent } from '../utils/eventPositioning';

interface CalendarActiveViewProps {
  viewMode: 'Day' | 'Week' | 'Month' | 'Year';
  dayLabel: string;
  selectedDate: Date;
  positionedDayEvents: PositionedEvent[];
  timeSelection: TimeRangeSelection | null;
  isSelecting: boolean;
  onSlotMouseDown: (slot: TimeSlot, event: ReactMouseEvent) => void;
  onSlotMouseEnter: (slot: TimeSlot) => void;
  onSlotClick: (slot: TimeSlot, event: ReactMouseEvent) => void;
  onSelectionContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onViewContextMenuRequest: (
    event: ReactMouseEvent<HTMLElement>,
    date: Date
  ) => void;
  onClearSelection: () => void;
  weekDates: Date[];
  eventCountByDay: Map<string, number>;
  getDateKey: (date: Date) => string;
  isSameDay: (date: Date, other: Date) => boolean;
  monthLabel: string;
  monthCells: Array<{ date: Date; inMonth: boolean }>;
  onDateSelect: (date: Date, viewMode: 'Day' | 'Month') => void;
  currentYear: number;
  yearData: Array<{
    monthName: string;
    cells: Array<{ day: number; inMonth: boolean; key: string }>;
  }>;
}

export function CalendarActiveView({
  viewMode,
  dayLabel,
  selectedDate,
  positionedDayEvents,
  timeSelection,
  isSelecting,
  onSlotMouseDown,
  onSlotMouseEnter,
  onSlotClick,
  onSelectionContextMenu,
  onViewContextMenuRequest,
  onClearSelection,
  weekDates,
  eventCountByDay,
  getDateKey,
  isSameDay,
  monthLabel,
  monthCells,
  onDateSelect,
  currentYear,
  yearData
}: CalendarActiveViewProps) {
  switch (viewMode) {
    case 'Day':
      return (
        <CalendarDayView
          dayLabel={dayLabel}
          selectedDate={selectedDate}
          positionedDayEvents={positionedDayEvents}
          timeSelection={timeSelection}
          isSelecting={isSelecting}
          onSlotMouseDown={onSlotMouseDown}
          onSlotMouseEnter={onSlotMouseEnter}
          onSlotClick={onSlotClick}
          onSelectionContextMenu={onSelectionContextMenu}
          onViewContextMenuRequest={onViewContextMenuRequest}
          onClearSelection={onClearSelection}
        />
      );
    case 'Week':
      return (
        <CalendarWeekView
          weekDates={weekDates}
          selectedDate={selectedDate}
          eventCountByDay={eventCountByDay}
          getDateKey={getDateKey}
          isSameDay={isSameDay}
          onContextMenuRequest={onViewContextMenuRequest}
        />
      );
    case 'Month':
      return (
        <CalendarMonthView
          monthLabel={monthLabel}
          monthCells={monthCells}
          selectedDate={selectedDate}
          eventCountByDay={eventCountByDay}
          getDateKey={getDateKey}
          isSameDay={isSameDay}
          onDateSelect={onDateSelect}
          onContextMenuRequest={onViewContextMenuRequest}
        />
      );
    case 'Year':
      return (
        <CalendarYearView
          currentYear={currentYear}
          selectedDate={selectedDate}
          yearData={yearData}
          onDateSelect={onDateSelect}
          onContextMenuRequest={onViewContextMenuRequest}
        />
      );
  }
}
