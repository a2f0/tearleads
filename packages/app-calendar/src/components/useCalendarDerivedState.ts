import { useMemo } from 'react';
import { calendarLocale } from '../constants';
import type { CalendarEventItem } from '../types';
import { getPositionedEventsForDay } from '../utils/eventPositioning';

const yearMonthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

interface UseCalendarDerivedStateArgs {
  selectedDate: Date;
  events: CalendarEventItem[];
  activeCalendar: string;
  getDateKey: (date: Date) => string;
}

export function useCalendarDerivedState({
  selectedDate,
  events,
  activeCalendar,
  getDateKey
}: UseCalendarDerivedStateArgs) {
  const dayLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString(calendarLocale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      }),
    [selectedDate]
  );

  const monthLabel = useMemo(
    () =>
      selectedDate.toLocaleDateString(calendarLocale, {
        month: 'long',
        year: 'numeric'
      }),
    [selectedDate]
  );

  const weekDates = useMemo(() => {
    const weekStart = new Date(selectedDate);
    weekStart.setDate(selectedDate.getDate() - selectedDate.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      return date;
    });
  }, [selectedDate]);

  const monthCells = useMemo(() => {
    const monthStart = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      1
    );
    const monthEnd = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth() + 1,
      0
    );
    const monthLeadingDays = monthStart.getDay();
    const monthTrailingDays = 6 - monthEnd.getDay();
    const cells: Array<{ date: Date; inMonth: boolean }> = [];

    for (let i = monthLeadingDays; i > 0; i -= 1) {
      cells.push({
        date: new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          1 - i
        ),
        inMonth: false
      });
    }
    for (let day = 1; day <= monthEnd.getDate(); day += 1) {
      cells.push({
        date: new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          day
        ),
        inMonth: true
      });
    }
    for (let i = 1; i <= monthTrailingDays; i += 1) {
      cells.push({
        date: new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth() + 1,
          i
        ),
        inMonth: false
      });
    }

    return cells;
  }, [selectedDate]);

  const yearData = useMemo(() => {
    const currentYear = selectedDate.getFullYear();

    return yearMonthNames.map((monthName, monthIndex) => {
      const start = new Date(currentYear, monthIndex, 1);
      const end = new Date(currentYear, monthIndex + 1, 0);
      const leading = start.getDay();
      const cells: Array<{ day: number; inMonth: boolean; key: string }> = [];

      for (let i = leading; i > 0; i -= 1) {
        cells.push({ day: 0, inMonth: false, key: `leading-${i}` });
      }
      for (let day = 1; day <= end.getDate(); day += 1) {
        cells.push({ day, inMonth: true, key: `day-${day}` });
      }
      let trailing = 0;
      while (cells.length % 7 !== 0) {
        trailing += 1;
        cells.push({ day: 0, inMonth: false, key: `trailing-${trailing}` });
      }

      return { monthName, cells };
    });
  }, [selectedDate]);

  const currentYear = selectedDate.getFullYear();

  const calendarEvents = useMemo(
    () => events.filter((event) => event.calendarName === activeCalendar),
    [activeCalendar, events]
  );

  const positionedDayEvents = useMemo(
    () => getPositionedEventsForDay(calendarEvents, selectedDate),
    [calendarEvents, selectedDate]
  );

  const eventCountByDay = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const event of calendarEvents) {
      const key = getDateKey(event.startAt);
      const previousCount = countMap.get(key) ?? 0;
      countMap.set(key, previousCount + 1);
    }
    return countMap;
  }, [calendarEvents, getDateKey]);

  return {
    dayLabel,
    monthLabel,
    weekDates,
    monthCells,
    yearData,
    currentYear,
    positionedDayEvents,
    eventCountByDay
  };
}
