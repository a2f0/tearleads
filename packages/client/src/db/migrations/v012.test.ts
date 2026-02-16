import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v012 } from './v012';

const createAdapter = (
  executeMany: DatabaseAdapter['executeMany']
): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute: vi.fn(async () => ({ rows: [] })),
  executeMany,
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v012 migration', () => {
  it('creates calendar_events table and indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const adapter = createAdapter(executeMany);

    await v012.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(statements).toEqual([
      'CREATE TABLE IF NOT EXISTS "calendar_events" (\n' +
        '        "id" TEXT PRIMARY KEY NOT NULL,\n' +
        '        "calendar_name" TEXT NOT NULL,\n' +
        '        "title" TEXT NOT NULL,\n' +
        '        "start_at" INTEGER NOT NULL,\n' +
        '        "end_at" INTEGER,\n' +
        '        "created_at" INTEGER NOT NULL,\n' +
        '        "updated_at" INTEGER NOT NULL\n' +
        '      )',
      'CREATE INDEX IF NOT EXISTS "calendar_events_calendar_start_idx" ON "calendar_events" ("calendar_name", "start_at")',
      'CREATE INDEX IF NOT EXISTS "calendar_events_start_idx" ON "calendar_events" ("start_at")'
    ]);
  });
});
