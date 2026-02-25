# @tearleads/remote-read-orchestrator

`@tearleads/remote-read-orchestrator` provides scoped remote-read coordination primitives for API-backed sync loops.

## What It Solves

- Serializes remote reads in FIFO order per scope when needed.
- Coalesces in-flight reads by default so duplicate triggers share one request.
- Debounces bursty triggers (for example SSE cursor-bump storms) into a single read.
- Supports cancellation for in-flight operations through `AbortSignal`.

## API

- `RemoteReadOrchestrator`
  - `schedule(operation, options?)`
  - `drain(scope?)`
  - `cancelInFlight(scope?)`

### Options

- `scope?: string` default `remote-read-default`
- `debounceMs?: number` default `0`
- `coalesceInFlight?: boolean` default `true`

## Example

```ts
import { RemoteReadOrchestrator } from '@tearleads/remote-read-orchestrator';

const remoteReads = new RemoteReadOrchestrator<void>();

await remoteReads.schedule(
  async ({ signal }) => {
    await syncTransport.pullOperations({
      signal
    });
  },
  {
    scope: 'vfs:user-123:client-desktop',
    debounceMs: 100
  }
);
```

## Testing

```bash
pnpm --filter @tearleads/remote-read-orchestrator test
```
