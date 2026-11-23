# Client Sync Ordering

This document describes the client-side ordering `@tearleads/client-sdk` uses
when a domain has several kinds of queued sync work. It complements the
[wire-protocol documents](./protocol-specification.md) and defines no new HTTP
routes or server transactions.

For one `DomainScope`, the SDK uses one in-process sync coordinator.
[Sync lanes](./glossary/sync.md#sync-lane) drain through a phase barrier:

1. Structural lanes.
2. Up to four [document](./glossary/content.md#document) lanes concurrently.

The structural lane is `container-contents`; each document store has a
`documents:${localId}` lane. Queued structural work drains before queued
document work, and a structural follow-up requested during a structural pass
runs before any queued document pass.

Diagnostics also expose `blob-upload:${blobId}` rows with a `blob` phase. These
are observational upload telemetry, not a third pump phase: the owning document
lane performs the work, and upload callbacks update progress and terminal state.
Manual Sync requests the structural and document owners, never the observational
rows themselves.

The coordinator is non-preemptive. If a document pass has already started, a new
structural request waits for the running document passes to finish and blocks
additional document starts until structural work drains. The ordering guarantee
covers queued work on one client runtime and one domain scope; other devices and
domain scopes synchronize independently and are validated by the server
protocol.

**Watchdog exception.** A lane exceeding its watchdog is abandoned, not
cancelled, so the pump may advance while its tail remains in flight. Its run
token prevents same-lane overlap until that tail settles; later lanes may
overlap it, and the server validates any late writes like concurrent writes
from another device.

Document selection favors remote-revalidation and newly discovered content,
then rotates equally prioritized lanes by their last run, so registration order
does not strand new work behind self-rearming stores. Failed self-rearming
document lanes wait one second independently; healthy document lanes continue.
A queued structural retry retains the phase barrier during its backoff.

## Structural Phase

The `container-contents` lane owns local [container](./glossary/access.md#container)
topology and container metadata state. A pass runs in this order:

1. Sync pending local container create intents.
2. Sync pending local container move intents.
3. Sync container metadata document state.
4. Recover a stale [root](./glossary/access.md#root-container), replay pending document
   placement intents, and prime document stores when needed.

Container creates run before moves so an offline-created destination can exist
remotely before a later move targets it. Document placements replay in this
phase because they may target containers created locally in the same session,
such as Trash. Moves run before document lanes so document creates, document
[Loro updates](./glossary/content.md#loro-update), and [blob](./glossary/content.md#blob)
[attachment binds](./glossary/content.md#attachment-binding) derive their
[writer projections](./glossary/sync.md#writer-projection) from the latest synced
[container path](./glossary/access.md#authorizing-container-path).

These intents wait in one durable local outbox, the `local_intents` table. Each
row belongs to a lane: `container.create`, `container.move`, or
`document.placement` (a document move or link, which coalesce into one intent
per document). A lane holds at most one intent per subject, so a container can
carry a create and a move at once. Every lane shares one replay contract: the
row id is a revision token rewritten on each enqueue or repair, settlement
compares the revision and `updated_at` before acting, and replay runs in
`created_at` order. A placement's extra link targets live in
`document_intent_link_targets`, keyed by that revision. Remote reset deletes the
scoped intents of every lane and re-queues creates for surviving containers.
The principal mutation journal and organization provisioning attempts are not
lanes: they hold signed or serialized requests that must survive a reset, so
they keep their own tables.

When a move is accepted, the lane updates the local snapshot, requests document
sync for the domain, and requests a structural follow-up. Because that follow-up
is structural, it drains before the requested document lanes.

Removing a link [rotates](./glossary/keys.md#rotate) the content key, so it
needs a [full-history rotation proof](./document-rekey-and-audit-history.md):
the document store pulls and verifies the raw history and exports the snapshot
that becomes the unlink's
[rotation baseline](./glossary/keys.md#rotation-baseline). The store proves
before it accepts the unlink and keeps that proof in memory with the version
vector it covers. The replay of the durable intent, including the unlink leg of
a move to Trash, reuses the proof while the store still holds the same local
document at that version vector. A local or pulled change, a discarded or
reloaded document, or a restart proves again. The server stays authoritative:
under the manifest-head lock it refuses a baseline that misses a committed
update with `409 document_unlink_rotation_baseline_stale`, and the replay then
proves again and retries once in the same pass.

Remote container hydration is read/discovery work, not a sync lane. It can prime
local state and schedule the structural lane, but must not write document
content or blob attachment state. One hydration pass, one document discovery
pass, and one document move (its link and unlink legs) each discover the
[organization](./glossary/principals.md#organization) directory once and share
that view; see
[operation recovery batch](developer/current-principal-consumers.md#operation-recovery-batch).
Document syncs scheduled through document stores remain separate operations.

### Discovery watermark order

Each container or document change, including a removal, receives a publication
position as its database transaction commits. The four sources share a counter
because a page can mix live rows and removals, and root discovery crosses
organizations. Deferred triggers increment one counter row and hold its lock
through commit. A rollback also rolls back the counter increment.
Entity timestamps retain their original meaning. See the
[publication migration](../packages/api-shared/drizzle/0004_discovery_order.sql).

Each lane reads its live rows and tombstones in a single SQL statement, so
both come from the same snapshot. Each page orders by publication position and ID.
Existing clients already save and echo both watermark strings. The opaque ID
seals the position, row ID, and highest publication visible to the listing
with authenticated encryption bound to the user, lane and timestamp. A
database-owned key survives API deployments and server-secret rotations.
A saved legacy UUID cursor replays from the start in bounded pages on the new
API. The updated SDK retries from its durable cursor if the server changes
ordering mid-crawl or downgrades a saved publication cursor.
An access recheck sends its parent cursor. The API checks the counter and
reads permissions in one repeatable-read snapshot. A lagging replica leaves
the cursor unchanged. An unsuccessful probe marks the refresh incomplete and
retains the parent lane for the next request.
A repeated folder in one crawl is reapplied when its listing changes.
Parent lanes checkpoint applied pages. A reconnect crawl checkpoints a lane
after draining its continuation pages. Document lanes checkpoint after
applying the complete lane. After a restart, each resumes from its last
durable checkpoint, replaying any intervening pages.
Postgres and PGlite install the same schema. The SQLite client stores the
cursor verbatim. See [API database support](./developer/api-persistence.md#database).

A publication-ordered subtree removal checks access to cached descendants
with bounded document-lane reads. It also checks a leaf whose cached timestamp
is later than its removal. A denial or absence can remove a row only when
it still matches the pre-request snapshot, preserving readable descendants.
Before a confirmed removal commits, SQLite checks the held metadata content
and signed head inside the deletion transaction. It also checks that the
folder’s separately verified placement still matches the checkpoint held
before the access request.
An inconclusive read leaves the page retryable. When a live folder's entity
clock moves backwards, hydration verifies the current signed placement and
requires the listed manifest hash and rechecks the signed checkpoint inside
its local transaction. A folder moved back into a readable path carries a hint
to check its cached descendants when its earlier revocation row survives.
The SDK records the reconciled revocation ID. Removing a child that moved
while the folder was inaccessible requires its own access check. Direct and
group regrants already prune their earlier revocations.
Listings omit older revocations when that path already grants access.
The SDK skips restored-folder reconciliation while its organization is paused.
Publication-ordered document lanes that cover both a live placement and its
unlink observed different snapshots. The SDK retries those lanes from their
last saved cursors before applying any rows. A removal on the retried lane
reaches the signed-head check for locally held placements. Pending discovery
retains this requirement across process restarts. Earlier clients can resume
new cursors. On upgrade, the SDK replays older lanes to consume previously
checkpointed restored-folder hints and document unlinks.

An explicit full refresh requests a lane from the beginning, discarding its
saved cursor for that request. A replica can therefore return a previously
valid removal after a faster replica has already supplied a restored leaf.
If the restored leaf has an older entity timestamp, the device can remove its
local copy until a later delta reaches the restoration publication.

Separate document crawls may still overlap locally. The SQLite generation
tracks trust resets. A crawl already holding an earlier verified placement,
or receiving its earlier listing after a separately checkpointed unlink,
can finish later and restore the old projection.

Deploy the additive database migrations before the API. A populated PostgreSQL
database installs the triggers in one short transaction. Existing writers then
publish immediately while the migrator fills historical rows in batches of 512
and builds the five indexes concurrently. Each batch skips busy rows and
revisits them before indexing. The cutover acquires its metadata
locks together without waiting and retries for up to one minute when writers
are active. Restarting the migrator resumes this
work, including a concurrent index build interrupted before becoming valid.
Fresh installations and PGlite apply the journal directly. See the
[discovery preparation](../packages/api-shared/src/adapters/prepareDiscoveryMigration.ts)
and [historical backfill](../packages/api-shared/drizzle/0005_publish_discovery_order.sql).
Rotate the [discovery key after a database restore](./developer/api-persistence.md#restored-discovery-cursors).
Drain the old API fleet before relying on opaque cursors across consecutive
pages. Alternating old and new servers can restart a multi-page crawl until
the old instances drain. The SDK can arrive before or after the API. A
device running the older SDK benefits from commit-ordered paging when the
API updates, and receives the backwards-clock application fixes when its SDK
updates.

### Container metadata under lost hints

A clean container metadata document skips its read. A pass reads it only when
it has outgoing edits, a pull continuation, or a needs-sync signal, and
[realtime hints](./developer/realtime-hints.md) are that signal. Hints are
lossy. One sent while this client is offline or closed never arrives, and
neither does one sent before it subscribes, such as another device of the same
identity editing a folder this device has just created or registered. Without
recovery such an edit would stay unread until a later hint or local edit named
the same document.

Each container in a listing carries `metadataVersionVector`: the Loro version
vector of every update the server holds for its metadata document, the highest
counter per peer across the document's stored update spans. It changes exactly
when the document gains an update, independent of any clock. Recovery compares
it with the client's own copy:

- Owing a read. When a listing shows a held container whose metadata version
  the local copy does not cover, the document is owed one forced read. The
  client's own edits, seeds, moves and writes into the folder never trigger
  one, because the local copy already covers every update they produced. An
  unreadable version also owes a read, and the rest of the page still
  hydrates.
- Durability. Hydration queues the forced read in memory and then writes it to
  `container_metadata_revalidations`, before the lane watermark advances past
  the row. A store's first sync pass requeues what a previous run still owed,
  and an owed read alone schedules that pass at startup.
- Settling. A completed sync pulls every update the client lacks, so it settles
  the debt, unless a newer signal queued the document while the read was in
  flight. Each request records the version the listing advertised, and a read
  settles it only once the local copy covers that version; a replica lagging
  the listing can answer without the edit, and the debt then waits for a later
  pass. Each request also carries a revision, and a read settles only the one
  it saw before it began, so a newer request from another tab survives. A pass
  that resumes an earlier paginated pull reads only up to that pull's upper
  bound, and a superseded result discarded what it pulled; neither settles,
  and each hands the read to a fresh pass.
- Coverage. A metadata write advances its container's publication position.
  The next delta listing of its lane returns the row. Every acknowledged
  connection re-lists the root lane and every held lane from their
  watermarks, including the first one after a restart or after the store
  opened, so either recovers a lost metadata hint.
- No-brick. The forced read uses the stored commit position as its floor, as
  a hint-forced read does, and never waits on another device.

Ordinary documents need no such debt: opening one probes it, and an
acknowledged reconnect probes every open one (see
[remote pull eligibility](#remote-pull-eligibility)).

## Document Phase

Each document store has its own `documents:${localId}` lane. Blob attachment
work is part of that lane; there is no independent pump-driven blob sync lane,
and a diagnostics blob row only views the upload that the document lane owns.

### Remote pull eligibility

Scheduling a document lane and probing the remote document
[head](./glossary/sync.md#head) are separate decisions. A clean ordinary document
skips HTTP unless it has outgoing work or a remote-revalidation signal. The
following signals require a probe:

- initializing an opened store from a persisted record with a remote
  `documentId` arms one startup probe, because
  [websocket hints](./developer/realtime-hints.md) are volatile and do not
  survive process restart. When a server-events connect attempt is in flight,
  the probe waits on that attempt instead: its acknowledgement arms the
  reconnect probe below, which covers strictly more, and an attempt that ends
  without one (no ticket, a failed socket, an unready tree at open, or the
  binding stopping) releases the startup probe at once;
- after a server-events disconnect, the client waits for the local container
  tree to be ready, sends its authoritative interest set, and advances a
  monotonic connection generation only after the server acknowledges that it
  installed the declaration. Each already-open remote document that observes a
  newer generation arms one reconnect probe; a boolean edge or raw socket
  `open` can be missed and is too early to close the event-loss window;
- a matching remote event, explicit document revalidation, or forced
  reconciliation requests a probe through the registered document store.

A clean scheduled pass skips a document that has a stored `lastCommitLsn` and
all three bundle fields. Registration returns the `commitLsn` and
`commitLsnMode` read after its transaction, as a document create's seed does,
and the client stores that position as `lastCommitLsn` for every document the
registration seeded: the root, roster-profile, organization-metadata and system
container metadata documents and the roster and organization profile
documents. Those documents therefore skip their first scheduled pass, and the
first read that does run sends the position as `minLsn`. A position the server
could not read after commit is `null`, and the client then reads each seeded
document once. A new identity has no other device that could edit its seeded
documents before this one subscribes. `POST /organizations` reports no
position: another session of its creator can edit the new organization's
documents before this device subscribes to them, and that hint would be lost,
so the client reads each seeded document once.

Document update hints must carry `containerIds`; an unscoped event is rejected.
A scoped remote event reconciles its known containers for discovery and
membership changes, while content revalidation targets only the named document.
The app filters known ordinary content hints out of discovery; their registered
stores receive them directly. Hints routed to the reconciler still list their
named containers. Hints queued during a listing collapse into one trailing
listing, retaining the union of named documents. Explicit Refresh, reconnect,
and resync-required events force every registered document. Force is
acknowledged only after successful reconciliation, so the lossy hint cannot be
discarded by discovery suppression, temporary ineligibility, a transient request
failure, or database loss mid-request. A fulfilled discovery that reports an
incompletely listed remote lane also retains the force for the next
reconciliation signal.

[Discovery lists containers in batches](./request-budgets.md#singular-document-sync-batched-listing)
through `POST /containers/documents/query`: a reconciliation lane run lists up
to four queued containers and a sweep up to 32 per request. Each container keeps
its own watermark and page bound, then verifies and applies on its own, in
order; a rejected lane or a failed apply leaves the other containers' results
intact. A listing request that fails or times out rejects only the lanes it
carried, so they take the rejected-discovery retry below rather than settling
as listed. Force generations are captured before the batched request is sent,
so a hint arriving while it is in flight is never acknowledged by that batch.
Rejected forced discovery receives one backoff-delayed automatic retry per force
generation. A second failure settles the coordinator while retaining the force
for a later event, reconnect, hydration, navigation, or manual sync signal;
persistent failures therefore cannot keep synchronization non-idle.

Reconciliation updates local summaries and links without opening stores; the
[discovered-document primer](developer/device-first.md#document-content-pull-policy)
then opens every listed document of an unpaused organization. Forced targeted
reconciliation propagates its force flag into content pull policy, which
revalidates registered ordinary stores and eagerly pulls system-container
documents, whose projections may have no document window to open them.

The server sends `known_containers_ack` immediately after authorizing and
installing the declaration's readable subset in its process-local event router.
The acknowledgment includes the accepted IDs, so a refused ID is not retained as
subscribed. It confirms processing despite denials; a stale local ID must not
block HTTP reconciliation. A refused re-add also removes any older subscription.
The client retries only refused interests after a [grant](./glossary/access.md#grant)
notification or tree change, including a change that arrived while authorization
was pending. A socket opens with no interest and the server keeps none for a
later reconnect, so every connect's declaration is authorized through the same
signed read-access workflow. Access-change notifications evict only interests
whose verified paths depend on the changed head. One resync frame carries all
affected IDs per socket, and the client refreshes root and distinct parent lanes
once for that batch. Group policy commits also invalidate subscriptions using
that group, including membership removals that do not change any container
manifest. Until that acknowledgment arrives, the SDK continues to report server
events as disconnected, and a cold `ready=false` tree is never declared.

On every acknowledged reconnect, the client also clears cached writer
projections and runs one full reconciliation after the live interest set is in
place. That sweep refreshes container/access structure and force-revalidates
registered document stores, closing the lossy interval for access changes and
key-epoch [rotations](./glossary/keys.md#rotate) even when the affected
container or document was not open when the socket dropped. Native app resume and
network-path changes deliberately replace the socket first, because WKWebView
can retain an `OPEN` WebSocket whose underlying connection is no longer usable.

The coordinator coalesces repeated requests. A successful probe imports and
persists remote Loro updates before hydrating the active attachment bindings and
encrypted blob bytes. A lane reported as complete therefore means only that its
callback returned, not that an HTTP probe was eligible or successful.

A document pass runs in this order:

1. If the document already exists remotely and has pending attachment mutations,
   issue a no-outgoing document sync probe first. This refreshes incoming
   document updates, [commit LSN](./glossary/sync.md#commit-lsn), and
   [content-key](./glossary/keys.md#content-key) material before the later writer
   projection fetch and attachment bind. Attachment work proceeds only after a
   successful probe; a coded remote-deletion response takes the normal
   destructive cleanup path before any blob staging begins. Uncoded and
   transient probe failures preserve the queued attachment and park the pass
   until a later sync signal instead of staging against an unvalidated remote.
2. Sync pending attachment uploads. If the document does not exist remotely yet,
   create the remote document first. Then read the local pending bytes, fetch
   the current document writer projection, derive blob
   [key targets](./glossary/keys.md#key-target) from that projection,
   [stage](./glossary/content.md#blob-stage) encrypted blob bytes, and bind the
   blob with a signed attachment [event](./glossary/access.md#access-event).
3. Sync encrypted Loro document state. If the document still does not exist
   remotely and has pending Loro updates, create it first. Then send pending
   encrypted updates and import returned updates.
4. Hydrate remote attachment blobs when local bytes are missing or their digest
   differs from the authenticated attachment intent, or when a new remote
   revalidation signal requires a binding check. Settled local passes skip the
   attachment listing. A signal arriving during hydration survives for a trailing
   pass. All downloaded bindings and bytes still undergo signature and digest
   verification.

So a local document can be created remotely before either attachment binds or
Loro diffs are sent, and attachment binds may be sent before pending Loro diffs
from the same local edit pass. This is intentional: server-visible attachment
binding state is authoritative for blob reachability, while the encrypted Loro
payload may reference [attachment slots](./glossary/content.md#attachment-slot)
only for editor semantics.

If an attachment upload completes, the document lane requests a follow-up pass
and returns before regular Loro sync. This keeps each pass small and ensures
local attachment projection changes are persisted before the next document
state sync.

Multipart retries retain a persisted blob identity, encryption material, part
size, and stage id. A retry resumes only after a definitive stage-status read;
network and server lookup failures preserve the existing stage. If a bind was
committed but
[its response was lost](./sync-interruption-safety.md#a-lost-bind-acknowledgement-cannot-strand-an-upload),
the next document pass recognizes the same blob in the active slot and adopts
that binding locally instead of uploading or binding a duplicate.

If that stage is definitively missing or expired, the document owner freshly
lists bindings before replacing the upload identity. An active matching slot
retains its identity for adoption; a failed listing retains it for retry. If
the binding is absent or replaced, the owner durably replaces the old identity
and schedules a pass with a fresh blob id and encryption material. This also
recovers a committed-but-unacknowledged bind that another device subsequently
detached: the old blob id remains permanently reserved by server history.
Identity and stage changes become visible in memory only after their local
persistence succeeds.

Remote blob encryption uses independently authenticated
[5 MiB plaintext chunks](./limits.md#blobs), with one encrypted chunk per
multipart part. Browser `File` input and encrypted OPFS storage remain
range-readable, so attachment sync never needs a whole plaintext or ciphertext
buffer. Before encryption, the client fingerprints the source and persists that
fingerprint with a versioned upload identity. It then makes a bounded-memory
encryption pass to compute the exact remote SHA-256 and reproduces only the
missing parts. A changed source rotates the blob id, content key, nonce seed,
and stage before encryption; per-chunk hashes also detect mutation between
passes.

## Blob Synchronization

Blob work remains inside its owning document lane because that lane preserves
its prerequisites: structural work drains first, the remote document exists, the
current writer projection is verified, and only then are encrypted bytes staged
and bound. Byte I/O uses a separate FIFO pool with four permits per API client,
shared by sync hydration downloads and multipart uploads. Relink
key-authentication downloads use their existing path. A permit covers upload
encryption through the part response, or a complete download stream; permits are
released on success and failure. A new stage's first parts are encrypted before
the stage exists, to describe them in its initiation, so each holds its permit
from encryption until its upload ends: the upload awaits one permit and takes
further ones only if they are free, since two uploads each waiting for a second
permit while holding a first would deadlock the pool. Document lanes await their
transfers and retain ownership of binding and persistence.

Unlinking an attachment from a synced document is the mirror case. The local
blob projection row cannot be dropped at unlink time: it is the durable marker
the document lane needs to detach the remote binding, possibly much later while
offline. The row is marked detached instead, and the local blob read models skip
detached rows, so local views reconcile at unlink time. The lane settles each
marker against committed history before and after its detach, so a slot another
pane or device adds back keeps or regains its copy
([edge case 22](./sync-edge-cases.md#edge-cases)).

## Failure And Retry Semantics

The ordering is a client scheduling rule, not an atomic multi-object commit.
Every protocol write still carries the signed
[manifests](./glossary/access.md#access-manifest), key targets, expected hashes,
and [write headers](./glossary/content.md#signed-write-header) that let the
server reject stale or unauthorized work.

If a structural pass cannot make progress, it records the owning workflow's
error state and returns. The coordinator can then run document lanes; those
document/blob writes still [fail closed](./glossary/access.md#fail-closed) if their
projections are stale or unauthorized. The client can later request structural
sync again after remote state, credentials, network, or local input changes.

An upload telemetry row becomes complete only when the actual upload workflow
settles it. Re-running the document owner through Manual Sync cannot directly
clear a blob error or turn partial part counts into a synthetic completion.

System Monitor clipboard reports allowlist only content-free revalidation
telemetry: interest declaration acknowledgements, `startup`/`reconnect`
scheduling reasons, applied incoming-update and attachment-slot counts, and an
`unavailable` outcome. These entries never include document text, structured
fields, attachment names, blob bytes, keys, or decrypted payloads.

## Timing Diagnostics

Each lane snapshot carries `runDurations`: the last, maximum, and total
duration of its settled runs on the monotonic clock, and how many runs were
timed, so the average is the total divided by that count. The Explorer sync
lane list shows the last run, its lane detail adds the average and maximum, and
the System Monitor report carries all of them. A watchdog verdict records no
duration because the run has not finished; the abandoned run is timed with its
real duration when it settles. Observational upload rows are timed from the
start of an upload attempt to its first terminal callback.

The SDK also draws runs on DevTools Performance tracks under a `Tearleads`
group, through `performance.measure` with numeric timestamps:

- `Sync lanes`: one entry per lane run, named `Sync lane: <label>`, with the
  phase, outcome, and whether the watchdog abandoned it;
- `SQLite mutation queue`: time an outermost serialized mutation waited behind
  another one on the same connection (nested calls on the held lock draw
  nothing);
- `SQLite mutations`: time that mutation held the connection lock.

Entries are cleared from the performance timeline as soon as they are
recorded, so a long session does not accumulate them; a DevTools recording
already captured them. Nothing is sent off the device, and runtimes without
User Timing skip the tracks.

## Orchestration Boundary

There is no domain-specific sync orchestrator. The domain sync coordinator
provides the shared orchestration: phase ordering, bounded concurrency, request
coalescing, pending-work observation, and idle waiting. Container, document,
Loro, and blob logic remains in the workflow that owns that state.
