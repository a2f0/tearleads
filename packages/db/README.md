# @tearleads/db

Shared database schema definitions for Tearleads.

## Installation

This package is part of the Tearleads monorepo and is not published independently.

## Usage

```typescript
import { users, notes, contacts } from '@tearleads/db/sqlite';
import { organizations, memberships } from '@tearleads/db/postgresql';
```

## Schema Generation

```bash
# Generate all schemas
pnpm --filter @tearleads/db generate

# Generate SQLite schema only
pnpm --filter @tearleads/db generate:sqlite

# Generate PostgreSQL schema only
pnpm --filter @tearleads/db generate:postgresql
```

## Development

```bash
# Build
pnpm --filter @tearleads/db build

# Test
pnpm --filter @tearleads/db test

# Test with coverage
pnpm --filter @tearleads/db test:coverage
```
