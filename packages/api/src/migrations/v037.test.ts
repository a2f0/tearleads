import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v037 migration', () => {
  let pool: ReturnType<typeof createMockPool>;
  const v037 = migrations.find(
    (migration: Migration) => migration.version === 37
  );

  beforeEach(async () => {
    if (!v037) {
      throw new Error('v037 migration not found');
    }
    pool = createMockPool(new Map());
    await v037.up(pool);
  });

  it('finds the v037 migration', () => {
    expect(v037).toBeDefined();
  });

  it('drops the legacy mls_messages table', () => {
    expect(pool.queries.join('\n')).toContain(
      'DROP TABLE IF EXISTS "mls_messages"'
    );
  });
});
