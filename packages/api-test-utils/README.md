# @tearleads/api-test-utils

Testing utilities for API integration tests in the Tearleads monorepo.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Package Exports

| Export | Description |
| --- | --- |
| `createPglitePool`, `PglitePool` | In-process PostgreSQL-compatible pool backed by PGlite |
| `createRedisMock`, `RedisMockClient` | Lightweight Redis mock with pub/sub support for tests |
| `seedTestUser` | Helper for creating deterministic test users |
| `createTestContext`, `TestContext` | End-to-end API test harness (pool, Redis mock, app server, reset/teardown helpers) |

## Usage

```typescript
import { createTestContext } from '@tearleads/api-test-utils';

const ctx = await createTestContext(async () => ({
  app,
  migrations
}));

try {
  const response = await fetch(`${ctx.baseUrl}/health`);
  expect(response.ok).toBe(true);
} finally {
  await ctx.teardown();
}
```

## Development

```bash
# Build
pnpm --filter @tearleads/api-test-utils build

# Test
pnpm --filter @tearleads/api-test-utils test

# Test with coverage
pnpm --filter @tearleads/api-test-utils test:coverage
```
