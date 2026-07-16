# Client Sync Ordering

This document describes the client-side ordering used by
`@tearleads/client-sdk` when a domain has several kinds of queued sync work.
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

A document pass runs in this order:

1. If the document already exists remotely and has pending attachment
   mutations, issue a no-outgoing document sync probe first. This refreshes
   incoming document updates, commit LSN, and content-key material before the
   later writer projection fetch and attachment bind.
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

## Blob Synchronization

Blob synchronization comes into play only inside the document phase.

Pending attachment bytes stay in the local blob store until their owning
document lane runs. At upload time the client asks the server for the current
document writer projection, verifies it locally, derives blob targets from that
projection, stages encrypted bytes, and submits the signed attachment bind. The
blob bind therefore observes structural work that drained earlier in the same
domain coordinator.

This is why blob work should not be moved to a separate lane unless that lane
can preserve the same prerequisites: structural work first, remote document
exists, current document writer projection verified, then blob stage and bind.

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

## Orchestration Boundary

There is no domain-specific sync orchestrator. The domain sync coordinator
provides the shared orchestration: phase ordering, lane serialization, request
coalescing, pending-work observation, and idle waiting. Container, document,
Loro, and blob logic remains in the workflow that owns that state.
