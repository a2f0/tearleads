import type { MouseEvent as ReactMouseEvent } from 'react';
import type {
  TimeRangeSelection,
  TimeSlot
} from '../hooks/useTimeRangeSelection';
import { isSlotInSelection } from '../hooks/useTimeRangeSelection';
import type { PositionedEvent } from '../utils/eventPositioning';
import { DayViewEventBlock } from './DayViewEventBlock';
import { DayViewHourSlot } from './DayViewHourSlot';

const dayViewHours = Array.from({ length: 24 }, (_, hour) => hour);
const workHourStart = 9;
const workHourEnd = 17;

interface CalendarDayViewProps {
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
}

export function CalendarDayView({
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
  onClearSelection
}: CalendarDayViewProps) {
  const getQuarterSelections = (
    hour: number
  ): [boolean, boolean, boolean, boolean] => [
    isSlotInSelection({ hour, quarter: 0 }, timeSelection),
    isSlotInSelection({ hour, quarter: 1 }, timeSelection),
    isSlotInSelection({ hour, quarter: 2 }, timeSelection),
    isSlotInSelection({ hour, quarter: 3 }, timeSelection)
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: container with child interactive elements
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard navigation handled by child hour slots
    <div
      className="h-full overflow-auto rounded-xl border bg-card p-4 [border-color:var(--soft-border)]"
      data-testid="calendar-day-view"
      onContextMenu={(event) => {
        if (timeSelection) {
          onSelectionContextMenu(event);
        } else {
          onViewContextMenuRequest(event, selectedDate);
        }
      }}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('[data-interactive-slot]')) {
          onClearSelection();
        }
      }}
    >
      <p className="font-medium text-sm uppercase tracking-wide">{dayLabel}</p>
      <div className="relative mt-4">
        <div>
          {dayViewHours.map((hour) => {
            const isWorkHour = hour >= workHourStart && hour < workHourEnd;
            return (
              <DayViewHourSlot
                key={hour}
                hour={hour}
                isWorkHour={isWorkHour}
                quarterSelections={getQuarterSelections(hour)}
                isSelecting={isSelecting}
                onMouseDown={onSlotMouseDown}
                onMouseEnter={onSlotMouseEnter}
                onClick={onSlotClick}
              />
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-0 ml-14">
          {positionedDayEvents.map((positioned) => (
            <DayViewEventBlock
              key={positioned.event.id}
              event={positioned.event}
              top={positioned.top}
              height={positioned.height}
              left={positioned.left}
              width={positioned.width}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
