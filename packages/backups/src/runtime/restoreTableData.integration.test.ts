import { contacts } from '@tearleads/db/sqlite';
import {
  contactsTestMigrations,
  mockConsoleWarn,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restoreTableData } from './restoreTableData';

type PerfStats = { queryCount: number; durationMs: number };

const CONTACT_ROW_COUNT = 1200;

function buildContactRows(count: number): Array<Record<string, unknown>> {
  const baseTimestamp = Date.now();
  return Array.from({ length: count }, (_, index) => ({
    id: `restore-contact-${index}`,
    first_name: `First ${index}`,
    last_name: `Last ${index}`,
    birthday: null,
    created_at: baseTimestamp + index,
    updated_at: baseTimestamp + index,
    deleted: 0
  }));
}

async function measureInsertPerf(
  adapter: { execute: (sql: string, params?: unknown[]) => Promise<unknown> },
  run: () => Promise<void>
): Promise<PerfStats> {
  const originalExecute = adapter.execute.bind(adapter);
  let queryCount = 0;

  adapter.execute = async (sql, params) => {
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      queryCount += 1;
    }
    return originalExecute(sql, params);
  };

  const start = performance.now();
  try {
    await run();
  } finally {
    adapter.execute = originalExecute;
  }

  return { queryCount, durationMs: performance.now() - start };
}

describe('backup importer integration (real database)', () => {
  let warnSpy: ReturnType<typeof mockConsoleWarn>;

  beforeEach(() => {
    warnSpy = mockConsoleWarn();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('restores large contact batches within perf baseline', async () => {
    await withRealDatabase(
      async ({ db, adapter }) => {
        const rows = buildContactRows(CONTACT_ROW_COUNT);

        const stats = await measureInsertPerf(adapter, async () => {
          await restoreTableData(adapter, 'contacts', rows);
        });

        const baseline = {
          queryCount: 10,
          durationMs: 1000
        };

        const inserted = await db.select({ id: contacts.id }).from(contacts);

        expect(inserted).toHaveLength(CONTACT_ROW_COUNT);
        expect(stats.queryCount).toBeLessThanOrEqual(baseline.queryCount);
        expect(stats.durationMs).toBeLessThanOrEqual(baseline.durationMs);
      },
      { migrations: contactsTestMigrations }
    );
  });
});
