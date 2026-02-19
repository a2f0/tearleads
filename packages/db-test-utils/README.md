# @tearleads/db-test-utils

Database testing utilities for Tearleads integration tests.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

```typescript
import { withRealDatabase, createTestDatabase, seedTestData } from '@tearleads/db-test-utils';

describe('integration tests', () => {
  withRealDatabase((getDb) => {
    it('queries the database', async () => {
      const db = getDb();
      // ... test code
    });
  });
});
```

## Development

```bash
# Build
pnpm --filter @tearleads/db-test-utils build

# Test
pnpm --filter @tearleads/db-test-utils test

# Test with coverage
pnpm --filter @tearleads/db-test-utils test:coverage
```

## SQLite WASM Discovery

`locateWasmDir` supports an explicit override via `TEARLEADS_SQLITE_WASM_DIR`.
When unset, it falls back to workspace path discovery for known sqlite-wasm locations.
