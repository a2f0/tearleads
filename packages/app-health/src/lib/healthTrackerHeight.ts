import { type Database, healthHeightReadings } from '@tearleads/db/sqlite';
import { desc } from 'drizzle-orm';

import type {
  CreateHeightReadingInput,
  HealthTracker,
  HeightReading,
  HeightUnit
} from './healthTrackerTypes.js';
import {
  fromCentiHeight,
  normalizeHeightUnit,
  normalizeOptionalText,
  normalizePositiveNumber,
  normalizeTimestamp,
  toCentiHeight,
  toIsoTimestamp
} from './healthTrackerUtils.js';

interface HeightOperationDependencies {
  db: Database;
  now: () => Date;
  createId: (prefix: string) => string;
}

function toHeightReading(
  id: string,
  recordedAt: Date,
  value: number,
  unit: HeightUnit,
  contactId: string | null,
  note: string | undefined
): HeightReading {
  const reading: HeightReading = {
    id,
    recordedAt: toIsoTimestamp(recordedAt),
    value,
    unit,
    contactId
  };

  if (note !== undefined) {
    reading.note = note;
  }

  return reading;
}

export function createHeightOperations({
  db,
  now,
  createId
}: HeightOperationDependencies): Pick<
  HealthTracker,
  'listHeightReadings' | 'addHeightReading'
> {
  return {
    listHeightReadings: async () => {
      const rows = await db
        .select({
          id: healthHeightReadings.id,
          recordedAt: healthHeightReadings.recordedAt,
          valueCenti: healthHeightReadings.valueCenti,
          unit: healthHeightReadings.unit,
          note: healthHeightReadings.note,
          contactId: healthHeightReadings.contactId
        })
        .from(healthHeightReadings)
        .orderBy(
          desc(healthHeightReadings.recordedAt),
          desc(healthHeightReadings.createdAt)
        );

      return rows.map((row) =>
        toHeightReading(
          row.id,
          row.recordedAt,
          fromCentiHeight(row.valueCenti),
          normalizeHeightUnit(row.unit, 'unit'),
          row.contactId ?? null,
          row.note ?? undefined
        )
      );
    },
    addHeightReading: async (input: CreateHeightReadingInput) => {
      const recordedAt = normalizeTimestamp(input.recordedAt, 'recordedAt');
      const unit = normalizeHeightUnit(input.unit, 'unit');
      const note = normalizeOptionalText(input.note);
      const contactId = input.contactId ?? null;
      const id = createId('height');
      const createdAt = now();
      const value = normalizePositiveNumber(input.value, 'value');

      await db.insert(healthHeightReadings).values({
        id,
        recordedAt,
        valueCenti: toCentiHeight(value, 'value'),
        unit,
        note: note ?? null,
        contactId,
        createdAt
      });

      return toHeightReading(id, recordedAt, value, unit, contactId, note);
    }
  };
}
