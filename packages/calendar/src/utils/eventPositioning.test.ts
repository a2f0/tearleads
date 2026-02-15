import { describe, expect, it } from 'vitest';
import type { CalendarEventItem } from '../types';
import {
  calculateEventPosition,
  getPositionedEventsForDay,
  groupOverlappingEvents
} from './eventPositioning';

function createEvent(
  id: string,
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
  baseDate: Date = new Date(2024, 5, 15)
): CalendarEventItem {
  const startAt = new Date(baseDate);
  startAt.setHours(startHour, startMinute, 0, 0);

  const endAt = new Date(baseDate);
  endAt.setHours(endHour, endMinute, 0, 0);

  return {
    id,
    calendarName: 'Personal',
    title: `Event ${id}`,
    startAt,
    endAt
  };
}

describe('calculateEventPosition', () => {
  const baseDate = new Date(2024, 5, 15);

  it('calculates correct top position for event at 10:30', () => {
    const event = createEvent('1', 10, 30, 11, 30, baseDate);
    const { top } = calculateEventPosition(event, baseDate);

    const expectedTop = (10 * 60 + 30) * (32 / 60);
    expect(top).toBeCloseTo(expectedTop, 2);
  });

  it('calculates correct height for 1-hour event', () => {
    const event = createEvent('1', 10, 0, 11, 0, baseDate);
    const { height } = calculateEventPosition(event, baseDate);

    expect(height).toBe(32);
  });

  it('calculates correct height for 90-minute event', () => {
    const event = createEvent('1', 10, 0, 11, 30, baseDate);
    const { height } = calculateEventPosition(event, baseDate);

    expect(height).toBe(48);
  });

  it('uses minimum height for very short events', () => {
    const event = createEvent('1', 10, 0, 10, 5, baseDate);
    const { height } = calculateEventPosition(event, baseDate);

    const minHeight = 15 * (32 / 60);
    expect(height).toBeCloseTo(minHeight, 2);
  });

  it('handles events without end time by defaulting to 1 hour', () => {
    const startAt = new Date(baseDate);
    startAt.setHours(10, 0, 0, 0);

    const event: CalendarEventItem = {
      id: '1',
      calendarName: 'Personal',
      title: 'No End Time',
      startAt,
      endAt: null
    };

    const { height } = calculateEventPosition(event, baseDate);
    expect(height).toBe(32);
  });
});

describe('groupOverlappingEvents', () => {
  const baseDate = new Date(2024, 5, 15);

  it('returns empty array for no events', () => {
    const result = groupOverlappingEvents([], baseDate);
    expect(result).toEqual([]);
  });

  it('places non-overlapping events in single column', () => {
    const events = [
      createEvent('1', 9, 0, 10, 0, baseDate),
      createEvent('2', 11, 0, 12, 0, baseDate)
    ];

    const result = groupOverlappingEvents(events, baseDate);

    expect(result).toHaveLength(2);
    expect(result[0]?.totalColumns).toBe(1);
    expect(result[0]?.width).toBe('100%');
    expect(result[1]?.totalColumns).toBe(1);
    expect(result[1]?.width).toBe('100%');
  });

  it('places overlapping events in separate columns', () => {
    const events = [
      createEvent('1', 10, 0, 12, 0, baseDate),
      createEvent('2', 11, 0, 13, 0, baseDate)
    ];

    const result = groupOverlappingEvents(events, baseDate);

    expect(result).toHaveLength(2);
    expect(result[0]?.totalColumns).toBe(2);
    expect(result[0]?.width).toBe('50%');
    expect(result[1]?.totalColumns).toBe(2);
    expect(result[1]?.width).toBe('50%');
  });

  it('reuses columns when events do not overlap', () => {
    const events = [
      createEvent('1', 9, 0, 10, 0, baseDate),
      createEvent('2', 9, 30, 11, 0, baseDate),
      createEvent('3', 10, 30, 11, 30, baseDate)
    ];

    const result = groupOverlappingEvents(events, baseDate);

    expect(result).toHaveLength(3);

    const event1 = result.find((r) => r.event.id === '1');
    const event3 = result.find((r) => r.event.id === '3');

    expect(event1?.column).toBe(event3?.column);
  });

  it('calculates correct left positions for overlapping events', () => {
    const events = [
      createEvent('1', 10, 0, 12, 0, baseDate),
      createEvent('2', 10, 30, 11, 30, baseDate),
      createEvent('3', 11, 0, 13, 0, baseDate)
    ];

    const result = groupOverlappingEvents(events, baseDate);

    expect(result).toHaveLength(3);

    const lefts = result.map((r) => r.left);
    expect(lefts).toContain('0%');
  });

  it('handles three overlapping events', () => {
    const events = [
      createEvent('1', 10, 0, 12, 0, baseDate),
      createEvent('2', 10, 0, 12, 0, baseDate),
      createEvent('3', 10, 0, 12, 0, baseDate)
    ];

    const result = groupOverlappingEvents(events, baseDate);

    expect(result).toHaveLength(3);
    expect(result[0]?.totalColumns).toBe(3);

    const widths = result.map((r) => r.width);
    expect(widths[0]).toMatch(/^33\.333333333333/);
  });
});

describe('getPositionedEventsForDay', () => {
  const baseDate = new Date(2024, 5, 15);

  it('filters events to only include those on the selected day', () => {
    const eventsOnDay = createEvent('1', 10, 0, 11, 0, baseDate);

    const differentDay = new Date(baseDate);
    differentDay.setDate(differentDay.getDate() + 1);
    const eventOnDifferentDay: CalendarEventItem = {
      id: '2',
      calendarName: 'Personal',
      title: 'Different Day',
      startAt: differentDay,
      endAt: new Date(differentDay.getTime() + 3600000)
    };

    const result = getPositionedEventsForDay(
      [eventsOnDay, eventOnDifferentDay],
      baseDate
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.event.id).toBe('1');
  });

  it('includes events that span multiple days', () => {
    const previousDay = new Date(baseDate);
    previousDay.setDate(previousDay.getDate() - 1);
    previousDay.setHours(20, 0, 0, 0);

    const spanningEvent: CalendarEventItem = {
      id: '1',
      calendarName: 'Personal',
      title: 'Spanning Event',
      startAt: previousDay,
      endAt: new Date(baseDate.getTime() + 2 * 3600000)
    };

    const result = getPositionedEventsForDay([spanningEvent], baseDate);

    expect(result).toHaveLength(1);
  });

  it('returns positioned events with correct properties', () => {
    const events = [createEvent('1', 10, 0, 11, 0, baseDate)];

    const result = getPositionedEventsForDay(events, baseDate);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      event: events[0],
      top: expect.any(Number),
      height: expect.any(Number),
      left: expect.any(String),
      width: expect.any(String),
      column: expect.any(Number),
      totalColumns: expect.any(Number)
    });
  });
});
