import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v022 } from './v022';

const createAdapter = (): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute: vi.fn(async () => ({ rows: [] })),
  executeMany: vi.fn(async () => {}),
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v022 migration', () => {
  it('adds recurrence columns and index to calendar_events', async () => {
    const adapter = createAdapter();

    await v022.up(adapter);

    // Verify PRAGMA checks for existing columns
    expect(adapter.execute).toHaveBeenCalledWith(
      'PRAGMA table_info("calendar_events")'
    );

    // Verify ALTER TABLE to add rrule column
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "calendar_events" ADD COLUMN "rrule" TEXT'
    );

    // Verify ALTER TABLE to add recurring_event_id column
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "calendar_events" ADD COLUMN "recurring_event_id" TEXT'
    );

    // Verify ALTER TABLE to add original_start_at column
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "calendar_events" ADD COLUMN "original_start_at" INTEGER'
    );

    // Verify ALTER TABLE to add exdates column
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "calendar_events" ADD COLUMN "exdates" TEXT'
    );

    // Verify index creation
    expect(adapter.execute).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "calendar_events_recurring_parent_idx" ON "calendar_events" ("recurring_event_id")'
    );
  });

  it('has correct version and description', () => {
    expect(v022.version).toBe(22);
    expect(v022.description).toBe('Add recurrence fields to calendar_events');
  });
});
