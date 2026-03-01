import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/db/adapters/types';
import { v029 } from './v029';

const createAdapter = (
  executeMany: DatabaseAdapter['executeMany'],
  execute: DatabaseAdapter['execute']
): DatabaseAdapter => ({
  initialize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isOpen: vi.fn(() => true),
  execute,
  executeMany,
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  rekeyDatabase: vi.fn(async () => {}),
  getConnection: vi.fn(() => async () => ({ rows: [] })),
  exportDatabase: vi.fn(async () => new Uint8Array()),
  importDatabase: vi.fn(async () => {})
});

describe('v029 migration', () => {
  it('creates ai_conversations and ai_messages tables with indexes', async () => {
    const executeMany = vi
      .fn<DatabaseAdapter['executeMany']>()
      .mockResolvedValueOnce();
    const execute = vi.fn<DatabaseAdapter['execute']>();
    const adapter = createAdapter(executeMany, execute);

    await v029.up(adapter);

    expect(executeMany).toHaveBeenCalledTimes(1);
    const statements = executeMany.mock.calls[0]?.[0] ?? [];

    expect(
      statements.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS "ai_conversations"')
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('CREATE TABLE IF NOT EXISTS "ai_messages"')
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('ai_conversations_updated_idx')
      )
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('ai_messages_conversation_idx')
      )
    ).toBe(true);
  });

  it('has correct version and description', () => {
    expect(v029.version).toBe(29);
    expect(v029.description).toBe(
      'Add AI conversations and messages tables'
    );
  });
});
