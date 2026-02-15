import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v020 } from './v020';

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

describe('v020 migration', () => {
  it('adds parent_id column and index to health_exercises', async () => {
    const adapter = createAdapter();

    await v020.up(adapter);

    // Verify PRAGMA check for existing column
    expect(adapter.execute).toHaveBeenCalledWith(
      'PRAGMA table_info("health_exercises")'
    );

    // Verify ALTER TABLE to add column (when column doesn't exist)
    expect(adapter.execute).toHaveBeenCalledWith(
      'ALTER TABLE "health_exercises" ADD COLUMN "parent_id" TEXT'
    );

    // Verify index creation
    expect(adapter.execute).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "health_exercises_parent_idx" ON "health_exercises" ("parent_id")'
    );
  });
});
