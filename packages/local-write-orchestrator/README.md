# @tearleads/local-write-orchestrator

`@tearleads/local-write-orchestrator` provides a lightweight local write serialization and retry layer for SQLite-facing client writes.

## What It Solves

- Serializes writes in FIFO order for a scope (default: one global SQLite write lane).
- Supports scoped lanes so unrelated domains can write in parallel if desired.
- Retries transient SQLite conflicts (for example `SQLITE_BUSY`, `SQLITE_LOCKED`) with configurable retry limits and delay.

## API

- `LocalWriteOrchestrator`
  - `enqueue(operation, options?)`
  - `drain(scope?)`
- `isDefaultSqliteConflict(error)`

### Options

- `scope?: string` default `sqlite-global-write-lock`
- `maxRetries?: number` default `2`
- `retryDelayMs?: number` default `10`
- `detectConflict?: (context) => boolean`
- `onConflictRetry?: (context) => void`

## Example

```ts
import { LocalWriteOrchestrator } from '@tearleads/local-write-orchestrator';

const writes = new LocalWriteOrchestrator();

await writes.enqueue(async () => {
  await adapter.beginTransaction();
  try {
    await db.insert(myTable).values({ id: '1' });
    await adapter.commitTransaction();
  } catch (error) {
    await adapter.rollbackTransaction();
    throw error;
  }
});
```

## Testing

```bash
pnpm --filter @tearleads/local-write-orchestrator test
```
