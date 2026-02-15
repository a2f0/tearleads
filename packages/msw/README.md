# @tearleads/msw

Shared MSW handlers for Tearleads tests.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

```typescript
import { handlers, server } from '@tearleads/msw';

// In test setup
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Development

```bash
# Build
pnpm --filter @tearleads/msw build

# Test
pnpm --filter @tearleads/msw test

# Test with coverage
pnpm --filter @tearleads/msw test:coverage
```
