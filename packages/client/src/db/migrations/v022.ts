import type { Migration } from './types';
import { addColumnIfNotExists } from './utils';

/**
 * v022: Add recurrence fields to calendar_events
 *
 * Supports recurring calendar events with RRULE-based patterns:
 * - rrule: RFC 5545 recurrence rule string (e.g., "FREQ=WEEKLY;BYDAY=MO,WE,FR")
 * - recurring_event_id: FK to parent event for exception instances
 * - original_start_at: Original occurrence date this exception overrides
 * - exdates: JSON array of excluded occurrence dates (ISO strings)
 */
export const v022: Migration = {
  version: 22,
  description: 'Add recurrence fields to calendar_events',
  up: async (adapter) => {
    await addColumnIfNotExists(adapter, 'calendar_events', 'rrule', 'TEXT');

    await addColumnIfNotExists(
      adapter,
      'calendar_events',
      'recurring_event_id',
      'TEXT'
    );

    await addColumnIfNotExists(
      adapter,
      'calendar_events',
      'original_start_at',
      'INTEGER'
    );

    await addColumnIfNotExists(adapter, 'calendar_events', 'exdates', 'TEXT');

    await adapter.execute(
      `CREATE INDEX IF NOT EXISTS "calendar_events_recurring_parent_idx" ON "calendar_events" ("recurring_event_id")`
    );
  }
};
