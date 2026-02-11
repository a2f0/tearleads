import { isRecord, toFiniteNumber } from '@tearleads/shared';
import { getDatabaseAdapter, isDatabaseInitialized } from './index';

export interface CalendarEvent {
  id: string;
  calendarName: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCalendarEventInput {
  calendarName: string;
  title: string;
  startAt: Date;
  endAt?: Date | null | undefined;
}

export interface ContactBirthdayEvent {
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

  return {
    id: value['id'],
    calendarName: value['calendarName'],
    title: value['title'],
    startAt,
    endAt,
    createdAt,
    updatedAt
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

function toCalendarEvent(row: RawCalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    calendarName: row.calendarName,
    title: row.title,
    startAt: new Date(row.startAt),
    endAt: row.endAt === null ? null : new Date(row.endAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
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
      updated_at as updatedAt
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

  await adapter.execute(
    `INSERT INTO calendar_events (
      id,
      calendar_name,
      title,
      start_at,
      end_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, calendarName, title, startAt, endAt, now, now]
  );

  return {
    id,
    calendarName,
    title,
    startAt: new Date(startAt),
    endAt: endAt === null ? null : new Date(endAt),
    createdAt: new Date(now),
    updatedAt: new Date(now)
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
