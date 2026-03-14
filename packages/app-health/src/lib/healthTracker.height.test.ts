import { healthHeightReadings } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeterministicId,
  requireValue,
  withHealthDatabase
} from '../test/healthTrackerTestUtils.js';
import { createHealthTracker } from './healthTracker.js';

describe('createHealthTracker height readings', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('adds height readings and persists centi-unit values', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      const reading = await tracker.addHeightReading({
        recordedAt: new Date('2026-02-13T09:15:00.000Z'),
        value: 42.75,
        note: ' annual visit '
      });

      expect(reading).toEqual({
        id: 'height_0001',
        recordedAt: '2026-02-13T09:15:00.000Z',
        value: 42.75,
        unit: 'in',
        note: 'annual visit',
        contactId: null
      });

      const persisted = await db
        .select({
          valueCenti: healthHeightReadings.valueCenti,
          unit: healthHeightReadings.unit,
          note: healthHeightReadings.note
        })
        .from(healthHeightReadings)
        .where(eq(healthHeightReadings.id, reading.id));
      expect(persisted).toHaveLength(1);
      expect(requireValue(persisted[0]).valueCenti).toBe(4275);
      expect(requireValue(persisted[0]).unit).toBe('in');
      expect(requireValue(persisted[0]).note).toBe('annual visit');

      const listed = await tracker.listHeightReadings();
      requireValue(listed[0]).value = 0;

      expect(requireValue((await tracker.listHeightReadings())[0]).value).toBe(
        42.75
      );
    });
  });

  it('validates height reading input and normalizes blank notes', async () => {
    await withHealthDatabase(async ({ db, adapter }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      const reading = await tracker.addHeightReading({
        recordedAt: '2026-02-13T09:15:00.000Z',
        value: 40,
        unit: 'cm',
        note: '   '
      });
      expect(reading.note).toBeUndefined();
      expect(reading.unit).toBe('cm');

      await expect(
        tracker.addHeightReading({
          recordedAt: '2026-02-13T09:15:00.000Z',
          value: 0
        })
      ).rejects.toThrow('value must be a positive number');

      await expect(
        tracker.addHeightReading({ recordedAt: 'not-a-date', value: 40 })
      ).rejects.toThrow('recordedAt must be a valid date');

      await adapter.execute(`
        INSERT INTO health_height_readings (
          id,
          recorded_at,
          value_centi,
          unit,
          note,
          created_at
        ) VALUES (
          'bad-unit',
          1707964800000,
          12345,
          'ft',
          NULL,
          1707964800000
        )
      `);

      await expect(tracker.listHeightReadings()).rejects.toThrow(
        'unit must be either "in" or "cm"'
      );
    });
  });

  it('throws when stored timestamps cannot be parsed to valid dates', async () => {
    await withHealthDatabase(async ({ db, adapter }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      await adapter.execute(`
        INSERT INTO health_height_readings (
          id,
          recorded_at,
          value_centi,
          unit,
          note,
          created_at
        ) VALUES (
          'bad-timestamp',
          'not-a-timestamp',
          4225,
          'in',
          NULL,
          1707964800000
        )
      `);

      await expect(tracker.listHeightReadings()).rejects.toThrow(
        'timestamp must be valid'
      );
    });
  });

  it('updates contactId on an existing reading', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      const reading = await tracker.addHeightReading({
        recordedAt: '2026-02-13T09:15:00.000Z',
        value: 41
      });
      expect(reading.contactId).toBeNull();

      await tracker.updateContactId(
        'health_height_readings',
        reading.id,
        'contact-abc'
      );

      const listed = await tracker.listHeightReadings();
      expect(requireValue(listed[0]).contactId).toBe('contact-abc');
    });
  });
});
