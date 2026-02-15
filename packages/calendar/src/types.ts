export interface CalendarEventItem {
  id: string;
  calendarName: string;
  title: string;
  startAt: Date;
  endAt?: Date | null | undefined;
}
