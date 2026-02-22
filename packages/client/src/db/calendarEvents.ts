import { isRecord, toFiniteNumber } from '@tearleads/shared';
import { getDatabaseAdapter, isDatabaseInitialized } from './index';

interface RecurrenceRule {
  rrule: string;
  exdates?: string[];
}

interface CalendarEvent {
  id: string;
  calendarName: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  recurrence?: RecurrenceRule | null;
  recurringEventId?: string | null;
  originalStartAt?: Date | null;
}

interface CreateCalendarEventInput {
  calendarName: string;
  title: string;
  startAt: Date;
  endAt?: Date | null | undefined;
  recurrence?: { rrule: string } | null | undefined;
}

interface ContactBirthdayEvent {
  id: string;
  calendarName: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
}

interface RawCalendarEventRow {
  id: string;
  calendarName: string;
  title: string;
  startAt: number;
  endAt: number | null;
  createdAt: number;
  updatedAt: number;
  rrule: string | null;
  recurringEventId: string | null;
  originalStartAt: number | null;
  exdates: string | null;
}

interface RawContactBirthdayRow {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string;
}

interface BirthdayDateParts {
  month: number;
  day: number;
}

const BIRTHDAY_CALENDAR_NAME = 'Personal';
const BIRTHDAY_YEAR_RANGE = 5;

function normalizeCalendarEventRow(value: unknown): RawCalendarEventRow | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value['id'] !== 'string' ||
    typeof value['calendarName'] !== 'string' ||
    typeof value['title'] !== 'string'
  ) {
    return null;
  }

  const startAt = toFiniteNumber(value['startAt']);
  const createdAt = toFiniteNumber(value['createdAt']);
  const updatedAt = toFiniteNumber(value['updatedAt']);

  const endAtRaw = value['endAt'];
  const endAt =
    endAtRaw === null || typeof endAtRaw === 'undefined'
      ? null
      : toFiniteNumber(endAtRaw);

  if (
    startAt === null ||
    createdAt === null ||
    updatedAt === null ||
    endAt === undefined
  ) {
    return null;
  }

  const rruleRaw = value['rrule'];
  const rrule =
    rruleRaw === null || typeof rruleRaw === 'undefined'
      ? null
      : typeof rruleRaw === 'string'
        ? rruleRaw
        : null;

  const recurringEventIdRaw = value['recurringEventId'];
  const recurringEventId =
    recurringEventIdRaw === null || typeof recurringEventIdRaw === 'undefined'
      ? null
      : typeof recurringEventIdRaw === 'string'
        ? recurringEventIdRaw
        : null;

  const originalStartAtRaw = value['originalStartAt'];
  const originalStartAt =
    originalStartAtRaw === null || typeof originalStartAtRaw === 'undefined'
      ? null
      : toFiniteNumber(originalStartAtRaw);

  const exdatesRaw = value['exdates'];
  const exdates =
    exdatesRaw === null || typeof exdatesRaw === 'undefined'
      ? null
      : typeof exdatesRaw === 'string'
        ? exdatesRaw
        : null;

  return {
    id: value['id'],
    calendarName: value['calendarName'],
    title: value['title'],
    startAt,
    endAt,
    createdAt,
    updatedAt,
    rrule,
    recurringEventId,
    originalStartAt,
    exdates
  };
}

function normalizeContactBirthdayRow(
  value: unknown
): RawContactBirthdayRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = value['id'];
  const firstName = value['firstName'];
  const lastNameRaw = value['lastName'];
  const birthday = value['birthday'];

  if (
    typeof id !== 'string' ||
    typeof firstName !== 'string' ||
    typeof birthday !== 'string'
  ) {
    return null;
  }

  if (lastNameRaw !== null && typeof lastNameRaw !== 'string') {
    return null;
  }

  return {
    id,
    firstName,
    lastName: lastNameRaw,
    birthday
  };
}

function parseBirthdayDateParts(value: string): BirthdayDateParts | null {
  const normalized = value.trim();
  const dashedMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const compactMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  const match = dashedMatch ?? compactMatch;

  if (!match) {
    return null;
  }

  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return { month, day };
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function toBirthdayEventTitle(
  firstName: string,
  lastName: string | null
): string {
  const fullName = [firstName, lastName ?? ''].join(' ').trim();
  return `${fullName}'s Birthday`;
}

function parseExdates(exdatesJson: string | null): string[] | undefined {
  if (!exdatesJson) return undefined;
  try {
    const parsed = JSON.parse(exdatesJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function toCalendarEvent(row: RawCalendarEventRow): CalendarEvent {
  const exdates = parseExdates(row.exdates);

  return {
    id: row.id,
    calendarName: row.calendarName,
    title: row.title,
    startAt: new Date(row.startAt),
    endAt: row.endAt === null ? null : new Date(row.endAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    recurrence: row.rrule
      ? { rrule: row.rrule, ...(exdates && { exdates }) }
      : null,
    recurringEventId: row.recurringEventId,
    originalStartAt:
      row.originalStartAt === null ? null : new Date(row.originalStartAt)
  };
}

export async function getCalendarEvents(): Promise<CalendarEvent[]> {
  if (!isDatabaseInitialized()) {
    return [];
  }

  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT
      id,
      calendar_name as calendarName,
      title,
      start_at as startAt,
      end_at as endAt,
      created_at as createdAt,
      updated_at as updatedAt,
      rrule,
      recurring_event_id as recurringEventId,
      original_start_at as originalStartAt,
      exdates
    FROM calendar_events
    ORDER BY start_at ASC`,
    []
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const normalizedRows = rows
    .map(normalizeCalendarEventRow)
    .filter((row): row is RawCalendarEventRow => row !== null);

  return normalizedRows.map(toCalendarEvent);
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput
): Promise<CalendarEvent | null> {
  if (!isDatabaseInitialized()) {
    return null;
  }

  const calendarName = input.calendarName.trim();
  const title = input.title.trim();

  if (!calendarName || !title) {
    return null;
  }

  const adapter = getDatabaseAdapter();
  const now = Date.now();
  const id = crypto.randomUUID();
  const startAt = input.startAt.getTime();
  const endAt = input.endAt ? input.endAt.getTime() : null;
  const rrule = input.recurrence?.rrule ?? null;

  await adapter.execute(
    `INSERT INTO calendar_events (
      id,
      calendar_name,
      title,
      start_at,
      end_at,
      rrule,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, calendarName, title, startAt, endAt, rrule, now, now]
  );

  return {
    id,
    calendarName,
    title,
    startAt: new Date(startAt),
    endAt: endAt === null ? null : new Date(endAt),
    createdAt: new Date(now),
    updatedAt: new Date(now),
    recurrence: rrule ? { rrule } : null,
    recurringEventId: null,
    originalStartAt: null
  };
}

export async function getContactBirthdayEvents(
  referenceDate: Date = new Date()
): Promise<ContactBirthdayEvent[]> {
  if (!isDatabaseInitialized()) {
    return [];
  }

  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT
      id,
      first_name as firstName,
      last_name as lastName,
      birthday
    FROM contacts
    WHERE deleted = 0
      AND birthday IS NOT NULL
      AND TRIM(birthday) != ''`,
    []
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const normalizedRows = rows
    .map(normalizeContactBirthdayRow)
    .filter((row): row is RawContactBirthdayRow => row !== null);

  const targetYear = referenceDate.getFullYear();
  const events: ContactBirthdayEvent[] = [];

  for (const row of normalizedRows) {
    const dateParts = parseBirthdayDateParts(row.birthday);
    if (!dateParts) {
      continue;
    }

    for (
      let year = targetYear - BIRTHDAY_YEAR_RANGE;
      year <= targetYear + BIRTHDAY_YEAR_RANGE;
      year += 1
    ) {
      if (!isValidDate(year, dateParts.month, dateParts.day)) {
        continue;
      }

      events.push({
        id: `birthday:${row.id}:${year}`,
        calendarName: BIRTHDAY_CALENDAR_NAME,
        title: toBirthdayEventTitle(row.firstName, row.lastName),
        startAt: new Date(year, dateParts.month - 1, dateParts.day),
        endAt: null
      });
    }
  }

  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}
