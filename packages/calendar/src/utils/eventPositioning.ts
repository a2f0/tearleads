import type { CalendarEventItem } from '../types';

export interface PositionedEvent {
  event: CalendarEventItem;
  top: number;
  height: number;
  left: string;
  width: string;
  column: number;
  totalColumns: number;
}

interface EventColumn {
  events: CalendarEventItem[];
}

const PIXELS_PER_HOUR = 32;
const PIXELS_PER_MINUTE = PIXELS_PER_HOUR / 60;
const MIN_EVENT_HEIGHT_MINUTES = 15;

function getEventMinutes(
  event: CalendarEventItem,
  selectedDate: Date
): { startMinutes: number; endMinutes: number } {
  const startOfDay = new Date(selectedDate);
  startOfDay.setHours(0, 0, 0, 0);

  let startMinutes: number;
  let endMinutes: number;

  if (event.startAt < startOfDay) {
    startMinutes = 0;
  } else {
    startMinutes = event.startAt.getHours() * 60 + event.startAt.getMinutes();
  }

  if (event.endAt) {
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    if (event.endAt > endOfDay) {
      endMinutes = 24 * 60;
    } else {
      endMinutes = event.endAt.getHours() * 60 + event.endAt.getMinutes();
    }
  } else {
    endMinutes = startMinutes + 60;
  }

  endMinutes = Math.max(endMinutes, startMinutes + MIN_EVENT_HEIGHT_MINUTES);

  return { startMinutes, endMinutes };
}

export function calculateEventPosition(
  event: CalendarEventItem,
  selectedDate: Date
): { top: number; height: number } {
  const { startMinutes, endMinutes } = getEventMinutes(event, selectedDate);

  const top = startMinutes * PIXELS_PER_MINUTE;
  const height = (endMinutes - startMinutes) * PIXELS_PER_MINUTE;

  return { top, height };
}

export function groupOverlappingEvents(
  events: CalendarEventItem[],
  selectedDate: Date
): PositionedEvent[] {
  if (events.length === 0) {
    return [];
  }

  const sorted = [...events].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime()
  );

  const result: PositionedEvent[] = [];
  let currentGroup: CalendarEventItem[] = [];
  let groupEnd = -Infinity;

  const processGroup = (group: CalendarEventItem[]) => {
    if (group.length === 0) return;

    const columns: EventColumn[] = [];

    for (const event of group) {
      const { startMinutes } = getEventMinutes(event, selectedDate);

      let placedInColumn = false;
      for (const column of columns) {
        const lastEvent = column.events[column.events.length - 1];
        if (lastEvent) {
          const lastEnd = getEventMinutes(lastEvent, selectedDate).endMinutes;
          if (lastEnd <= startMinutes) {
            column.events.push(event);
            placedInColumn = true;
            break;
          }
        }
      }

      if (!placedInColumn) {
        columns.push({ events: [event] });
      }
    }

    const totalColumns = columns.length;

    columns.forEach((column, columnIndex) => {
      for (const event of column.events) {
        const { top, height } = calculateEventPosition(event, selectedDate);
        result.push({
          event,
          top,
          height,
          left: `${(columnIndex / totalColumns) * 100}%`,
          width: `${100 / totalColumns}%`,
          column: columnIndex,
          totalColumns
        });
      }
    });
  };

  for (const event of sorted) {
    const { startMinutes, endMinutes } = getEventMinutes(event, selectedDate);

    if (currentGroup.length === 0 || startMinutes < groupEnd) {
      currentGroup.push(event);
      groupEnd = Math.max(groupEnd, endMinutes);
    } else {
      processGroup(currentGroup);
      currentGroup = [event];
      groupEnd = endMinutes;
    }
  }

  processGroup(currentGroup);

  return result;
}

export function getPositionedEventsForDay(
  events: CalendarEventItem[],
  selectedDate: Date
): PositionedEvent[] {
  const dayStart = new Date(selectedDate);
  dayStart.setHours(0, 0, 0, 0);

  const dayEnd = new Date(selectedDate);
  dayEnd.setHours(23, 59, 59, 999);

  const dayEvents = events.filter((event) => {
    const eventEnd = event.endAt ?? new Date(event.startAt.getTime() + 3600000);
    return event.startAt <= dayEnd && eventEnd >= dayStart;
  });

  return groupOverlappingEvents(dayEvents, selectedDate);
}
