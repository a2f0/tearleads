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

## Related Client Integration Baselines

These client tests are the closest user-facing baselines for Bob/Alice sharing regressions (instance switching, rematerialization, and note-body visibility in Notes UI):

| Client scenario | File | What it verifies |
|-----------------|------|------------------|
| Instance switch + shared-note sync feed continuity | `packages/client/src/lib/api.msw.instanceSwitchSharedNoteSync.test.tsx` | Bob remains authenticated after switching Alice -> Bob instance and can still read Alice's CRDT `item_upsert` from server feed |
| Instance switch + rematerialization + rendered note body | `packages/client/src/lib/api.msw.instanceSwitchRematerialization.test.tsx` | Bob/Alice scaffolded share rematerializes into Bob local DB and renders updated note content in `@tearleads/notes` (`NotesWindowDetail`) |
| Scaffolded feed hydration/rematerialization edge cases | `packages/client/src/lib/api.msw.scaffoldMaterialization.test.tsx` | Local read-model hydration from scaffolded sync + CRDT pages, including rematerialization fallback behavior |
| Bootstrap retry/error handling for rematerialization | `packages/client/src/components/VfsRematerializationBootstrap.test.tsx` | UI bootstrap behavior around rematerialization retries/failures so warnings/errors are surfaced predictably |

## Runtime-Switch Scenario Matrix

This matrix maps issue `#2959` runtime-switch invariants to the suites we keep hardened:

| Scenario | Primary suite(s) | Invariant |
|----------|------------------|-----------|
| Bob -> Alice -> Bob instance flips while preserving shared-note visibility | `packages/client/src/lib/api.msw.instanceSwitchSharedNoteSync.test.tsx`, `packages/client/src/lib/api.msw.instanceSwitchRematerialization.test.tsx` | No stale reads from prior instance after switch commit; shared content remains visible |
| Rematerialization bootstrap and retry paths | `packages/client/src/components/VfsRematerializationBootstrap.test.tsx`, `packages/client/src/lib/api.msw.scaffoldMaterialization.test.tsx` | No silent data loss when rematerialization or feed paging hits transient errors |
| API-level multi-actor share/write convergence | `packages/bob-and-alice/src/scenarios/sharedNoteEditSync.test.ts`, `packages/bob-and-alice/src/scenarios/apiVfsLifecycle.test.ts` | Cross-actor writes are accepted and reflected after flush/sync without stale instance side effects |

## Hardened Suite Commands

Run from repo root:

```bash
# Bob/Alice API scenario suite with strict console guardrails (CI parity)
pnpm --filter @tearleads/bob-and-alice testCi

# Bob/Alice coverage gate
pnpm --filter @tearleads/bob-and-alice test:coverage

# Targeted client runtime-switch/rematerialization baselines
pnpm --filter @tearleads/client test -- src/lib/api.msw.instanceSwitchSharedNoteSync.test.tsx
pnpm --filter @tearleads/client test -- src/lib/api.msw.instanceSwitchRematerialization.test.tsx
pnpm --filter @tearleads/client test -- src/lib/api.msw.scaffoldMaterialization.test.tsx
pnpm --filter @tearleads/client test -- src/components/VfsRematerializationBootstrap.test.tsx
```

## Console Error/Warn Guardrails

`@tearleads/bob-and-alice` preloads `src/test/consoleGuard.ts` in both `test` and `testCi`. The guard fails tests when `console.warn`/`console.error` match `src/test/consoleGuardPatterns.ts`, including:

- `VFS rematerialization bootstrap failed`
- `Initial VFS orchestrator flush failed`
- `transport returned invalid hasMore`
- `page.items is undefined`

This keeps Bob/Alice scenario coverage fail-closed for the same rematerialization/transport regressions tracked in issue `#2959`.

## Running Tests

```bash
pnpm --filter @tearleads/bob-and-alice test
```

## Design Decisions

- **In-memory server:** Uses `InMemoryVfsCrdtSyncServer` instead of requiring a running PostgreSQL instance. Server `snapshot()` provides the same semantic assertions.
- **Deterministic timestamps:** Uses a counter-based timestamp factory for reproducible CRDT ordering across test runs.
- **No React rendering:** `ActorHarness` operates directly on SQLite and the sync client. React rendering can be layered on later.
