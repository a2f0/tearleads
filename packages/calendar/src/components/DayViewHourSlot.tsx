import { clsx } from 'clsx';
import { useCallback } from 'react';
import type { TimeSlot } from '../hooks/useTimeRangeSelection';

interface DayViewHourSlotProps {
  hour: number;
  isWorkHour: boolean;
  quarterSelections: [boolean, boolean, boolean, boolean];
  isSelecting: boolean;
  onMouseDown: (slot: TimeSlot, event: React.MouseEvent) => void;
  onMouseEnter: (slot: TimeSlot) => void;
  onClick: (slot: TimeSlot, event: React.MouseEvent) => void;
}

const quarterLabels = [':00', ':15', ':30', ':45'] as const;

export function DayViewHourSlot({
  hour,
  isWorkHour,
  quarterSelections,
  isSelecting,
  onMouseDown,
  onMouseEnter,
  onClick
}: DayViewHourSlotProps) {
  const createSlot = useCallback(
    (quarter: 0 | 1 | 2 | 3): TimeSlot => ({ hour, quarter }),
    [hour]
  );

  const handleQuarterMouseDown = useCallback(
    (quarter: 0 | 1 | 2 | 3, event: React.MouseEvent) => {
      onMouseDown(createSlot(quarter), event);
    },
    [createSlot, onMouseDown]
  );

  const handleQuarterMouseEnter = useCallback(
    (quarter: 0 | 1 | 2 | 3) => {
      onMouseEnter(createSlot(quarter));
    },
    [createSlot, onMouseEnter]
  );

  const handleQuarterClick = useCallback(
    (quarter: 0 | 1 | 2 | 3, event: React.MouseEvent) => {
      onClick(createSlot(quarter), event);
    },
    [createSlot, onClick]
  );

  return (
    <div
      className="flex items-stretch border-border border-b"
      data-testid={`hour-slot-${hour}`}
    >
      <span className="flex w-14 shrink-0 items-center font-medium text-muted-foreground text-sm">
        {hour.toString().padStart(2, '0')}:00
      </span>
      <div className="flex flex-1 flex-col">
        {([0, 1, 2, 3] as const).map((quarter) => {
          const isSelected = quarterSelections[quarter];
          return (
            <button
              key={quarter}
              type="button"
              data-interactive-slot
              data-testid={`hour-slot-${hour}-q${quarter}`}
              aria-label={`${hour.toString().padStart(2, '0')}${quarterLabels[quarter]}`}
              className={clsx(
                'h-2 w-full transition-colors',
                isWorkHour ? 'bg-accent/35' : 'bg-muted/40',
                isSelected && 'bg-primary/25',
                isSelecting && isSelected && 'bg-primary/35',
                quarter < 3 && 'border-border border-b border-dashed',
                'hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-inset'
              )}
              onMouseDown={(e) => handleQuarterMouseDown(quarter, e)}
              onMouseEnter={() => handleQuarterMouseEnter(quarter)}
              onClick={(e) => handleQuarterClick(quarter, e)}
            />
          );
        })}
      </div>
    </div>
  );
}
