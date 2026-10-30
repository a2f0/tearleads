# Device-First Reads, Writes & Background Reconciliation

The `tearleads.deviceFirst` facade (`client/deviceFirst/`) provides one
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
  of remote I/O, draining a priority queue over `DomainSyncCoordinator` lanes.

`DeviceFirstProvider` shares all three with the app; mini-apps neither reopen
the tree nor drive discovery from render effects.

## Device-first invariant

`ready` is a pure function of **local hydration** — never of auth, network, or
remote sync. First paint renders the full container tree and the active
container's document list from the local SQLite/OPFS projection. Auth-gain,
online-regain, and WS events are *reconcile-in-place* signals, not resets: the
already-visible list is patched with fresh data rather than blanked and
re-fetched.

Local reads are network-free. `workflows/container-contents/documentQueries/`
(`listContainerItemWindow`, `loadDocumentSummary`,
`listContainerDocumentSidebarWindow`) reads purely from SQLite, and the
projection it reads is authoritative for first paint.

Ordinary container topology/metadata writes resolve after local persistence and
durable queueing; document-store edits follow the same rule. Operations that
need remote authority — sharing, purging, remote-container deletion, and an
explicitly synchronous system-container probe — await the network.

Nullable container windows and `hasOrphanedDocuments` expose and gate orphan
recovery without replacing empty-tree state.

See [offline contract and coverage](#offline-contract-and-coverage) for the
invariants each seam keeps and the tests that enforce them.

## Design: two layers in `client-sdk`

Both layers call data-layer functions from SDK services, never from React
effects.

### Layer A — `LocalProjectionStore`

Module: `client-sdk/src/stores/local-projection/`.

Owns the device-first, synchronously-readable view of a domain scope: the merge
of the container-contents store snapshot (tree) and document summaries.
Holding document summaries in an SDK store lets the SDK guarantee an instant
document list instead of each mini-app re-deriving it.

Snapshot shape (subscribable, immutable):

```ts
interface LocalProjectionSnapshot {
  ready: boolean;                       // local hydration done — never gated on auth/net
  containers: ReadonlyArray<ContainerNode>;
  documentSummariesByContainerId: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}
```

Hydration and key methods:

- Hydration completes once the database is ready and the container store has
  loaded the local tree (`loadLocalContainerStates`); the active container's
  summaries then load from the local projection
  (`loadLocalContainerProjectionDocumentsFromRuntime`). Auth plays no part.
- `getSnapshot()` / `subscribe(listener)` — React-free external store contract.
- `applyReconciled(delta)` — called by Layer B to patch tree/summaries from
  remote results; emits to subscribers.
- `updateRuntime(runtime)` — on `dbStatus` loss, or a new executor or domain
  scope, resets the projection (storage is gone or replaced). A regained sync
  prerequisite (auth, connectivity, or key pair) does **not** reset; it signals
  Layer B to reconcile in place.

### Layer B — `ReconciliationService`

Module: `client-sdk/src/sync/reconciliation/` (`service.ts`, `queue.ts`,
`triggers.ts`, and the backfill and probe helpers beside them).

The sole owner of remote reconciliation. It wraps `DomainSyncCoordinator`
(which provides prioritized lanes, offline tolerance, and idle waiting) and adds
a priority queue and policy, with the rule that nothing it does is awaited by
the UI. Its discovery lane runs in the `"document"` phase, which the
coordinator ranks after `"structural"` container hydration/metadata, so the
tree reconciles before document discovery.

```ts
interface ReconciliationService {
  start(): void;                         // idempotent; wires coordinator + triggers
  setActiveContainer(containerId: string | null): void;  // re-prioritize
  enqueueContainer(containerId, priority: "active" | "idle", force?, documentId?): void;
  enqueueIdleBackfill(): void;           // known-container catch-up
  resetDiscovered(): void;               // re-arm after reconnect/relogin
  reconcileRootContainersNow(o?: { freshListing?: boolean }): Promise<void>;
  reconcileNow(o?: { freshListing?: boolean }): Promise<void>;  // explicit "Refresh"
  stop(): void;
}
```

Work items and the functions that perform them:

| Work item | Implementation |
| --- | --- |
| container hydration | `hydrateRemoteContainers` / `requestRemoteHydration` |
| document discovery | `discoverContainerDocumentLanes` (batched, per-container) |
| metadata sync | `syncContainerMetadataState` |
| writer projection | `assertDocumentWriterProjectionConsistent` (on document sync) |

Scheduling policy (active-first, then idle backfill):

1. On local hydration, enqueue the active container at active priority. On
   auth-gain / online-regain, also reset the session suppression set and enqueue
   all other known containers at idle priority.
2. The active container reconciles first (background, post-paint). Its results
   `applyReconciled` into Layer A, patching the list in place with no re-blank.
3. Idle priority drains as the coordinator goes quiet
   (`coordinator.waitForIdle` boundary), so the active view freshens first and
   siblings catch up without a thundering herd.
4. A cold recovery can finish remote tree hydration after its first backfill
   was scheduled. Newly remote-backed container ids re-arm idle backfill so
   recovered Contacts/Trash and organization metadata are not skipped.
5. WS `document_update_created` and `document_mutation_created` hints enqueue
   their affected containers at active priority. Structural link/unlink hints
   always re-list both the previous and current container lanes, while purge
   hints re-list every lane that owns the committed tombstone. Attachment
   bind/detach hints revalidate every currently linked lane. These publications
   are best-effort after commit: a broker failure never changes the successful
   HTTP mutation result, and later HTTP reconciliation remains authoritative.

#### Document content pull policy

The reconciliation service owns discovery scheduling; registered document
stores own encrypted content sync and attachment hydration. Hint-driven
reconciliation passes `force` and `documentId` to the content puller, and hints
merge their targets into one trailing pass that revalidates only the named
registered stores. A full force without a target, including Refresh and
reconnect, revalidates every registered store. Ordinary discovery does not open
every document.

Three bounded probes close gaps that container discovery cannot observe:

- after the initial idle discovery sweep, the reconciler pages an authoritative
  unwatermarked listing for every known remotely listable container. It then
  opens locally persisted, visible remote documents linked to those completed
  lanes — including shared containers from another organization — but absent
  from every full listing. An empty early tree does not complete the pass, and
  remote-container growth while it settles restarts its candidate cursor.
  Once the first non-empty pass completes, later user-created containers do not
  reopen it. Hidden system documents keep their specialized sync paths. Listing
  failures receive three short, backed-off attempts; a lane that remains
  unlistable is skipped for that service lifecycle. Each low-priority candidate
  turn scans up to 64 local rows but opens at most eight stores, so a restored
  replica converges old remote deletions without monopolizing the sync
  coordinator. Progress survives reconnects within the service lifecycle. The
  completion marker is deliberately not durable, because a local backup restore
  can replace document rows underneath the runtime; the cost is one
  unwatermarked listing per remotely listable container on every service
  launch;
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

A socket opens with no server-side container interest, and the server keeps no
copy of a closed socket's set. The client waits while the local container tree
is `ready=false`; its placeholder empty node list is never declared.
`known_containers_ack` follows installation of the authorized subset. It also
acknowledges denied stale IDs so reconnect reconciliation can run.

All three probes use normal document sync: verified Loro updates are projected
before attachments and blob bytes hydrate. A coded `document_not_found` fetches
a signed purge proof; the SDK verifies it before local destruction. Proofs
include signed history for recorded document readers; others receive a terminal
snapshot. The SDK authenticates before reading local pins and verifies this
single response. Deletion needs an exact pin or signed transitions from a pin
or genesis. Later container pins fail closed: their order relative to the purge
is unsigned. Missing history without a local pin defers deletion without an
incident; bare 404s remain non-destructive, and 403s keep normal parking
behavior. The same coded-404 path completes a purge whose successful POST
response was lost. After the initial missing-listing convergence pass, ordinary
documents that have never been opened remain lazy until a document window,
explicit registered-store revalidation, or other owning workflow opens them.

Remote document discovery requires a current metadata document for every
container. Local-first roots, regular folders, and system slots are never sent
to the document listing before their remote create commits; the document
lane rechecks this after structural hydration because a queued pre-auth root
can be replaced in the meantime. When the same local id becomes
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

An additional organization starts with local-only billing. Provisioning
commits its initial roster and organization-profile bodies atomically with
their manifests, so another authorized session can recover the seed history
and display the organization name immediately; later profile edits follow
normal billing eligibility. The provisioning response acknowledges every
committed seed update, which the client persists as settled, and acknowledged
profile-document heads seed discovery evidence
([document links](document-links.md)).

All results flow into Layer A, never back to React directly. The service has no
React imports; `bun run lint:architecture` enforces this.

### Public SDK surface

`tearleads.deviceFirst.open(options?)` returns one cached
`DeviceFirstContainerContents` per scope: `containerStore` owns local tree
mutations, `view` (`LocalProjectionView`) owns the subscribable read
projection, and `reconciler` (`ReconciliationService`) owns background
discovery. `dispose()` stops every scope's reconciler.

## App-side consumption ([`packages/app`](../../packages/app/))

The app subscribes rather than orchestrating network:

- `DeviceFirstProvider.tsx` opens the shared device-first scope once and owns
  runtime propagation for its container store and local projection.
- `ExplorerProvider.tsx` consumes the shared store and view.
- `useExplorerViewProjectionSync.ts` calls
  `view.setActiveContainer(activeContainerId)`, which drives Layer B priority,
  and surfaces the active container's summaries from the `LocalProjectionView`
  snapshot into the Explorer view model.
- `useExplorerInteractionState.ts` runs Refresh through
  `reconciler.reconcileNow()` and open-time catch-up through
  `reconciler.reconcileRootContainersNow()`.

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

The Organizations dashboard reads the same shared container store and lists
every organization present in the local tree, including one reached only
through a folder shared from beneath an unreachable root. A card's folders are
the containers whose parent is not local, the rule Explorer uses for its
top-level rows. Names come from `listLocalOrganizations`, which reports a null
`rootContainerId` for an organization reached without its root.

## Why first paint is device-first (trace)

Already-registered user opens Explorer:

1. `open().view` returns a projection hydrated from SQLite; `ready=true`.
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
2. The store persists the change and its `local_intents` row, then notifies.
3. The promise settles without waiting for HTTP; the sync lane converges later.

A device-first document or folder whose whole content is one queued update
sends it with its create ([create seed](../document-link-and-sync-protocol.md)).
Eager system-container creates are not seeded.

## Scope boundaries

- Layer A is cached per `DomainScope` in a `WeakMap` (like
  `containerContentsStoresByScope`), and the facade keeps one reconciler per
  scope until `dispose()`, so identity/db changes rotate cleanly.
- The instant document list relies on summaries being persisted on discovery
  (`upsertDiscoveredDocuments` writes `document_projection`); local-only
  documents land there via the documents store, so the cache is authoritative.
- Ordinary per-document Loro content stays lazy in the `documents` sync lane.
  Layer B only primes content that cannot rely on a document window opening it
  (remote system-container projections), while it reconciles the container tree
  plus document summaries/links for every known lane.

## Offline contract and coverage

Local reads use persisted content. A remote document or attachment that has
never been downloaded still requires connectivity to obtain its bytes. Loading
the application bundle and initializing the platform's local database are
separate from the SDK's network-free read contract. Sharing, peer-key
lookup/import, link/unlink of remotely synced documents, organization
provisioning, and permanent remote deletion are explicit online operations;
moving a document, including to Trash, queues its remote link-set work
durably. Background reconciliation can issue requests when online, but local
first paint and ordinary persistence never wait for it. A failed SQLite or blob
write is still an operation failure.

| Seam | Invariant | Enforced by |
| --- | --- | --- |
| Local document projection | Persisted creations and edits reload affected local views from SQLite without remote reconciliation; reopening a folder refreshes its cache. | `client/deviceFirst/offline.test.ts` |
| Local read completion | Reads superseded by deletion or reconciliation are discarded; ordinary reads publish before a coalesced trailing refresh, so autosaves cannot starve the view. | `localProjectionStore.races.test.ts` |
| Database replacement | Replacing the adapter or domain resets summary caches and pending reads; an old read cannot publish into the replacement. | `localProjectionStore.races.test.ts` |
| Projection notification | Change detection covers links and every summary field. | `localProjectionStore.races.test.ts` |
| Self-contact bootstrap | Self-key resolution stays local; remote duplicate cleanup runs outside the contact write queue, keeps duplicates until an authorized purge succeeds, retries on reconnect, and keeps edits on the retained self contact. | `contactStore.offline.test.ts`, `contactStore.cleanupSettlement.test.ts`, `contactStore.importDuringCleanup.test.ts` |
| Container mutation queue | Explicit online work is serialized apart from ordinary folder writes; never-synced folder deletion stays local; system-folder probes watch only their slot. | `containerLocalWritesDuringProbe.test.ts`, `ensureSystemContainerDeviceFirst.test.ts` |
| System bootstrap | System-folder creation and icon correction go through the local queue. | `systemContainerBootstrap.offline.test.ts` |
| Document rotation | One remote operation runs per live document lane, the local queue is held only for the checked installation, and generation guards exclude replaced runtimes and database resets. | `rotationCoordinatorLiveness.test.ts`, `rotationConcurrentEdits.test.ts`, `rotationRecoveryGuards.test.ts` |
| Offline edit then Trash | Rotation repeats the full raw-history proof for a changed queue, at most three attempts per invocation, and retains durable work for a later retry. | `rotationConflictRetry.test.ts` |
| Share racing a rename | Serialized, guarded metadata writes preserve both the rename and the grant. | `shareRenameRace.test.ts` |

`DeviceFirstOfflineRequestVolume.test.tsx` registers online, caches a note,
disconnects, and requires zero requests to create a folder, edit the cached
note and navigate away and back, and move the note to Trash. After reconnect it
requires the remote folder creation and the queued link and unlink, with the
edited note in Trash.

## Privacy-safe reconciliation diagnostics

The System Monitor clipboard allowlist exposes only bounded states and counts
for this recovery path: `interest declaration acknowledged`, revalidation
scheduled for `startup` or `reconnect`, and revalidation result `applied` with
incoming-update/attachment-slot counts or `unavailable`. It deliberately omits
document and attachment identifiers, titles, names, structured fields, blob
bytes, keys, and all decrypted customer content.
