import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPool, migrations } from './index-test-support.js';
import type { Migration } from './types.js';

describe('v035 migration', () => {
  let pool: ReturnType<typeof createMockPool>;
  const v035 = migrations.find(
    (migration: Migration) => migration.version === 35
  );

  beforeEach(async () => {
    if (!v035) {
      throw new Error('v035 migration not found');
    }
    pool = createMockPool(new Map());
    await v035.up(pool);
  });

  it('finds the v035 migration', () => {
    expect(v035).toBeDefined();
  });

  it('drops all legacy standalone content tables', () => {
    const queries = pool.queries.join('\n');

    expect(queries).toContain('DROP TABLE IF EXISTS "contact_phones"');
    expect(queries).toContain('DROP TABLE IF EXISTS "contact_emails"');
    expect(queries).toContain('DROP TABLE IF EXISTS "contacts"');
    expect(queries).toContain('DROP TABLE IF EXISTS "files"');
    expect(queries).toContain('DROP TABLE IF EXISTS "notes"');
    expect(queries).toContain('DROP TABLE IF EXISTS "sync_metadata"');
    expect(queries).toContain('DROP TABLE IF EXISTS "analytics_events"');
    expect(queries).toContain('DROP TABLE IF EXISTS "user_settings"');
  });

  it('drops child tables before parent tables', () => {
    const phonesIdx = pool.queries.findIndex((q) =>
      q.includes('"contact_phones"')
    );
    const emailsIdx = pool.queries.findIndex((q) =>
      q.includes('"contact_emails"')
    );
    const contactsIdx = pool.queries.findIndex((q) => q.includes('"contacts"'));

    expect(phonesIdx).toBeLessThan(contactsIdx);
    expect(emailsIdx).toBeLessThan(contactsIdx);
  });
});
