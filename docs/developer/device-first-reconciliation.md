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
  enqueueIdleBackfill(): void;            // known-container catch-up
  resetDiscovered(): void;                // re-arm after reconnect/relogin
  reconcileRootContainersNow(): Promise<void>; // root-lane catch-up
  reconcileNow(): Promise<void>;         // explicit user "Refresh"
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

Contacts additionally subscribes to persisted-document notifications. This is
the bridge from a late recovery pull into an already-initialized Contacts store:
once the encrypted contact body is persisted and projected, the contact enters
the visible snapshot without closing/reopening the mini-app. Organization
switching similarly watches root-set changes and organization-profile
persistence so a user-scoped root-discovery hint updates an already-open
switcher.

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
