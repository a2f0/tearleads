# Device-First Reads & Background Reconciliation

The `tearleads.deviceFirst` facade (`client/deviceFirst.ts`) gives the app a
device-first read path: the container tree and the active container's document
list render synchronously from the local SQLite/OPFS projection, with zero
network on the critical path. Remote reconciliation runs in the background and
patches the same view in place.

It is built from two layers in `client-sdk`:

- **Layer A — `LocalProjectionStore`** (`stores/local-projection/`): the
  device-first, synchronously-readable view of a domain scope.
- **Layer B — `ReconciliationService`** (`sync/reconciliation/`): the sole owner
  of remote I/O, draining a priority queue over the existing
  `DomainSyncCoordinator` lanes.

The explorer, contacts, and org-manager mini-apps consume both through the
shared `useContainerContentsDeviceFirst` hook
(`packages/app/src/stores/device-first/`); none of them drive discovery from
render effects.

## Device-first invariant

`ready` is a pure function of **local hydration** — never of auth, network, or
remote sync. First paint renders the full container tree and the active
container's document list from the local SQLite/OPFS projection. Auth-gain,
online-regain, and WS events are *reconcile-in-place* signals, not resets: the
already-visible list is patched with fresh data rather than blanked and
re-fetched.

The local read path is network-free.
`workflows/container-contents/documentQueries.ts`
(`listContainerItemWindow`, `loadDocumentSummary`,
`listContainerDocumentSidebarWindow`) reads purely from SQLite, and the
projection it reads is authoritative for first paint.

## Design: two layers in `client-sdk`

```
            packages/app (React)  ── subscribes only ──┐
                                                       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ client-sdk                                                    │
  │                                                              │
  │   Layer A: LocalProjectionStore   (device-first, sync reads) │
  │     - hydrate-once from SQLite/OPFS per DomainScope          │
  │     - container tree + document summaries snapshot          │
  │     - ready := local hydration complete                     │
  │     - subscribable; patched by reconciler + Loro events     │
  │                                                              │
  │   Layer B: ReconciliationService  (background)               │
  │     - sole owner of remote I/O (discover / metadata /        │
  │       writer projection / container hydration)              │
  │     - work queue over DomainSyncCoordinator lanes           │
  │     - priority: active container → idle backfill            │
  │     - writes results into LocalProjectionStore              │
  │     - triggers: hydrated, auth/online regained, WS events,  │
  │       explicit refresh                                      │
  └──────────────────────────────────────────────────────────────┘
                         │ reuses
                         ▼
   DomainSyncCoordinator, container-contents store,
   documentQueries (local SQL), documentDiscovery (remote),
   syncContainerMetadataState, writer projection verify
```

These are orchestration seams over the existing data layer. The local-SQL
queries and the remote-discovery/metadata/projection functions are called from
the new owners — a background service rather than `useEffect`s.

### Layer A — `LocalProjectionStore`

Module: `client-sdk/src/stores/local-projection/`.

Owns the device-first, synchronously-readable view of a domain scope: the merge
of the container-contents store snapshot (tree) and document summaries.
Bringing document summaries into an SDK store is what lets the SDK guarantee an
instant document list instead of each mini-app re-deriving it.

Snapshot shape (subscribable, immutable):

```ts
interface LocalProjectionSnapshot {
  ready: boolean;                       // local hydration done — never gated on auth/net
  containers: ReadonlyArray<ContainerNode>;
  documentSummariesByContainerId: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}
```

Key methods:

- `hydrate()` — idempotent; loads containers (`loadLocalContainerStates`) and
  document summaries (`listContainerItemWindow`/projection queries) from SQLite.
  Sets `ready = true` when local load completes, independently of auth.
- `getSnapshot()` / `subscribe(listener)` — React-free external store contract.
- `applyReconciled(delta)` — called by Layer B to patch tree/summaries from
  remote results; emits to subscribers.
- `updateRuntime(runtime)` — on `dbStatus` loss, resets to `ready:false`
  (storage is gone). On auth-gain it does **not** reset; it notifies Layer B to
  reconcile in place.

Cache key: `WeakMap<DomainScope, LocalProjectionStore>` (mirrors
`containerContentsStoresByScope`).

### Layer B — `ReconciliationService`

Module: `client-sdk/src/sync/reconciliation/` (`queue.ts`, `service.ts`,
`triggers.ts`).

The sole owner of remote reconciliation. It wraps `DomainSyncCoordinator`
(which provides prioritized lanes, offline tolerance, and idle waiting) and adds
a priority queue and policy, with the rule that nothing it does is awaited by
the UI. Its discovery lane registers in the existing `"document"` phase, which
the coordinator ranks after `"structural"` container hydration/metadata, so the
tree reconciles before document discovery without a new phase.

```ts
interface ReconciliationService {
  start(): void;                         // idempotent; wires coordinator + triggers
  setActiveContainer(containerId: string | null): void;  // re-prioritize
  reconcileNow(): Promise<void>;         // explicit user "Refresh"
  onRemoteEvents(events: ReadonlyArray<unknown>): void;   // WS frontier
  stop(): void;
}
```

Work items (each maps to an existing function, lane-scheduled here):

| Work item              | Implementation reused                                            |
|------------------------|------------------------------------------------------------------|
| container hydration    | `hydrateRemoteContainers` / `requestRemoteHydration`            |
| document discovery     | `discoverContainerDocuments` (per container, watermark-based)   |
| metadata sync          | `syncContainerMetadataState`                                    |
| writer projection      | `assertDocumentWriterProjectionConsistent` (on document sync)   |

Scheduling policy (active-first, then idle backfill):

1. On `hydrated` / auth-gain / online-regain: enqueue the active container at
   high priority; enqueue all other known containers at idle priority.
2. The active container reconciles first (background, post-paint). Its results
   `applyReconciled` into Layer A, patching the list in place with no re-blank.
3. Idle priority drains as the coordinator goes quiet
   (`coordinator.waitForIdle` boundary), so a freshly-registered user sees the
   active view freshen first and siblings catch up without a thundering herd.
4. WS `document_update_created` enqueues the affected container at high
   priority.

All results flow into Layer A, never back to React directly. The service has no
React imports (enforced by the lane rules + dependency-cruiser).

### Public SDK surface

The top-level facade `tearleads.deviceFirst` spans containers and documents, so
it does not live under `containerContents`. It is defined in
`client/deviceFirst.ts` and constructed in `Tearleads.ts` like the other
facades.

```ts
// client/deviceFirst.ts  →  tearleads.deviceFirst
interface DeviceFirst {
  openView(options?): LocalProjectionView;   // Layer A handle (snapshot + subscribe + setActiveContainer)
  reconciler(): ReconciliationService;       // Layer B handle
}
```

`LocalProjectionView` is the app-facing read handle (snapshot + subscribe +
`setActiveContainer` passthrough). The app imports only `tearleads.deviceFirst`
returns and their exported *types*, never the store/service internals.
`discoverContainerDocuments` is driven by the reconciler (Layer B), not the app.
`openTree` remains the path every mini-app uses for tree mutations
(create/move/rename/share) and system-container reads, which are not part of the
read/reconcile seam.

## App-side consumption (`packages/app`)

The app subscribes rather than orchestrating network:

- `ExplorerProvider.tsx` opens the device-first view and calls
  `view.setActiveContainer(activeContainerId)`, which drives Layer B priority.
- `useExplorerDocumentSummaryState.ts` / `useExplorerDocumentViewModel.ts` read
  summaries from the `LocalProjectionView` snapshot.
- `useExplorerRefreshAction.ts` awaits `reconciler().reconcileNow()`.

The mini-app reads one subscribable view.

### Shared hook across mini-apps (explorer, contacts, org-manager)

`stores/device-first/useContainerContentsDeviceFirst.ts` is the shared hook that
opens the per-scope view + reconciler, drives `view.updateRuntime` from an
effect, and routes server events through `enqueueReconciliationForEvents`. The
explorer, contacts, and org-manager providers all call it. Contacts and
org-manager keep their `openTree()` store for tree reads and system-container
mutations, and use the hook for background reconciliation and event routing.

`openView()` and `reconciler()` are cached per `DomainScope` (`WeakMap` in
`client/deviceFirst.ts` + `local-projection/registry.ts`) over the same
per-scope container store. When several mini-apps are open in one scope they
share one read view, one reconciler, and one active-container pointer, so they
coordinate rather than racing divergent copies (asserted in
`Tearleads.constructor.test.ts`). Only the explorer claims the active pointer
(via `useExplorerInteractionState`, driven by user navigation);
contacts/org-manager open the view for instant reads + background reconcile and
never call `setActiveContainer`. Setting the pointer only re-prioritizes the
reconcile queue — idle backfill + event enqueues still cover every known
container — so concurrent pointers cause priority churn but no data loss.

## Why first paint is device-first (trace)

Already-registered user opens Explorer:

1. `openView()` returns a store hydrated from SQLite. `ready=true` from local
   load.
2. First paint: tree + active container's document summaries from the snapshot.
   No network awaited.
3. `setActiveContainer(id)` tells Layer B to reconcile `id` first, in the
   background. WS/auth/online triggers feed the same queue.
4. Reconciled deltas `applyReconciled` into the snapshot, and React re-renders
   the already-visible list with fresh data. No reset, no flash.

Freshly-registered user: registration persists the root + metadata locally
(`persistRegistrationBootstrap`), so step 1 finds the root container; auth-gain
reconciles in place instead of wiping the projection; discovery for the active
container happens in the background.

## Scope boundaries

- Both layers key off `DomainScope` (`WeakMap`), so identity/db changes rotate
  cleanly.
- The instant document list relies on summaries being persisted on discovery
  (`upsertDiscoveredDocuments` writes `document_projection`); new local-only
  docs land there via the documents store, so the cache is authoritative.
- Per-document Loro content is out of scope here: this covers container tree +
  document summaries/links reconciliation. Document content keeps its existing
  `documents` sync lane, triggered by Layer B priming.
