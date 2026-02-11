import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v015 } from './v015';

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
  getConnection: vi.fn(() => null),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v015 migration', () => {
  it('adds deleted column and index for tags', async () => {
    const adapter = createAdapter();

    await v015.up(adapter);

    expect(adapter.execute).toHaveBeenCalledWith(
      'CREATE INDEX IF NOT EXISTS "tags_deleted_idx" ON "tags" ("deleted")'
    );
  });
});
