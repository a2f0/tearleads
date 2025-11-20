# @rapid/shared

Shared TypeScript types and utilities for the Rapid monorepo.

## Usage

```typescript
import { formatDate, type HealthData } from '@rapid/shared';

const formatted = formatDate(new Date());

const health: HealthData = {
  timestamp: formatted,
  uptime: 123.45
};
```

## Building

```bash
pnpm build
```
