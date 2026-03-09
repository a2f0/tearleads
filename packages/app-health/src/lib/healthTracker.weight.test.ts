import { healthWeightReadings } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDeterministicId,
  requireValue,
  withHealthDatabase
} from '../test/healthTrackerTestUtils.js';

import { createHealthTracker } from './healthTracker.js';

describe('createHealthTracker weight readings', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('uses default id generation when custom createId is not provided', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db);

      const reading = await tracker.addWeightReading({
        recordedAt: '2026-02-13T09:15:00.000Z',
        value: 181.2
      });

      expect(reading.id.startsWith('weight_')).toBe(true);
    });
  });

  it('adds weight readings and persists centi-unit values', async () => {
    await withHealthDatabase(async ({ db }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      const reading = await tracker.addWeightReading({
        recordedAt: new Date('2026-02-13T09:15:00.000Z'),
        value: 187.4,
        note: ' morning check '
      });

      expect(reading).toEqual({
        id: 'weight_0001',
        recordedAt: '2026-02-13T09:15:00.000Z',
        value: 187.4,
        unit: 'lb',
        note: 'morning check'
      });

      const persisted = await db
        .select({
          valueCenti: healthWeightReadings.valueCenti,
          unit: healthWeightReadings.unit,
          note: healthWeightReadings.note
        })
        .from(healthWeightReadings)
        .where(eq(healthWeightReadings.id, reading.id));
      expect(persisted).toHaveLength(1);
      expect(requireValue(persisted[0]).valueCenti).toBe(18740);
      expect(requireValue(persisted[0]).unit).toBe('lb');
      expect(requireValue(persisted[0]).note).toBe('morning check');

      const listed = await tracker.listWeightReadings();
      requireValue(listed[0]).value = 0;

      expect(requireValue((await tracker.listWeightReadings())[0]).value).toBe(
        187.4
      );
    });
  });

  it('validates weight reading input and normalizes blank notes', async () => {
    await withHealthDatabase(async ({ db, adapter }) => {
      const tracker = createHealthTracker(db, {
        createId: createDeterministicId(),
        now: () => new Date('2026-02-13T09:31:00.000Z')
      });

      const reading = await tracker.addWeightReading({
        recordedAt: '2026-02-13T09:15:00.000Z',
        value: 180,
        note: '   '
      });
      expect(reading.note).toBeUndefined();

      await expect(
        tracker.addWeightReading({
          recordedAt: '2026-02-13T09:15:00.000Z',
          value: 0
        })
      ).rejects.toThrow('value must be a positive number');

      await expect(
        tracker.addWeightReading({ recordedAt: 'not-a-date', value: 180 })
      ).rejects.toThrow('recordedAt must be a valid date');

      await expect(
        tracker.addWeightReading({
          recordedAt: new Date('invalid'),
          value: 180
        })
      ).rejects.toThrow('recordedAt must be a valid date');

      await adapter.execute(`
        INSERT INTO health_weight_readings (
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
          'stone',
          NULL,
          1707964800000
        )
      `);

      await expect(tracker.listWeightReadings()).rejects.toThrow(
        'unit must be either "lb" or "kg"'
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
        INSERT INTO health_weight_readings (
          id,
          recorded_at,
          value_centi,
          unit,
          note,
          created_at
        ) VALUES (
          'bad-timestamp',
          'not-a-timestamp',
          18120,
          'lb',
          NULL,
          1707964800000
        )
      `);

      await expect(tracker.listWeightReadings()).rejects.toThrow(
        'timestamp must be valid'
      );
    });
  });
});
