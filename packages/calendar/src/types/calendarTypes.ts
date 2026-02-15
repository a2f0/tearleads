/**
 * Calendar event types shared between components and context
 */

export interface CalendarEventItem {
  id: string;
  calendarName: string;
  title: string;
  startAt: Date;
  endAt?: Date | null | undefined;
}

export interface CreateCalendarEventInput {
  calendarName: string;
  title: string;
  startAt: Date;
  endAt?: Date | null | undefined;
}
