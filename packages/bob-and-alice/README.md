# @tearleads/bob-and-alice

End-to-end integration tests that simulate two real users (Bob and Alice) exercising the full cryptographic sharing pipeline: CRDT sync operations, server-side state convergence, and local SQLite writes.

## Overview

This is a **private, test-only** package. It is not published.

The package provides reusable harness classes that compose in-memory sync infrastructure with per-actor SQLite databases, allowing integration tests to verify multi-user CRDT behavior without requiring a running PostgreSQL instance or real network transport.

## Architecture

```text
┌─────────────────────────────────────────────────┐
│                ScenarioHarness                  │
│  Orchestrates lifecycle, deterministic clocks   │
├────────────────────┬────────────────────────────┤
│    ActorHarness    │       ActorHarness         │
│    (Alice)         │       (Bob)                │
│  ┌──────────────┐  │  ┌──────────────┐          │
│  │ SQLite DB    │  │  │ SQLite DB    │          │
│  │ SyncClient   │  │  │ SyncClient   │          │
│  │ WriteOrch.   │  │  │ WriteOrch.   │          │
│  │ KeyManager   │  │  │ KeyManager   │          │
│  └──────┬───────┘  │  └──────┬───────┘          │
│         │          │         │                  │
│         └──────┬───┘─────────┘                  │
│                ▼                                │
│        ┌───────────────┐                        │
│        │ ServerHarness │                        │
│        │ (in-memory)   │                        │
│        └───────────────┘                        │
└─────────────────────────────────────────────────┘
```

## Harness Classes

### `ScenarioHarness`

Top-level orchestrator for multi-actor test scenarios.

```ts
const harness = await ScenarioHarness.create({
  actors: [{ alias: 'alice' }, { alias: 'bob' }],
});

const alice = harness.actor('alice');
const bob = harness.actor('bob');

// Use harness.nextTimestamp() for deterministic CRDT ordering
await harness.teardown();
```

### `ServerHarness`

Wraps shared server-side state that all actors push/pull against:

- `InMemoryVfsCrdtSyncServer` for CRDT feed
- `InMemoryVfsBlobCommitStore`, `InMemoryVfsBlobIsolationStore`, `InMemoryVfsBlobObjectStore` for blob lifecycle
- `snapshot()` for server-side assertions

### `ActorHarness`

Per-user local environment encapsulating:

- Own SQLite database via `createTestDatabase()`
- Own `VfsBackgroundSyncClient` + `InMemoryVfsCrdtSyncTransport`
- Own `LocalWriteOrchestrator` for write serialization
- Own `TestKeyManager` for encryption

Key methods: `queueCrdtOp()`, `flush()`, `sync()`, `syncSnapshot()`, `close()`

### Assertion Helpers

- `assertServerHasAclEntry(input)` — verify ACL entry on server
- `assertServerHasLink(input)` — verify parent-child link on server
- `assertServerFeedLength(input)` — verify server feed operation count
- `assertLocalVfsRegistryHas(input)` — verify actor has item in local state
- `assertActorFeedReplayHas(actor, itemId)` — verify actor's feed replay contains item

## Test Scenarios

| Scenario | File | Description |
|----------|------|-------------|
| Note sharing | `noteSharing.test.ts` | Alice creates a note, grants Bob read access, flushes; Bob syncs and sees the shared item |
| Bidirectional sync | `bidirectionalSync.test.ts` | Both actors create items independently, flush, sync, and converge to the same state |
| Conflict resolution | `conflictResolution.test.ts` | Concurrent ACL grants from both actors merge correctly via CRDT semantics |
| Container realtime subscriptions | `containerRealtimeSubscriptions.test.ts` | Actors derive per-container sync channels from local container clocks and only subscribe to newly observed containers after syncing |

## Running Tests

```bash
pnpm --filter @tearleads/bob-and-alice test
```

## Design Decisions

- **In-memory server:** Uses `InMemoryVfsCrdtSyncServer` instead of requiring a running PostgreSQL instance. Server `snapshot()` provides the same semantic assertions.
- **Deterministic timestamps:** Uses a counter-based timestamp factory for reproducible CRDT ordering across test runs.
- **No React rendering:** `ActorHarness` operates directly on SQLite and the sync client. React rendering can be layered on later.
