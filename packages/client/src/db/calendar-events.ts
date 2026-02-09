import { isRecord, toFiniteNumber } from '@rapid/shared';
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

interface RawCalendarEventRow {
  id: string;
  calendarName: string;
  title: string;
  startAt: number;
  endAt: number | null;
  createdAt: number;
  updatedAt: number;
}

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
