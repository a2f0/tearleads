import {
  contactEmails,
  contacts,
  vfsLinks,
  vfsRegistry
} from '@tearleads/db/sqlite';
import {
  contactsTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import { describe, expect, it, vi } from 'vitest';
import { getPrimaryEmailsForGroup } from './getPrimaryEmailsForGroup';

type PerfStats = { queryCount: number; durationMs: number };

const MAX_INSERT_CHUNK_SIZE = 100;

async function insertInChunks<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<void>
): Promise<void> {
  for (let i = 0; i < rows.length; i += MAX_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + MAX_INSERT_CHUNK_SIZE);
    await insert(chunk);
  }
}

async function seedGroupData(
  db: Parameters<typeof getPrimaryEmailsForGroup>[0],
  input: {
    groupId: string;
    start: number;
    count: number;
    deletedEvery: number;
  }
): Promise<number> {
  const now = new Date();
  const registryRows: (typeof vfsRegistry.$inferInsert)[] = [];
  const contactRows: (typeof contacts.$inferInsert)[] = [];
  const contactEmailRows: (typeof contactEmails.$inferInsert)[] = [];
  const linkRows: (typeof vfsLinks.$inferInsert)[] = [];

  let activeCount = 0;
  for (let index = 0; index < input.count; index += 1) {
    const contactNumber = input.start + index;
    const contactId = `contact-${contactNumber}`;
    const isDeleted =
      input.deletedEvery > 0 && index % input.deletedEvery === 0;

    registryRows.push({
      id: contactId,
      objectType: 'contact',
      ownerId: null,
      createdAt: now
    });
    contactRows.push({
      id: contactId,
      firstName: `First ${contactNumber}`,
      lastName: `Last ${contactNumber}`,
      deleted: isDeleted,
      createdAt: now,
      updatedAt: now
    });
    contactEmailRows.push({
      id: `email-primary-${contactNumber}`,
      contactId,
      email: `contact-${contactNumber}@example.com`,
      label: 'work',
      isPrimary: true
    });
    contactEmailRows.push({
      id: `email-secondary-${contactNumber}`,
      contactId,
      email: `secondary-${contactNumber}@example.com`,
      label: 'other',
      isPrimary: false
    });
    linkRows.push({
      id: `link-${input.groupId}-${contactNumber}`,
      parentId: input.groupId,
      childId: contactId,
      wrappedSessionKey: 'key',
      createdAt: now
    });

    if (!isDeleted) {
      activeCount += 1;
    }
  }

  await insertInChunks(registryRows, async (chunk) => {
    await db.insert(vfsRegistry).values(chunk);
  });
  await insertInChunks(contactRows, async (chunk) => {
    await db.insert(contacts).values(chunk);
  });
  await insertInChunks(contactEmailRows, async (chunk) => {
    await db.insert(contactEmails).values(chunk);
  });
  await insertInChunks(linkRows, async (chunk) => {
    await db.insert(vfsLinks).values(chunk);
  });

  return activeCount;
}

async function measureQueryPerf(
  adapter: { execute: (sql: string, params?: unknown[]) => Promise<unknown> },
  run: () => Promise<void>
): Promise<PerfStats> {
  const originalExecute = adapter.execute.bind(adapter);
  let queryCount = 0;

  adapter.execute = async (sql, params) => {
    const normalized = sql.trim().toUpperCase();
    if (normalized.startsWith('SELECT')) {
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

  return {
    queryCount,
    durationMs: performance.now() - start
  };
}

describe('getPrimaryEmailsForGroup integration (real database)', () => {
  it('keeps group email lookup to a single query at realistic scale', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await withRealDatabase(
      async ({ db, adapter }) => {
        const now = new Date();
        await db.insert(vfsRegistry).values([
          {
            id: 'group-target',
            objectType: 'contactGroup',
            ownerId: null,
            createdAt: now
          },
          {
            id: 'group-noise',
            objectType: 'contactGroup',
            ownerId: null,
            createdAt: now
          }
        ]);

        const expectedTargetEmailCount = await seedGroupData(db, {
          groupId: 'group-target',
          start: 0,
          count: 450,
          deletedEvery: 9
        });

        await seedGroupData(db, {
          groupId: 'group-noise',
          start: 10000,
          count: 650,
          deletedEvery: 0
        });

        const stats = await measureQueryPerf(adapter, async () => {
          const emails = await getPrimaryEmailsForGroup(db, 'group-target');
          expect(emails).toHaveLength(expectedTargetEmailCount);
          expect(emails).toContain('contact-1@example.com');
          expect(emails).not.toContain('contact-0@example.com');
        });

        expect(stats.queryCount).toBeLessThanOrEqual(1);
        expect(stats.durationMs).toBeLessThanOrEqual(150);
      },
      { migrations: contactsTestMigrations }
    );
  });
});
