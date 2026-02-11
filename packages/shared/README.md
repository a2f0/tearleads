# @tearleads/shared

Shared TypeScript types and utilities for the Tearleads monorepo.

## Usage

```typescript
import { formatDate, type HealthData } from '@tearleads/shared';

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
