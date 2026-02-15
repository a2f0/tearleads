/**
 * Tests for composite primary key functionality.
 *
 * These tests verify that the generated Drizzle schemas correctly enforce
 * composite primary keys on junction tables.
 */
import { describe, expect, it } from 'vitest';
import type { DatabaseAdapter } from './adapters/types.js';
import { withRealDatabase } from './withRealDatabase.js';

/**
 * Migrations that create tables with composite primary keys for testing.
 */
const compositePkMigrations = [
  {
    version: 1,
    up: async (adapter: DatabaseAdapter) => {
      // Enable foreign keys
      await adapter.execute('PRAGMA foreign_keys = ON');

      // Create users table
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL
        )
      `);

      // Create organizations table
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        )
      `);

      // Create user_organizations junction table with composite primary key
      // This is the correct SQLite syntax for composite PKs
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS user_organizations (
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          joined_at INTEGER NOT NULL,
          is_admin INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, organization_id)
        )
      `);

      // Create index for organization lookups
      await adapter.execute(`
        CREATE INDEX IF NOT EXISTS user_organizations_org_idx
        ON user_organizations(organization_id)
      `);
    }
  }
];

describe('Composite Primary Key', () => {
  it('allows inserting a single row', async () => {
    await withRealDatabase(
      async ({ adapter }) => {
        // Seed parent tables
        await adapter.execute(
          "INSERT INTO users (id, email) VALUES ('user1', 'user1@test.com')"
        );
        await adapter.execute(
          "INSERT INTO organizations (id, name) VALUES ('org1', 'Org One')"
        );

        // Insert into junction table
        await adapter.execute(`
          INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
          VALUES ('user1', 'org1', ${Date.now()}, 0)
        `);

        // Verify the row was inserted
        const result = await adapter.execute(
          'SELECT * FROM user_organizations'
        );
        expect(result.rows.length).toBe(1);
        expect(result.rows[0]).toMatchObject({
          user_id: 'user1',
          organization_id: 'org1'
        });
      },
      { migrations: compositePkMigrations }
    );
  });

  it('allows multiple rows with same user but different organizations', async () => {
    await withRealDatabase(
      async ({ adapter }) => {
        // Seed parent tables
        await adapter.execute(
          "INSERT INTO users (id, email) VALUES ('user1', 'user1@test.com')"
        );
        await adapter.execute(
          "INSERT INTO organizations (id, name) VALUES ('org1', 'Org One')"
        );
        await adapter.execute(
          "INSERT INTO organizations (id, name) VALUES ('org2', 'Org Two')"
        );

        const now = Date.now();

        // Insert user into org1
        await adapter.execute(`
          INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
          VALUES ('user1', 'org1', ${now}, 0)
        `);

        // Insert same user into org2 - this should work
        await adapter.execute(`
          INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
          VALUES ('user1', 'org2', ${now}, 1)
        `);

        // Verify both rows exist
        const result = await adapter.execute(
          'SELECT * FROM user_organizations ORDER BY organization_id'
        );
        expect(result.rows.length).toBe(2);
        expect(result.rows[0]).toMatchObject({
          user_id: 'user1',
          organization_id: 'org1',
          is_admin: 0
        });
        expect(result.rows[1]).toMatchObject({
          user_id: 'user1',
          organization_id: 'org2',
          is_admin: 1
        });
      },
      { migrations: compositePkMigrations }
    );
  });

  it('allows multiple users in the same organization', async () => {
    await withRealDatabase(
      async ({ adapter }) => {
        // Seed parent tables
        await adapter.execute(
          "INSERT INTO users (id, email) VALUES ('user1', 'user1@test.com')"
        );
        await adapter.execute(
          "INSERT INTO users (id, email) VALUES ('user2', 'user2@test.com')"
        );
        await adapter.execute(
          "INSERT INTO organizations (id, name) VALUES ('org1', 'Org One')"
        );

        const now = Date.now();

        // Insert user1 into org1
        await adapter.execute(`
          INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
          VALUES ('user1', 'org1', ${now}, 1)
        `);

        // Insert user2 into org1 - this should work
        await adapter.execute(`
          INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
          VALUES ('user2', 'org1', ${now}, 0)
        `);

        // Verify both rows exist
        const result = await adapter.execute(
          'SELECT * FROM user_organizations ORDER BY user_id'
        );
        expect(result.rows.length).toBe(2);
      },
      { migrations: compositePkMigrations }
    );
  });

  it('rejects duplicate composite key', async () => {
    await withRealDatabase(
      async ({ adapter }) => {
        // Seed parent tables
        await adapter.execute(
          "INSERT INTO users (id, email) VALUES ('user1', 'user1@test.com')"
        );
        await adapter.execute(
          "INSERT INTO organizations (id, name) VALUES ('org1', 'Org One')"
        );

        const now = Date.now();

        // Insert first row
        await adapter.execute(`
          INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
          VALUES ('user1', 'org1', ${now}, 0)
        `);

        // Attempt to insert duplicate - should fail
        await expect(
          adapter.execute(`
            INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
            VALUES ('user1', 'org1', ${now + 1000}, 1)
          `)
        ).rejects.toThrow(/UNIQUE constraint failed|PRIMARY KEY constraint/);
      },
      { migrations: compositePkMigrations }
    );
  });

  it('cascade deletes work correctly', async () => {
    await withRealDatabase(
      async ({ adapter }) => {
        // Seed parent tables
        await adapter.execute(
          "INSERT INTO users (id, email) VALUES ('user1', 'user1@test.com')"
        );
        await adapter.execute(
          "INSERT INTO organizations (id, name) VALUES ('org1', 'Org One')"
        );

        // Insert into junction table
        await adapter.execute(`
          INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
          VALUES ('user1', 'org1', ${Date.now()}, 0)
        `);

        // Verify row exists
        let result = await adapter.execute('SELECT * FROM user_organizations');
        expect(result.rows.length).toBe(1);

        // Delete the user - should cascade delete the junction row
        await adapter.execute("DELETE FROM users WHERE id = 'user1'");

        // Verify junction row was deleted
        result = await adapter.execute('SELECT * FROM user_organizations');
        expect(result.rows.length).toBe(0);
      },
      { migrations: compositePkMigrations }
    );
  });
});
