// Import integration setup FIRST - wires real db-test-utils adapter/key manager
import '../test/setup-integration';

import { resetTestKeyManager } from '@rapid/db-test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCalendarEvent, getCalendarEvents } from './calendar-events';
import { getDatabaseAdapter, resetDatabase, setupDatabase } from './index';

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';

describe('calendar-events integration', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
  });

  it('creates calendar_events table through migrations', async () => {
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
    const adapter = getDatabaseAdapter();

    const result = await adapter.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_events'",
      []
    );

    expect(result.rows).toHaveLength(1);
  });

  it('persists and returns events from real sqlite database', async () => {
    await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

    const startAt = new Date('2026-02-09T16:00:00.000Z');
    const endAt = new Date('2026-02-09T17:30:00.000Z');

    const created = await createCalendarEvent({
      calendarName: 'Personal',
      title: 'Integration Test Event',
      startAt,
      endAt
    });

    expect(created).not.toBeNull();
    expect(created?.title).toBe('Integration Test Event');

    const events = await getCalendarEvents();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      calendarName: 'Personal',
      title: 'Integration Test Event'
    });
    expect(events[0]?.startAt.toISOString()).toBe(startAt.toISOString());
    expect(events[0]?.endAt?.toISOString()).toBe(endAt.toISOString());
  });
});
