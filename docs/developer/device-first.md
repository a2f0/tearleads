# Device-First Reads, Writes & Background Reconciliation

The `symcrypt.deviceFirst` facade (`client/deviceFirst.ts`) gives the app one
device-first scope for reads, writes, and reconciliation. The container tree
and active container's document list render synchronously from local
SQLite/OPFS, ordinary container writes commit locally and queue durable sync,
and remote reconciliation patches the same state in the background.

Its public handle joins three parts in `client-sdk`:

- **`ContainerContentsStore`** (`stores/container-contents/`): the shared
  locally durable tree and ordinary container mutation path.
- **Layer A — `LocalProjectionStore`** (`stores/local-projection/`): the
  device-first, synchronously-readable view of a domain scope.
- **Layer B — `ReconciliationService`** (`sync/reconciliation/`): the sole owner
  of remote I/O, draining a priority queue over the existing
  `DomainSyncCoordinator` lanes.

`DeviceFirstProvider` shares all three with the app; mini-apps neither reopen
the tree nor drive discovery from render effects.

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

Ordinary container topology/metadata writes resolve after local persistence and
durable queueing; document-store edits follow the same rule. Remote authority
is unchanged: sharing, purging, remote-container deletion, and an explicitly
synchronous system-container probe may still await the network.

Nullable container windows and `hasOrphanedDocuments` expose and gate orphan
recovery without replacing empty-tree state.

## Design: two layers in `client-sdk`

```text
            packages/app (React)  ── subscribes only ──┐
                                                       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ client-sdk                                                    │
  │                                                              │
  │   ContainerContentsStore         (local writes + tree state)│
  │                 │ shared by                               │
  │                 ▼                                         │
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
  │     - triggers: hydrated, auth/online regained, remote tree │
  │       growth, WS events, explicit refresh                   │
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
  enqueueContainer(containerId, priority, force?): void; // event/active work
  enqueueIdleBackfill(force?: boolean): void; // known-container catch-up/invalidation
  flushPendingUnscopedInvalidation(): void;   // post-hydration invalidation flush
  resetDiscovered(): void;                // re-arm after reconnect/relogin
  reconcileRootContainersNow(): Promise<void>; // root-lane catch-up
  reconcileNow(): Promise<void>;         // explicit user "Refresh"
  stop(): void;
}
```

Work items (each maps to an existing function, lane-scheduled here):

| Work item           | Implementation reused                                         |
|---------------------|---------------------------------------------------------------|
| container hydration | `hydrateRemoteContainers` / `requestRemoteHydration`          |
| document discovery  | `discoverContainerDocuments` (per container, watermark-based) |
| metadata sync       | `syncContainerMetadataState`                                  |
| writer projection   | `assertDocumentWriterProjectionConsistent` (on document sync) |

Scheduling policy (active-first, then idle backfill):

1. On local hydration, enqueue the active container at high priority. On
   auth-gain / online-regain, also reset the session suppression set and enqueue
   all other known containers at idle priority.
2. The active container reconciles first (background, post-paint). Its results
   `applyReconciled` into Layer A, patching the list in place with no re-blank.
3. Idle priority drains as the coordinator goes quiet
   (`coordinator.waitForIdle` boundary), so a freshly-registered user sees the
   active view freshen first and siblings catch up without a thundering herd.
4. A cold recovery can finish remote tree hydration after its first backfill
   was scheduled. Newly remote-backed container ids re-arm idle backfill so
   recovered Contacts/Trash and organization metadata are not skipped.
5. WS `document_update_created` and `document_mutation_created` hints enqueue
   their affected containers at high priority. Structural link/unlink hints
   always re-list both the previous and current container lanes, while purge
   hints re-list every lane that owns the committed tombstone. Attachment
   bind/detach hints revalidate every currently linked lane. These publications
   are best-effort after commit: a broker failure never changes the successful
   HTTP mutation result, and later HTTP reconciliation remains authoritative.

#### Document content pull policy

The reconciliation service owns discovery scheduling; registered document
stores own encrypted content sync and attachment hydration. A forced targeted
container reconciliation carries `force` through `reconcileOneContainer` into
the document-content puller. For ordinary documents, the puller requests remote
sync only from stores already registered in that `DomainScope`; it does not open
every discovered document. System-container documents are opened eagerly once
per observed remote version because their derived projections cannot depend on
a document window.

Three bounded probes close gaps that container discovery cannot observe:

- after the initial idle discovery sweep, the reconciler pages an authoritative
  unwatermarked listing for every known remotely listable container. It then
  opens locally persisted, visible remote documents linked to those completed
  lanes — including shared containers from another organization — but absent
  from every full listing. An empty early tree does not complete the pass, and
  remote-container growth while the pass is still settling restarts its
  candidate cursor so hydration order cannot strand an earlier local-id range.
  Once the first non-empty pass completes, later user-created containers do not
  reopen it. Hidden system documents retain their
  specialized sync paths. Listing failures receive three short, backed-off
  attempts; a lane that remains unlistable is skipped for that service lifecycle
  so it cannot starve successfully listed lanes. Each low-priority candidate
  turn scans up to 64 local rows but opens at most eight stores, so a healthy
  listed prefix advances cheaply and a restored replica converges old remote
  deletions without treating an incremental watermark delta as the full remote
  set or monopolizing the sync coordinator. Progress survives reconnects within
  the service lifecycle. The
  completion marker is deliberately not durable: a local backup restore can
  replace document rows underneath the runtime, and a persisted marker would
  incorrectly skip the restored rows on the next service lifecycle. The tradeoff
  is one unwatermarked listing per remotely listable container on every service
  launch, so initial probe traffic scales linearly with the container count;
- opening a persisted remote document arms an initialization probe. Websocket
  invalidations live only in process memory, so a clean cached snapshot cannot
  prove that no peer committed an update before restart;
- an already-open remote document arms a reconnect probe when it observes a
  newer server-events connection generation. The generation advances only after
  a ready local tree sends its authoritative container-interest declaration and
  the server acknowledges installing it in the live router. It therefore
  survives coalesced connection notifications and retained stores that missed
  the intermediate disconnect, while ordering the probe after interest
  restoration rather than raw socket open.

The reconnect handshake retains the server's persisted baseline while the local
container tree is `ready=false`; its placeholder empty node list is never treated
as an authoritative removal. `known_containers_ack` is sent after in-memory
routing changes and before best-effort persistence, so a later event is either
delivered or causes the in-flight probe's signal sequence to arm a trailing pass.

All three probes use the normal HTTP document-sync response: verified incoming
Loro updates are merged and projected first, then current attachment bindings
and blob bytes are hydrated. Only the existing coded `document_not_found`
response authorizes local destruction; a bare 404 remains non-destructive, and
403s keep the normal read-only suppression or write-bearing parking behavior.
After the initial missing-listing convergence pass, ordinary documents that
have never been opened remain lazy until a document window, explicit
registered-store revalidation, or other owning workflow opens them.

Remote document discovery requires a current metadata document for every
container. Local-first roots, regular folders, and system slots are never sent
to `/containers/:id/documents` before their remote create commits; the document
lane rechecks this after structural hydration because a queued pre-auth root may
have been replaced in the meantime. When the same local id becomes
remote-backed, tree growth re-arms it even if it is still the active container.

Own remote-backed system containers and foreign organization metadata visible
through `read`/`admin` membership are included in automatic sweeps; local-only
slots and write-only foreign system shares are excluded. If the user explicitly
opens a write-shared system folder, a full Refresh still includes that active
container so its registered document stores can retry.
Discovered system document bodies are pulled eagerly once per remote version
because Contacts and organization-profile projections may have no document
window that would open them lazily. The reconciler retains only the latest
observed version per container/document pair, so historical `updatedAt` values
do not accumulate for its lifetime. An explicit Refresh can retry the same
version after a failed pull.

An additional organization deliberately starts with local-only billing. Its
initial roster and organization-profile bodies are committed atomically with
their manifests during provisioning, so another authorized session can recover
the complete seed history and display the organization name immediately. Later
profile edits still follow normal billing eligibility. The provisioning
response explicitly acknowledges every committed seed update; the client
persists those updates as settled, and a response that omits the acknowledgement
does not satisfy the current wire contract. Ordinary document hints wake other
entitled sessions, which eagerly materialize system-document bodies without a
manual Refresh.

All results flow into Layer A, never back to React directly. The service has no
React imports (enforced by the lane rules + dependency-cruiser).

### Public SDK surface

The top-level facade spans containers and documents:

```ts
// client/deviceFirst.ts  →  symcrypt.deviceFirst
interface DeviceFirstContainerContents {
  containerStore: ContainerContentsStore;   // local tree + locally durable writes
  view: LocalProjectionView;                 // Layer A read handle
  reconciler: ReconciliationService;         // Layer B background handle
}

interface DeviceFirst {
  open(options?): DeviceFirstContainerContents;
}
```

`containerStore` owns local tree mutations, `view` owns the subscribable read
projection, and `reconciler` owns background discovery. Legacy `openView()` and
`reconciler()` selectors alias the corresponding `open()` fields; new consumers
use the unified handle.

## App-side consumption (`packages/app`)

The app subscribes rather than orchestrating network:

- `DeviceFirstProvider.tsx` opens the shared device-first scope once and owns
  runtime propagation for its container store and local projection.
- `ExplorerProvider.tsx` consumes the shared store/view and calls
  `view.setActiveContainer(activeContainerId)`, which drives Layer B priority.
- `useExplorerDocumentSummaryState.ts` / `useExplorerDocumentViewModel.ts` read
  summaries from the `LocalProjectionView` snapshot.
- `useExplorerRefreshAction.ts` awaits `reconciler.reconcileNow()`.

### Shared binding across mini-apps (explorer, contacts, org-manager)

`useDeviceFirstBinding.ts` opens the bundle, propagates runtime through `view`
(and its underlying container store), and routes server events. The provider
shares it with Explorer, Contacts, Org Manager, bootstrap, and Trash actions.

`open()` is cached per `DomainScope`; consumers share one mutation store,
projection, reconciler, and active-container pointer. Only Explorer sets that
pointer. It reprioritizes work without changing idle/event coverage.

Persisted-document notifications repaint an open Contacts store after late
recovery. Root-set and organization-profile signals likewise refresh the open
organization switcher.

## Why first paint is device-first (trace)

Already-registered user opens Explorer:

1. `open().view` returns a projection hydrated from SQLite. `ready=true` from local
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

Ordinary container write:

1. The mini-app calls `open().containerStore.moveContainer(...)`.
2. The store persists the change/intent and updates subscribers.
3. The promise settles without waiting for HTTP; the sync lane converges later.

## Scope boundaries

- Both layers key off `DomainScope` (`WeakMap`), so identity/db changes rotate
  cleanly.
- The instant document list relies on summaries being persisted on discovery
  (`upsertDiscoveredDocuments` writes `document_projection`); new local-only
  docs land there via the documents store, so the cache is authoritative.
- Ordinary per-document Loro content remains lazy in the existing `documents`
  sync lane. Layer B only primes content that cannot rely on a document window
  opening it (remote system-container projections), while it reconciles the
  container tree plus document summaries/links for every known lane.

## Privacy-safe reconciliation diagnostics

The System Monitor clipboard allowlist exposes only bounded states and counts
for this recovery path: `interest baseline containers=<count>`, revalidation
scheduled for `startup` or `reconnect`, and revalidation result `applied` with
incoming-update/attachment-slot counts or `unavailable`. It deliberately omits
document and attachment identifiers, titles, names, structured fields, blob
bytes, keys, and all decrypted customer content.
