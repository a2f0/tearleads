# Client Sync Ordering

This document describes the client-side ordering used by
`@tearleads/client-sdk` when a domain has several kinds of queued sync work.
It complements the wire-protocol documents; it does not define new HTTP routes
or server transactions.

For one `DomainScope`, the SDK uses one in-process sync coordinator. Sync lanes
drain through a phase barrier:

1. Structural lanes.
2. Up to four document lanes concurrently.

The structural lane is `container-contents`; each document store has a
`documents:${localId}` lane. Queued structural work drains before queued
document work, and a structural follow-up requested during a structural pass
runs before any queued document pass.

Diagnostics also expose `blob-upload:${blobId}` rows with a `blob` phase. These
are observational upload telemetry, not a third pump phase: the owning document
lane performs the work, and upload callbacks update progress and terminal state.
Manual Sync requests the structural and document owners, never the observational
rows themselves.

The coordinator is non-preemptive. If a document pass has already started, a
new structural request waits for the running document passes to finish and
blocks additional document starts until structural work drains. The ordering
guarantee is for queued work on one client runtime and one domain scope; other
devices and other domain scopes synchronize independently and are validated by
the server protocol.

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

The `container-contents` lane owns local container topology and container
metadata state. A pass runs in this order:

1. Sync pending local container create intents.
2. Sync pending local container move intents.
3. Sync container metadata document state.
4. Recover a stale root, replay pending document placement intents, and prime
   document stores when needed.

Container creates run before moves so an offline-created destination can exist
remotely before a later move targets it. Document placements replay in this
phase because they may target containers created locally in the same session,
such as Trash. Moves run before document lanes so document creates, document
Loro updates, and blob attachment binds derive their writer projections from
the latest synced container path.

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

Remote container hydration is read/discovery work, not a sync lane. It can
prime local state and schedule the structural lane, but it is not allowed to
write document content or blob attachment state. One hydration pass, one
document discovery pass, and one document move (its link and unlink legs) each
discover the organization directory once and share that view; see [operation
recovery batch](developer/current-principal-consumers.md#operation-recovery-batch).
Document syncs scheduled through document stores remain separate operations.

## Document Phase

Each document store has its own `documents:${localId}` lane. Blob attachment
work is part of that document lane; there is no independent pump-driven blob
sync lane. A separate blob row in diagnostics is only a view of the upload that
the document lane already owns.

### Remote pull eligibility

Scheduling a document lane and probing the remote document head are separate
decisions. A clean ordinary document skips HTTP unless it has outgoing work or
a remote-revalidation signal. The following signals require a probe:

- initializing an opened store from a persisted record with a remote
  `documentId` arms one startup probe, because websocket hints are volatile and
  do not survive process restart;
- after a server-events disconnect, the client waits for the local container
  tree to be ready, sends its authoritative interest set, and advances a
  monotonic connection generation only after the server acknowledges that it
  installed the declaration. Each already-open remote document that observes a
  newer generation arms one reconnect probe; a boolean edge or raw socket
  `open` can be missed and is too early to close the event-loss window;
- a matching remote event, explicit document revalidation, or forced
  reconciliation requests a probe through the registered document store.

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

Discovery lists containers in batches through
`POST /containers/documents/query`: a reconciliation lane run lists up to four
queued containers and a sweep up to 32 per request. Each container keeps its own
watermark and page bound, then verifies and applies on its own, in order; a
rejected lane or a failed apply leaves the other containers' results intact.
Force generations are captured before the batched request is sent, so a hint
arriving while it is in flight is never acknowledged by that batch. Rejected
forced discovery receives one backoff-delayed automatic retry per force
generation. A second failure settles the coordinator while retaining the force
for a later event, reconnect, hydration, navigation, or manual sync signal;
persistent failures therefore cannot keep synchronization non-idle.

Ordinary unopened documents remain lazy: container reconciliation updates their
local summaries and links but does not instantiate every document store. Forced
targeted reconciliation must propagate its force flag into document-content
pull policy; that policy revalidates registered ordinary stores, while returning
without opening unregistered ones. System-container documents remain the eager
exception because their projections may have no document window to open them.

The server sends `known_containers_ack` immediately after authorizing and
installing the declaration's readable subset in its process-local event router.
The acknowledgment includes the accepted IDs, so a refused ID is not retained as
subscribed. It confirms processing despite denials; a stale local ID must not
block HTTP reconciliation. A refused re-add also removes any older subscription.
The client retries only refused interests after a grant notification or tree
change, including a change that arrived while authorization was pending. A
socket opens with no interest and the server keeps none for a later reconnect,
so every connect's declaration is authorized through the same signed
read-access workflow. Access-change notifications evict only interests whose
verified paths depend on the changed head. One resync frame carries all
affected IDs per socket, and the client refreshes root and distinct parent
lanes once for that batch. Group policy commits also invalidate subscriptions
using that group, including membership removals that do not change any
container manifest. Until that acknowledgment arrives, the SDK continues to
report server events as disconnected, and a cold `ready=false` tree is never
declared.

On every acknowledged reconnect, the client also clears cached writer
projections and runs one full reconciliation after the live interest set is in
place. That sweep refreshes container/access structure and force-revalidates
registered document stores, closing the lossy interval for access changes and
key-epoch rotations even when the affected container or document was not open
when the socket dropped. Native app resume and network-path changes deliberately
replace the socket first, because WKWebView can retain an `OPEN` WebSocket whose
underlying connection is no longer usable.

The coordinator coalesces repeated requests. A successful probe imports and
persists remote Loro updates before hydrating the active attachment bindings and
encrypted blob bytes. A lane reported as complete therefore means its callback
returned; it does not, by itself, prove that an HTTP probe was eligible or
successful.

A document pass runs in this order:

1. If the document already exists remotely and has pending attachment
   mutations, issue a no-outgoing document sync probe first. This refreshes
   incoming document updates, commit LSN, and content-key material before the
   later writer projection fetch and attachment bind. Attachment work proceeds
   only after a successful probe; a coded remote-deletion response takes the
   normal destructive cleanup path before any blob staging begins. Uncoded and
   transient probe failures preserve the queued attachment and park the pass
   until a later sync signal instead of staging against an unvalidated remote.
2. Sync pending attachment uploads. If the document does not exist remotely yet,
   create the remote document first. Then read the local pending bytes, fetch
   the current document writer projection, derive blob key targets from that
   projection, stage encrypted blob bytes, and bind the blob with a signed
   attachment event.
3. Sync encrypted Loro document state. If the document still does not exist
   remotely and has pending Loro updates, create it first. Then send pending
   encrypted updates and import returned updates.
4. Hydrate remote attachment blobs when local bytes are missing or their digest
   differs from the authenticated attachment intent, or when a new remote
   revalidation signal requires a binding check. Settled local passes skip the
   attachment listing. A signal arriving during hydration survives for a trailing
   pass. All downloaded bindings and bytes still undergo signature and digest
   verification.

This means a local document can be created remotely before either attachment
binds or Loro diffs are sent. Attachment binds may also be sent before pending
Loro diffs from the same local edit pass. That is intentional: server-visible
attachment binding state is authoritative for blob reachability, while the
encrypted Loro payload may reference attachment slots only for editor
semantics.

If an attachment upload completes, the document lane requests a follow-up pass
and returns before regular Loro sync. This keeps each pass small and ensures
local attachment projection changes are persisted before the next document
state sync.

Multipart retries retain a persisted blob identity, encryption material, part
size, and stage id. A retry resumes only after a definitive stage-status read;
network and server lookup failures preserve the existing stage. If a bind was
committed but its response was lost, the next document pass recognizes the same
blob in the active slot and adopts that binding locally instead of uploading or
binding a duplicate.

If that stage is definitively missing or expired, the document owner freshly
lists bindings before replacing the upload identity. An active matching slot
retains its identity for adoption; a failed listing retains it for retry. If
the binding is absent or replaced, the owner durably replaces the old identity
and schedules a pass with a fresh blob id and encryption material. This also
recovers a committed-but-unacknowledged bind that another device subsequently
detached: the old blob id remains permanently reserved by server history.
Identity and stage changes become visible in memory only after their local
persistence succeeds.

Remote blob encryption uses independently authenticated 5 MiB plaintext
chunks, with one encrypted chunk per multipart part. Browser `File` input and
encrypted OPFS storage remain range-readable, so attachment sync never needs a
whole plaintext or ciphertext buffer. Before encryption, the client fingerprints
the source and persists that fingerprint with a versioned upload identity. It
then makes a bounded-memory encryption pass to compute the exact remote SHA-256
and reproduces only the missing parts. A changed source rotates the blob id,
content key, nonce seed, and stage before encryption; per-chunk hashes also
detect mutation between passes.

## Blob Synchronization

Blob work remains inside its owning document lane because that lane preserves
its prerequisites: structural work drains first, the remote document exists,
the current writer projection is verified, and only then are encrypted bytes
staged and bound. Byte I/O uses a separate FIFO pool with four permits per API
client, shared by sync hydration downloads and multipart uploads. Relink
key-authentication downloads use their existing path. A permit
covers upload encryption through the part response, or a complete download
stream; permits are released on success and failure. A new stage's first
parts are encrypted before the stage exists, to describe them in its
initiation, so each holds its permit from encryption until its upload ends:
the upload awaits one permit and takes further ones only if they are free,
since two uploads each waiting for a second permit while holding a first
would deadlock the pool. Document lanes await their
transfers and retain ownership of binding and persistence.

Unlinking an attachment from a synced document is the mirror case. The local
blob projection row cannot be dropped at unlink time: it is the durable marker
the document lane diffs against the document to find the remote binding it
still owes a detach, and that detach can be deferred indefinitely while the
client is offline. The row is instead marked detached, and the local blob read
models — the blob browser's references and document info's attachments — skip
detached rows. Local views therefore reconcile at unlink time rather than at
flush time, while the lane keeps the work it has not yet done.

## Failure And Retry Semantics

The ordering is a client scheduling rule, not an atomic multi-object commit.
Every protocol write still carries the signed manifests, key targets, expected
hashes, and write headers that let the server reject stale or unauthorized
work.

If a structural pass cannot make progress, it records the owning workflow's
error state and returns. The coordinator can then run document lanes; those
document/blob writes still fail closed if their projections are stale or
unauthorized. The client can later request structural sync again after remote
state, credentials, network, or local input changes.

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
