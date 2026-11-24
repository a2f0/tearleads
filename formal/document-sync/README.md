# Document Sync Models

The [model index](../models.md) entries for the models in this directory. Each
entry summarizes what the model checks and links its mapping document, which
names the production seams, bounds, and negative controls.

## Sync Lane Concurrency

[`SyncLaneConcurrency.tla`](./SyncLaneConcurrency.tla)
checks worker bounds, structural ordering, exclusivity, trailing requests, and
backoff. See the [mapping](./SyncLaneConcurrency.md).

## Document Baseline Dominance

[`BaselineDominance.tla`](./BaselineDominance.tla)
models the no-data-loss gate for document sync baseline redirection: a
normal-mode read may omit an older-epoch update only when a readable
current-epoch baseline provably dominates it, and raw mode always serves the
complete retained missing frontier. `NoDataLoss` is stated against what the
baseline actually carries, and four controls show that the vector coverage
check, the authenticated-baseline rule, raw-mode completeness, and keeping
current-epoch updates each carry an invariant. Because the other invariants
share the `Dominated`/`Older` operators with the serve action, TLC alone cannot
check the dominance definition itself; the registered
[`BaselineDominanceTraceExport.tla`](./BaselineDominanceTraceExport.tla)
closes that blind spot by exporting every served behavior into the committed
fixture
[`BaselineDominanceTraces.json`](./BaselineDominanceTraces.json)
(`bun run generate:protocol-traces`, drift-checked by
`bun run check:protocol-traces`), which the TypeScript replay suite drives
through the real dominance/redirect kernels and an independent
componentwise-counter oracle on every push. See the
[production mapping, trace bridge, bounds, and assumptions](./BaselineDominance.md).

## Deferred Document-Tail Settlement

[`DeferredTailSettlement.tla`](./DeferredTailSettlement.tla)
models the [device-first](../../docs/developer/device-first.md) outgoing-delta
marker across local edits, durable queue writes, restarts, sync preparation,
server acceptance, incoming updates, reset/reinitialize, relink, and deletion,
and requires that persisted coverage never outruns accepted or durably queued
work and that a stale completion can never publish into a replacement
generation. See the
[production mapping, explored orderings, invariants, and bounds](./DeferredTailSettlement.md).

## Outgoing Queue Merge

[`OutgoingQueueMerge.tla`](./OutgoingQueueMerge.tla)
models two runtimes sharing one durable outgoing queue while a sync pass
replaces a run of consecutive queued local rows with one row holding exactly
their operations, alongside edits, full-state rows, submission, acceptance,
lost acknowledgements, settlement by id, conflict re-keying, and restarts. It
requires that no local operation is lost, that an update id never names two
contents, and that a merged row keeps its first member's queue position. See
the [production mapping, negative controls, and bounds](./OutgoingQueueMerge.md).

## Void Update Progress

[`VoidUpdateProgress.tla`](./VoidUpdateProgress.tla)
models readers of a document whose server log can hold an update with a false
op span. Each reader judges served updates in server order, voids the ones it
can never apply, and records a processed cursor the server pulls after; a
decoder upgrade or an older replaced state withholds the cursor so the device
judges again. A Loro runtime failure leaves its update unsettled until enough
process lifetimes have each failed it, and the user's reload, which the app
asks for after a failure, starts the next one. A key rotation's rebuild of accepted
history charges a death to the rotation, never an update, and a window the
process outlives clears the attempts of the updates it read. It requires that
no void update's operations are applied, that devices that processed the same
log with the same judge and final voids agree, that a runtime failure voids no
update before its bounded attempts with no clean read between them, that a
rotation's death spends no update's attempts, and that every device eventually
holds what a fresh reader on its decoder holds. See the
[production mapping, negative controls, and bounds](./VoidUpdateProgress.md).

## Content-Key Commitment

[`ContentKeyCommitment.tla`](./ContentKeyCommitment.tla)
models readers of a document across its content-key epochs. Each epoch commits
to its key, the API refuses an update that commits to another, and a reader
judges an update only under the committed key: an AES-GCM or plaintext-hash
failure under it is a void, and holding another key leaves the update
unavailable without moving the cursor. Openers may wrap another key to some
targets, and a reader may be handed a stale key. It requires that every
recorded verdict is the one the committed key gives, so readers agree, and that
a reader whose wraps hold the committed keys eventually judges the whole log.
See the [production mapping, negative controls, and bounds](./ContentKeyCommitment.md).

## Rotation Baselines Past a False Op Span

[`BaselineCursorCoverage.tla`](./BaselineCursorCoverage.tla)
models the server's coverage checks for a rotation baseline over a log that
can hold an overclaimed op span. A baseline signs its author's processed
cursor only when its snapshot holds the frontier the cursor was recorded
with, and the gate and the redirect weigh only updates committed after it. It
requires that no accepted baseline lacks a truthful operation, that an author
that judged the whole log is never refused, and that a new reader starts at
the latest accepted baseline. See the
[production mapping, negative controls, and bounds](./BaselineCursorCoverage.md).

## Document Peer Ownership

[`PeerOwnership.tla`](./PeerOwnership.tla)
models the server's peer-ownership rule. A span past a peer's committed
frontier claims an unowned peer, passes on its writer's own, and refuses the
request on another user's, while a re-assertion within the frontier is open to
every writer. Peers stay secret until their first commit. A dishonest member
commits forged spans on peers it has seen, and a republisher recreates a
document from its history after a billing purge of its organization. A device
refused on a peer the recreation claimed rebases onto a fresh peer. Each update
also declares the op ids it depends on: the server refuses one past a peer's
committed frontier, and readers void an update that depends on other ops than
it declares, so the dishonest member cannot depend on a device's unsent ops. It
requires that no reader voids an honest update, that no other user occupies a
device's counters past what it committed, that a re-assertion or a dependency
is never the cause of an honest refusal, that no device accepts an update a
fresh reader voids, and that every honest edit is eventually committed. See the
[production mapping, negative controls, and bounds](./PeerOwnership.md).

## Opened-Document Recovery Probes

[Raw-history reconstruction](../../docs/raw-document-history-recovery.md) before
key rotation is covered separately by
[RawHistoryRecovery](./RawHistoryRecovery.md), including install
ownership, checkpoint retirement, waiting writers, and fair worker termination.

[`RestartProbeConvergence.tla`](./RestartProbeConvergence.tla)
models startup and acknowledged-reconnect probes, peer writes during the
handshake or an in-flight pull, and signal-sequence coalescing for encrypted
Loro body and [attachment-slot](../../docs/glossary/content.md#attachment-slot)
state. See the
[production mapping and model boundary](./RestartProbeConvergence.md)
for the action seams, fairness assumptions, and excluded blob-hydration layer.

## Container Metadata Under Lost Hints

[`DiscoveryPublication.tla`](./DiscoveryPublication.tla)
checks commit-ordered discovery with concurrent live and removal writers.
Every committed change remains available above a page's saved watermark
until the client observes it.

[`MetadataListingConvergence.tla`](./MetadataListingConvergence.tla)
models a client holding a container metadata document while a peer's edit hint
is lost: offline, closed, or before its interest is acknowledged. Each
acknowledged connection re-lists the client's lanes from their watermarks, and
a listed metadata version the local copy does not cover owes a read, in memory
and durably, before the watermark passes the row. TLC checks that some evidence
of an unread edit always survives, through crashes and reads in flight, and
that the client eventually holds the server's version. See the
[production mapping and negative controls](./MetadataListingConvergence.md).

## Epoch Advances Without a Covering Baseline

[`EmptyFrontierUnlink.tla`](./EmptyFrontierUnlink.tla)
models the acceptance gates for the two
[content-key](../../docs/glossary/keys.md#content-key) epoch advances that carry
no [rotation baseline](../../docs/glossary/keys.md#rotation-baseline): a
document unlink submitted without one, and a link that advances the epoch. Both
require a committed frontier proved empty under the document manifest-head
write lock, and a covering unlink's baseline is refused when it falls short of
the committed frontier. See the
[mapping, negative controls, and bounds](./EmptyFrontierUnlink.md).

## Attachment Key Reachability

Attachment key availability across links, unlinks, and container rotations is
modeled in [AttachmentKeyReachability](./AttachmentKeyReachability.md).
This includes attachment cache invalidation between the link and unlink steps
of a single-device move.

## Attachment Envelope Authority

[BlobEnvelopeAuthority](./BlobEnvelopeAuthority.md) checks that a
[binding](../../docs/glossary/content.md#attachment-binding) writer preserves other
active bindings’ envelopes and that fresh wraps use verified current container heads.

## Attachment Content Identity

[`AttachmentContentIdentity.tla`](./AttachmentContentIdentity.tla)
models authenticated attachment intent and concurrent hydration. See the
[mapping and boundaries](./AttachmentContentIdentity.md).
[SharedCopyReclaim](./SharedCopyReclaim.md) checks that deleting
one slot's row keeps a hydrated copy another slot still holds.

## Historical Write Authority

[ContentWriteAuthority](./ContentWriteAuthority.md) checks delayed
reads across ancestor grants, group removal, and leaf advancement, including a
reader on another link of the document after the writer's container is
unlinked and deleted, and that carried rekeys precede the head lock.
