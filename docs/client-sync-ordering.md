# Client Sync Ordering

This document describes the client-side ordering used by
`@symcrypt/client-sdk` when a domain has several kinds of queued sync work.
It complements the wire-protocol documents; it does not define new HTTP routes
or server transactions.

For one `DomainScope`, the SDK uses one in-process sync coordinator. Sync lanes
are serialized by phase:

1. Structural lanes.
2. Document lanes.

The current structural lane is `container-contents`. The current document
lanes are `documents:${localId}` lanes. Queued structural work drains before
queued document work, and a structural follow-up requested during a structural
pass runs before any queued document pass.

Diagnostics also expose `blob-upload:${blobId}` rows with a `blob` phase. These
are observational upload telemetry, not a third pump phase: the owning document
lane performs the work, and upload callbacks update progress and terminal state.
Manual Sync requests the structural and document owners, never the observational
rows themselves.

The coordinator is non-preemptive. If a document pass has already started, a
new structural request waits for that pass to finish. The ordering guarantee is
for queued work on one client runtime and one domain scope; other devices and
other domain scopes still synchronize independently and are validated by the
server protocol.

**Watchdog exception.** A lane exceeding its watchdog is abandoned, not
cancelled, so the pump may advance while its tail remains in flight. Its run
token prevents same-lane overlap until that tail settles; later lanes may
overlap it, and the server validates any late writes like concurrent writes
from another device.

## Structural Phase

The `container-contents` lane owns local container topology and container
metadata state. A pass runs in this order:

1. Sync pending local container create intents.
2. Sync pending local container move intents.
3. Sync container metadata document state.

Container creates run before moves so an offline-created destination can exist
remotely before a later move targets it. Moves run before document lanes so
document creates, document Loro updates, and blob attachment binds derive their
writer projections from the latest synced container path.

When a move is accepted, the lane updates the local snapshot, requests document
sync for the domain, and requests a structural follow-up. Because that follow-up
is structural, it drains before the requested document lanes.

Remote container hydration is read/discovery work, not a sync lane. It can
prime local state and schedule the structural lane, but it is not allowed to
write document content or blob attachment state.

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

Ordinary unopened documents remain lazy: container reconciliation updates their
local summaries and links but does not instantiate every document store. Forced
targeted reconciliation must propagate its force flag into document-content
pull policy; that policy revalidates registered ordinary stores, while returning
without opening unregistered ones. System-container documents remain the eager
exception because their projections may have no document window to open them.

The server sends `known_containers_ack` immediately after installing the
declaration in its process-local event router and before asynchronously
persisting it for a later reconnect. Until that acknowledgement arrives, a cold
`ready=false` tree cannot remove the restored baseline and the SDK continues to
report server events as disconnected.

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
4. Hydrate remote attachment blobs referenced by the refreshed document record.

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
staged and bound.

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
telemetry: interest-baseline container counts, `startup`/`reconnect` scheduling
reasons, applied incoming-update and attachment-slot counts, and an
`unavailable` outcome. These entries never include document text, structured
fields, attachment names, blob bytes, keys, or decrypted payloads.

## Orchestration Boundary

There is no domain-specific sync orchestrator. The domain sync coordinator
provides the shared orchestration: phase ordering, lane serialization, request
coalescing, pending-work observation, and idle waiting. Container, document,
Loro, and blob logic remains in the workflow that owns that state.
