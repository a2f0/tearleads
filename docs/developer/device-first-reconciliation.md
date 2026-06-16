# Device-First Reads & Background Reconciliation

Status: **proposed** (design for review)
Owner lane: `packages/client-sdk` (primary), `packages/app` (consumer simplification)

## Problem

Opening `mini-apps/explorer` immediately after deriving a key pair and registering
produces a burst of network I/O and a visible delay, even though every byte the
first paint needs is already on the device (SQLite `document_projection` +
container rows, OPFS blobs).

Three structural causes, all rooted in **one missing seam**: there is no
background reconciliation service, so the React tree *is* the sync orchestrator.

1. **Auth-gain wipes the local projection.**
   `stores/container-contents/state.ts:162-167` — when `isAuthenticated`
   flips `false→true` (exactly what register+login does), it calls
   `resetContainerContentsStore`, clearing `containersById` and setting
   `snapshot.ready = false`. The tree must then re-read SQLite before it can
   paint. Guaranteed blank-then-reload flash.

2. **Document discovery is a render-driven network effect.**
   `app/.../useDiscoveredDocumentsSync.ts:537-559` — the instant
   `activeContainerId` is set + db ready + online + authed, it fires a paginated
   `GET /containers/{id}/documents` loop (`discoverContainerDocuments`), plus
   link-batch writes, watermark writes, and principal-policy caching, on the
   first-paint path.

3. **Metadata sync + writer-projection fetches** ride the same eagerly-triggered
   container sync lane (`stores/container-contents/syncAgent.ts:381-388`).

The local read path already exists and is network-free:
`workflows/container-contents/documentQueries.ts`
(`listContainerItemWindow`, `loadDocumentSummary`, `listContainerDocumentSidebarWindow`)
read purely from SQLite. The app just does not *trust* the cache as authoritative
for first paint — it renders from cache **and** races a network discovery, then
merges.

## Goals (locked decisions)

- **First paint:** full container tree **and** the active container's document
  list render synchronously from the local SQLite/OPFS projection, with **zero
  network on the critical path**.
- **Reconcile policy:** active-container-first in the background after paint,
  then idle backfill of the rest.
- **Migration:** replace in place (greenfield), no feature flag.
- **`ready` invariant:** `ready` is a pure function of **local hydration**, never
  of auth, network, or remote sync. Auth-gain is a *reconcile-in-place* signal,
  not a reset.

## Design: two new layers in `client-sdk`

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
  │   Layer B: ReconciliationService  (background-ish)           │
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
   existing: DomainSyncCoordinator, container-contents store,
             documentQueries (local SQL), documentDiscovery (remote),
             syncContainerMetadataState, writer projection verify
```

These are **new orchestration seams**, not a rewrite of the data layer. The
existing local-SQL queries and the existing remote-discovery/metadata/projection
*functions* are kept and called from the new owners. What changes is **who calls
them and when**: a background service instead of `useEffect`s.

### Layer A — `LocalProjectionStore`

New module: `client-sdk/src/stores/local-projection/`.

Responsibility: own the device-first, synchronously-readable view of a domain
scope. It is the merge of what is today split between the container-contents
store snapshot (tree) and the app's `useExplorerDocumentSummaryState` (doc
summaries). Bringing document summaries into an SDK store is what lets the SDK
guarantee "doc list instant", instead of the app re-deriving it per mini-app.

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
  Sets `ready = true` when local load completes — **independently of auth**.
- `getSnapshot()` / `subscribe(listener)` — React-free external store contract.
- `applyReconciled(delta)` — called by Layer B to patch tree/summaries from
  remote results; emits to subscribers.
- `updateRuntime(runtime)` — on `dbStatus` loss → reset to `ready:false`
  (legitimate: storage gone). On **auth-gain → do NOT reset**; instead notify
  Layer B to reconcile in place. This is the direct fix for cause #1.

Cache key: `WeakMap<DomainScope, LocalProjectionStore>` (mirrors existing
`containerContentsStoresByScope`).

### Layer B — `ReconciliationService`

New module: `client-sdk/src/sync/reconciliation/`.

Responsibility: the "background-ish service" — sole owner of remote reconciliation.
Wraps the existing `DomainSyncCoordinator` (it already does prioritized lanes,
offline tolerance, idle waiting). The service adds a **priority queue and policy**
on top, and the rule that **nothing it does is awaited by the UI**. Its discovery
lane registers in the existing `"document"` phase, which the coordinator already
ranks after `"structural"` container hydration/metadata — so the tree reconciles
before document discovery without inventing a new phase.

```ts
interface ReconciliationService {
  start(): void;                         // idempotent; wires coordinator + triggers
  setActiveContainer(containerId: string | null): void;  // re-prioritize
  reconcileNow(): Promise<void>;         // explicit user "Refresh"
  onRemoteEvents(events: ReadonlyArray<unknown>): void;   // WS frontier
  stop(): void;
}
```

Work items (each maps to an existing function, now lane-scheduled here):

| Work item              | Existing implementation reused                                  |
|------------------------|------------------------------------------------------------------|
| container hydration    | `hydrateRemoteContainers` / `requestRemoteHydration`            |
| document discovery     | `discoverContainerDocuments` (per container, watermark-based)   |
| metadata sync          | `syncContainerMetadataState`                                    |
| writer projection      | `assertDocumentWriterProjectionConsistent` (on document sync)   |

Scheduling policy (active-first, then idle backfill):

1. On `hydrated`/`auth-gain`/`online-regain`: enqueue active container at high
   priority; enqueue all other known containers at idle priority.
2. Active container reconciles first (background, post-paint). Its results
   `applyReconciled` into Layer A → list patches in place, no re-blank.
3. Idle priority drains as the coordinator goes quiet
   (`coordinator.waitForIdle` boundary), so a freshly-registered user sees the
   active view freshen first and siblings catch up without a thundering herd.
4. WS `document_update_created` → enqueue affected container at high priority
   (replaces the event-frontier logic now living in
   `useDiscoveredDocumentsSync`).

All results flow **into Layer A**, never back to React directly. The service has
no React imports (enforced by the existing lane rules + dependency-cruiser).

### Public SDK surface

A **new top-level facade `tearleads.deviceFirst`** (it spans containers +
documents, so it does not belong under `containerContents`). New module:
`client/deviceFirst.ts`, constructed in `Tearleads.ts` like the other facades.

```ts
// client/deviceFirst.ts  →  tearleads.deviceFirst
interface DeviceFirst {
  openView(options?): LocalProjectionView;   // Layer A handle (snapshot + subscribe + setActiveContainer)
  reconciler(): ReconciliationService;       // Layer B handle
}
```

`LocalProjectionView` is the app-facing read handle (snapshot + subscribe +
`setActiveContainer` passthrough). The app never imports the store/service
internals — only `tearleads.deviceFirst` returns and their exported *types*. The
legacy `containerContents` methods `openTree`, `discoverContainerDocuments`,
`refreshAllContainerDocuments`, `hasUnseenDocumentUpdates` become internal to the
new owners or are removed (greenfield); `containerContents` keeps mutation
methods (create/move/rename/share) and info loaders that aren't part of the
read/reconcile seam.

## App-side simplification (`packages/app`)

The app gets **thinner** — it stops orchestrating network:

- **Delete** `stores/explorer/useDiscoveredDocumentsSync.ts` (render-driven
  discovery — its event-frontier + active-container logic moves into Layer B).
- **Delete** the network half of `useExplorerInteractionState.ts`; keep only a
  thin `handleRefresh` that calls `reconciler().reconcileNow()`.
- **Collapse** `useExplorerDocumentSummaryState.ts` + `useExplorerDocumentViewModel.ts`
  to read summaries from the `LocalProjectionView` snapshot instead of issuing
  their own queries and merging discovery output.
- `ExplorerProvider.tsx`: replace `openTree(...)` with `openDeviceFirstView(...)`;
  call `view.setActiveContainer(activeContainerId)` (drives Layer B priority).
- `useExplorerRefreshAction.ts`: simplify to await `reconcileNow()`.

Net: `packages/app/src/stores/explorer/` loses ~3-4 orchestration files and the
mini-app reads one subscribable view.

## Why this is correct device-first (trace)

Already-registered user opens Explorer:

1. `openDeviceFirstView()` returns a store that has hydrated (or hydrates
   synchronously-enough) from SQLite. `ready=true` from **local** load.
2. First paint: tree + active container's document summaries from the snapshot.
   **No network awaited.**
3. `setActiveContainer(id)` tells Layer B to reconcile `id` first, in the
   background. WS/auth/online triggers feed the same queue.
4. Reconciled deltas `applyReconciled` → snapshot patch → React re-renders the
   already-visible list with fresh data. No reset, no flash.

Freshly-registered user: registration persists the root + metadata locally
(`persistRegistrationBootstrap`), so step 1 finds the root container; auth-gain
no longer wipes it (cause #1 fixed); discovery for the active container happens
in the background (cause #2/#3 fixed).

## Migration order (each step independently green)

1. **Layer A scaffold** — `LocalProjectionStore` + types + `WeakMap` cache +
   hydrate-from-SQLite (reuse `loadLocalContainerStates` + projection queries).
   Unit tests: hydrates from cache without network; `ready` independent of auth.
2. **Layer B scaffold** — `ReconciliationService` over `DomainSyncCoordinator`,
   wrapping existing discovery/metadata/hydration functions; priority queue +
   policy. Unit tests: active-first ordering; idle backfill; WS enqueue.
3. **Facade wiring** — add `openDeviceFirstView` / `reconciler`; keep old methods
   temporarily importable to keep app compiling between steps.
4. **App switch** — `ExplorerProvider` + interaction hooks consume the view;
   delete render-driven discovery. Update/replace
   `useExplorerDiscoveryEffects.test.tsx` (its scenarios become Layer B tests).
5. **Auth-gain reset removal** — change `updateContainerContentsStoreRuntime`
   (or its Layer A equivalent) so auth-gain reconciles in place. Targeted test:
   auth false→true does not blank or re-fetch.
6. **Greenfield cleanup** — remove now-dead `openTree`/discovery facade methods,
   dead app files. Run `lint:knip:production` + `lint:architecture`.
7. **Docs/export ritual** — update `client-sdk/package.json`,
   `src/index.ts`, `workflows/README.md`, and `docs/developer/client-sdk.md`
   together (AGENTS.md requirement).

## Test plan

- **client-sdk unit/integration:**
  - LocalProjectionStore: ready-from-cache-without-network; auth-gain no reset;
    `applyReconciled` patches + emits.
  - ReconciliationService: active-first priority; idle backfill drains; WS event
    enqueues affected container; offline → no-op; explicit `reconcileNow`.
  - Port the meaningful scenarios from `useExplorerDiscoveryEffects.test.tsx`
    (event frontier, scoped-to-container, in-flight reuse) to the service.
- **app:**
  - `ExplorerProvider.test.ts`: first render shows cached tree+docs with a
    mocked API that asserts **no discovery call on mount**.
  - Refresh action awaits `reconcileNow`.
- **regression:** `bun run check:affected`, then `bun run check`.
- **architecture:** `bun run lint:architecture`,
  `bun run lint:knip:production`, `bun run lint:source-shape`.

## Risks / watch-items

- **Source-shape budgets:** new files must stay under line/byte limits; split
  Layer B into queue / policy / triggers modules from the start.
- **DomainScope rotation:** both layers must key off `DomainScope` exactly like
  today (`WeakMap`) so identity/db changes rotate cleanly.
- **Document summaries authority:** "doc list instant" assumes summaries are
  persisted on discovery (they are — `upsertDiscoveredDocuments` writes
  `document_projection`). New local-only docs already land there via the
  documents store, so the cache is authoritative.
- **Loro document content** is out of scope; this design covers container tree +
  document *summaries/links* reconciliation. Per-document content sync keeps its
  existing `documents` sync lane, now triggered by Layer B priming rather than
  app effects.
