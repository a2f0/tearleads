# @tearleads/db-test-utils

Database testing utilities for Tearleads integration tests. Provides an in-process SQLite WASM adapter, test harness lifecycle helpers, data seeding functions, and React wrapper factories so that integration tests can run against a real database without native module compilation.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Package Exports

| Export Path | Description |
|---|---|
| `@tearleads/db-test-utils` | Core utilities: adapter, database lifecycle, key manager, WASM locator, React wrappers, seeding helpers |
| `@tearleads/db-test-utils/seeding` | Seeding-only utilities (PostgreSQL harness account/scenario seeders, VFS seeders, test migrations) |

## Core Concepts

### Database Lifecycle

`withRealDatabase` and `createTestDatabase` manage the full lifecycle of an in-memory SQLite WASM database: initialization, encryption, migration, and cleanup.

```typescript
import { withRealDatabase } from '@tearleads/db-test-utils';
import { users } from '@tearleads/db/sqlite';
import { migrations } from '@tearleads/db/migrations';

it('queries the database', async () => {
  await withRealDatabase(async ({ db, adapter, keyManager }) => {
    // db: Drizzle ORM instance with full schema
    // adapter: raw WasmNodeAdapter for direct SQL
    // keyManager: TestKeyManager with deterministic keys
    await db.insert(users).values({ name: 'Alice' });
  }, { migrations });
});
```

For long-lived access or manual lifecycle control use `createTestDatabase` directly and call `adapter.close()` when done.

### WasmNodeAdapter

`WasmNodeAdapter` implements the `DatabaseAdapter` interface using the same SQLite WASM module (with SQLite3MultipleCiphers encryption) that the web app uses. It runs SQLite WASM directly in Node.js without Web Workers, so tests exercise the real query engine without requiring native SQLite bindings.

Key capabilities:
- Encrypted in-memory databases (AES-256 via SQLite3MultipleCiphers)
- Transaction support (`beginTransaction`, `commitTransaction`, `rollbackTransaction`)
- Re-keying for password-change tests
- JSON-based database export/import for backup/restore testing
- Drizzle ORM connection bridging via `getConnection()`

### TestKeyManager

A deterministic in-memory replacement for the production `KeyManager`. Uses a fixed 32-byte test key so tests are reproducible without IndexedDB or real crypto derivation. Available as a singleton (`getTestKeyManager`) or standalone instance (`createTestKeyManager`).

### React Wrappers

For testing React hooks and components that depend on database context:

```typescript
import { withRealDatabase, createRealDbWrapper, composeWrappers } from '@tearleads/db-test-utils';
import { renderHook } from '@testing-library/react';

it('works with real database', async () => {
  await withRealDatabase(async ({ db }) => {
    const { result } = renderHook(() => useSomeHook(), {
      wrapper: composeWrappers(
        createRealDbWrapper(db),
        ({ children }) => <OtherProvider>{children}</OtherProvider>
      )
    });
    // assert on result.current
  });
});
```

## Seeding Utilities

### SQLite (client-side VFS)

Seed VFS entries for local/client-side database tests:

| Function | Description |
|---|---|
| `ensureVfsRoot(db)` | Ensures the VFS root folder exists |
| `seedFolder(db, options?)` | Creates a folder with a link to its parent |
| `seedVfsItem(db, options)` | Creates a generic VFS registry item |
| `seedVfsLink(db, options)` | Creates a link between two VFS items |

### PostgreSQL (server-side harness)

Seed full user accounts and multi-tenant scenarios against a real PostgreSQL database:

| Function | Description |
|---|---|
| `seedHarnessAccount(client, input)` | Creates a user with credentials, personal org, billing, and optionally VFS onboarding keys |
| `createHarnessActors(client, actors)` | Batch-creates multiple user accounts, returning a `byAlias` lookup |
| `createHarnessOrganization(client, input)` | Creates a shared organization with members and admins |
| `createHarnessGroup(client, input)` | Creates a group within an organization |
| `seedVfsScenario(client, input)` | Composes actors, organizations, and groups into a complete scenario |

### Test Migrations

Pre-built migration sets for common test scenarios:

| Migration Set | Tables Created |
|---|---|
| `commonTestMigrations` | `analytics_events`, `user_settings` |
| `classicTestMigrations` | VFS tables + tags/notes tables for classic workspace tests |
| `contactsTestMigrations` | Contact-related tables |
| `vfsTestMigrations` | Core VFS tables (`vfs_registry`, `vfs_links`) |

## SQLite WASM Discovery

`locateWasmDir` finds the SQLite WASM artifacts (`sqlite3.js` and `sqlite3.wasm`) needed by `WasmNodeAdapter`. Resolution order:

1. `TEARLEADS_SQLITE_WASM_DIR` environment variable (if set and files exist)
2. Walk up from the current directory looking for `packages/db-test-utils/sqlite-wasm` or `packages/client/public/sqlite`

If WASM files are missing, run `./scripts/downloadSqliteWasm.sh` to download them.

## Development

```bash
# Build
pnpm --filter @tearleads/db-test-utils build

# Test
pnpm --filter @tearleads/db-test-utils test

# Test with coverage
pnpm --filter @tearleads/db-test-utils test:coverage
```
