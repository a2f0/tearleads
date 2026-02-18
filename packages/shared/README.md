# @tearleads/shared

Shared TypeScript modules for non-UI cross-package reuse.

Use this package for code that should be consumed by multiple packages without pulling in React/UI dependencies:

- domain types and contracts
- validation/type guards
- protocol helpers and serialization logic
- pure utility functions
- platform-agnostic crypto helpers

Do not put React components, styling, or UI providers here. Those belong in `@tearleads/ui`.

## Usage

```typescript
import { formatDate, type HealthData } from '@tearleads/shared';

const formatted = formatDate(new Date());

const health: HealthData = {
  timestamp: formatted,
  uptime: 123.45
};
```

```typescript
import { getRedisClient } from '@tearleads/shared/redis';

const client = await getRedisClient('redis://localhost:6379');
```

## Building

```bash
pnpm --filter @tearleads/shared build
```

## Testing

```bash
pnpm --filter @tearleads/shared test
pnpm --filter @tearleads/shared test:coverage
```
