# Protocol Model Index

Every model registered in [`protocol-models.txt`](./protocol-models.txt),
grouped by directory. Each entry summarizes what the model checks and links its
mapping document, which names the production seams, bounds, and negative
controls. The [overview](./README.md) covers running the models, the
abstraction-map and trace-projection checks, and adding a model.

## Container Keying

Models under [`container-keying/`](./container-keying).

### Container Deletion

[`container-keying/ContainerDeletion.tla`](./container-keying/ContainerDeletion.tla)
models creation racing leaf deletion and the permanent reservation of retired
metadata document IDs. See the [mapping and boundaries](./container-keying/ContainerDeletion.md).

### Container Depth

The [container depth model](./container-keying/ContainerDepth.md) checks that
create and subtree moves preserve readable paths. Policy revocation is outside
its boundary. Three negative controls remove the structural mutation guards.

### Container Grant Scope

[`container-keying/ContainerGrantScope.tla`](./container-keying/ContainerGrantScope.tla)
models the accepted container-grant domain. TLC checks that every reachable
grant names either a group in the container's organization or an active direct
user in that organization; an organization principal is never a container
grant subject. It also models roster removal as a guarded transition: a user
must first be unshared from every directly granted container, whose revoke is a
container KEK rotation in the runtime and in the keyring model below.

The production seams are the container grant grammar, the locked group/user
reference checks in `groupReferences.ts`, and the direct-grant blocker in
`roster.ts`. The bounded configuration includes same- and foreign-organization
users, groups, and organization principals so TLC explores every accepted
grant/revoke and roster transition over those categories.

### Container Keyring Reachability

[`container-keying/KeyringReachability.tla`](./container-keying/KeyringReachability.tla)
models cold recovery from persisted user/group recipient wraps, immutable
predecessor bridges, and sealed historical keyrings. Its `Members` abstraction
is the set of users authorized by active direct-user or same-organization group
grants; organization principals are not recovery recipients. `Descendants`
extend it with child containers whose key epochs pin the parent epoch current
when they were minted: a descendant verifies against any pinned epoch the
parent's retained history still covers, and the negative control
`strict-parent-epoch-pin-strands-descendant` accepts only the parent's current
epoch, under which an ancestor rotation strands the subtree. An honest rotation
may also seal a forged entry, an invented epoch id over server-chosen material
that passes its material check, whether rebuilt for a repair or carried in the
served keyring. `RotationsSealOnlySignedLineage` requires that it never does.
`AnchorToSignedLineage` records that rule as a switch. The model does not
represent where manifests are served or the lineage walk, so the invariant
holds by construction and the control
`kek-history-anchor-seals-relocated-forgery` only marks where the rule sits;
the evidence that the walk refuses a relocated forgery is the SDK tests
(`signedHistoryEpochIds`, `assertOverrideMatchesSignedLineage`). Every
re-sealing rotation takes its target from `signedRotationTarget`, so none can
skip the walk.

[`container-keying/GroupGrantRevocation.tla`](./container-keying/GroupGrantRevocation.tla)
adds the group key as its own epoch dimension: container wraps sealed to a
group key outlive a revoked grant, so a revocation must rotate the group key
before an additive join hands that key out. See the
[mapping and boundaries](./container-keying/GroupGrantRevocation.md).

### Container Tombstone Recovery

[`container-keying/ContainerTombstoneRecovery.tla`](./container-keying/ContainerTombstoneRecovery.tla)
checks that an unsigned parent listing that withdraws a cached subtree after its
child has moved elsewhere cannot authorize erasing local work or declaring every
cached descendant terminally deleted. See the
[mapping and boundaries](./container-keying/ContainerTombstoneRecovery.md).

### Manifest History Availability

[`container-keying/ManifestHistory.tla`](./container-keying/ManifestHistory.tla)
models cold reads, revocation, and citing held bundles. Negative controls show
why lifetime caps fail and citing needs held bytes and cited-only omission. Read
and revocation predicates hold by definition; no verifier or resource bound is
modeled. See the
[mapping and runtime regressions](./container-keying/ManifestHistory.md).
Principal state models cover
[version availability](./container-keying/PrincipalHistory.md)
and [page verification](./container-keying/PrincipalHistoryPages.md), including
[authenticated resumption](./container-keying/PrincipalHistoryResume.md) and
[recovery reuse](./container-keying/PrincipalRecoveryReuse.md).

### No Bricked Device

[`container-keying/AncestorRecovery.tla`](./container-keying/AncestorRecovery.tla)
checks the distinct read and write currency rules for a three-level container
path. Rotating a parent preserves descendant reads; repairing a child can make
its grandchild stale without making it unreadable. A dishonest server may serve
the child pinned to any root epoch, including one it invented: reads accept a
pin only when the parent's retained signed history contains it
(`UnknownEpochRefused`), and an honest path is never refused
(`HonestReadsAvailable`). Writes go through a guarded device step that requires
current pins along the whole path (`StaleWritesRefused`), and with only the
writer's own repairs and write fair, the writer always reaches a current path
and writes (`WriterEventuallyWrites`). Four controls flip one rule each:
`StrictReadParentPin` refuses honest reads after the first root rotation,
dropping `CheckSignedLineage` accepts an invented epoch, dropping
`CheckWriteCurrency` commits over a stale pin, and denying `WriterRepairs`
leaves the writer unable to write.

The production seams are `resolveContainerKekParentBinding` (signed historical
epoch membership) and `assertContainerKekParentEdgesCurrent` (current epochs
required for writes). The API and SDK `ancestorRotationRecovery.test.ts` tests
exercise those seams with signed manifests; the SDK test also uses actual
encrypted keys. The model abstracts cryptography and authorization; the
signed-history tampering tests cover that boundary in the implementation.
Independent repair by a child-only writer is
[`InaccessibleIntermediateRepair`](./container-keying/InaccessibleIntermediateRepair.md)'s
subject.

[`container-keying/InaccessibleIntermediateRepair.tla`](./container-keying/InaccessibleIntermediateRepair.tla)
adds the actors that model leaves out. A writer granted only on the leaf can
re-key its own container but never a stale intermediate above it, and is never
given that key, so a rotation re-keys that intermediate in its own transaction.
Only the blocked writer's step is fair, as in `NoBrickedDevice`; a rotation that
commits alone parks the writer for good. Two further controls reproduce a write
a revoked member can open and a writer holding a key outside its grant. See the
[mapping and boundary](./container-keying/InaccessibleIntermediateRepair.md).

[`container-keying/NoBrickedDevice.tla`](./container-keying/NoBrickedDevice.tla)
models the invariant that no device may ever be unable to read or write
because another device holds a cache or must issue a write first. A dependent
(descendant container, or group policy) cites an authority (ancestor, or
Admins policy); every client refusal rule is a parameter, and negative controls
show that requiring stale heads or chain entries to cite the current authority
bricks a device's reads. Its own write, which the API accepts only at the
current heads, must also eventually commit; a writer that waits for the
dependent to be re-signed first violates that. See the
[mapping, configurations, and boundary](./container-keying/NoBrickedDevice.md).

### Principal Reference Progress

[`container-keying/PrincipalReferenceProgress.tla`](./container-keying/PrincipalReferenceProgress.tla)
models current group references at commit and monotone references in signed
container history. See the [mapping and boundaries](./container-keying/PrincipalReferenceProgress.md).

## Document Sync

Models under [`document-sync/`](./document-sync).

### Sync Lane Concurrency

[`document-sync/SyncLaneConcurrency.tla`](./document-sync/SyncLaneConcurrency.tla)
checks worker bounds, structural ordering, exclusivity, trailing requests, and
backoff. See the [mapping](./document-sync/SyncLaneConcurrency.md).

### Document Baseline Dominance

[`document-sync/BaselineDominance.tla`](./document-sync/BaselineDominance.tla)
models the no-data-loss gate for document sync baseline redirection: a
normal-mode read may omit an older-epoch update only when a readable
current-epoch baseline provably dominates it, and raw mode always serves the
complete retained missing frontier. `NoDataLoss` is stated against what the
baseline actually carries, and four controls show that the vector coverage
check, the authenticated-baseline rule, raw-mode completeness, and keeping
current-epoch updates each carry an invariant. Because the other invariants
share the `Dominated`/`Older` operators with the serve action, TLC alone cannot
check the dominance definition itself; the registered
[`BaselineDominanceTraceExport.tla`](./document-sync/BaselineDominanceTraceExport.tla)
closes that blind spot by exporting every served behavior into the committed
fixture
[`BaselineDominanceTraces.json`](./document-sync/BaselineDominanceTraces.json)
(`bun run generate:protocol-traces`, drift-checked by
`bun run check:protocol-traces`), which the TypeScript replay suite drives
through the real dominance/redirect kernels and an independent
componentwise-counter oracle on every push. See the
[production mapping, trace bridge, bounds, and assumptions](./document-sync/BaselineDominance.md).

### Deferred Document-Tail Settlement

[`document-sync/DeferredTailSettlement.tla`](./document-sync/DeferredTailSettlement.tla)
models the device-first outgoing-delta marker across local edits, durable
queue writes, restarts, sync preparation, server acceptance, incoming updates,
reset/reinitialize, relink, and deletion, and requires that persisted coverage
never outruns accepted or durably queued work and that a stale completion can
never publish into a replacement generation. See the
[production mapping, explored orderings, invariants, and bounds](./document-sync/DeferredTailSettlement.md).

### Opened-Document Recovery Probes

Raw-history reconstruction before key rotation is covered separately by
[RawHistoryRecovery](./document-sync/RawHistoryRecovery.md), including install
ownership, checkpoint retirement, waiting writers, and fair worker termination.

[`document-sync/RestartProbeConvergence.tla`](./document-sync/RestartProbeConvergence.tla)
models startup and acknowledged-reconnect probes, peer writes during the
handshake or an in-flight pull, and signal-sequence coalescing for encrypted Loro
body and attachment-slot state. See the
[production mapping and model boundary](./document-sync/RestartProbeConvergence.md)
for the action seams, fairness assumptions, and excluded blob-hydration layer.

### Epoch Advances Without a Covering Baseline

[`document-sync/EmptyFrontierUnlink.tla`](./document-sync/EmptyFrontierUnlink.tla)
models the acceptance gates for the two content-key epoch advances that carry no
rotation baseline: a document unlink submitted without one, and a link that
advances the epoch. Both require a committed frontier proved empty under the
document manifest-head write lock, and a covering unlink's baseline is refused
when it falls short of the committed frontier. See the
[mapping, negative controls, and bounds](./document-sync/EmptyFrontierUnlink.md).

### Attachment Key Reachability

Attachment key availability across links, unlinks, and container rotations is
modeled in [AttachmentKeyReachability](./document-sync/AttachmentKeyReachability.md).
This includes attachment cache invalidation between the link and unlink steps
of a single-device move.

### Attachment Envelope Authority

[BlobEnvelopeAuthority](./document-sync/BlobEnvelopeAuthority.md) checks that
a binding writer preserves other active bindings’ envelopes and that fresh
wraps use verified current container heads.

### Attachment Content Identity

[`document-sync/AttachmentContentIdentity.tla`](./document-sync/AttachmentContentIdentity.tla)
models authenticated attachment intent and concurrent hydration. See the
[mapping and boundaries](./document-sync/AttachmentContentIdentity.md).
[SharedCopyReclaim](./document-sync/SharedCopyReclaim.md) checks that deleting
one slot's row keeps a hydrated copy another slot still holds.

### Historical Write Authority

[ContentWriteAuthority](./document-sync/ContentWriteAuthority.md) checks delayed
reads across ancestor grants, group removal, and leaf advancement.

## Local Trust

Models under [`local-trust/`](./local-trust).

### Unacknowledged Server Input

[`local-trust/UnacknowledgedInput.tla`](./local-trust/UnacknowledgedInput.tla)
models pending document-create adoption and fingerprint-bound login
acknowledgments. See the [mapping and boundaries](./local-trust/UnacknowledgedInput.md).

[`local-trust/ContainerCreateAdoption.tla`](./local-trust/ContainerCreateAdoption.tla)
models adopting a listed pending container create and the move it owes. See
the [mapping](./local-trust/ContainerCreateAdoption.md).

[`local-trust/ContainerMoveReplay.tla`](./local-trust/ContainerMoveReplay.tla)
models a queued folder move whose accepted result is lost: the replay settles
from the verified head without a second rotation, and the lost result schedules
that replay itself. See the [mapping](./local-trust/ContainerMoveReplay.md).

[`local-trust/DurableIdentityBinding.tla`](./local-trust/DurableIdentityBinding.tla)
checks that persistent fingerprint-to-user bindings survive session recreation
and stay unique within each trust domain. See the
[mapping and boundaries](./local-trust/DurableIdentityBinding.md).

### Queued Document Creation

[QueuedDocumentCreate](./local-trust/QueuedDocumentCreate.md) checks that a queued
store observes local purge before starting remote creation and that an obsolete
read cannot retire a replacement store generation. It also checks that a create
seed leaves the queue only once committed, and that a peer edit's hint
arriving before the create response still leads to a pull.

### Document Move Placement

[`local-trust/DocumentMovePlacement.tla`](./local-trust/DocumentMovePlacement.tla)
models the local placement of one document through two move intents, signed
link and unlink replay, delayed discovery, and delayed local reads: a pending
intent owns local placement, so intermediate server membership cannot make an
optimistically trashed item reappear in its source folder. See the
[mapping and boundaries](./local-trust/DocumentMovePlacement.md).

### Organization Scope

[OrganizationScope](./local-trust/OrganizationScope.md) enumerates directory,
group-chain, reference, and parent organization choices at the cache boundary.

### Verified Root and System Destinations

[SystemDestination](./local-trust/SystemDestination.md) models signed destination
roles, acknowledged roots, administrator-only slot creation, and immutable
root/system parent edges.

[RootDocumentPriming](./local-trust/RootDocumentPriming.md) checks that documents
deferred during root verification are scheduled after remote acknowledgement.

[ContainerAuthoring](./local-trust/ContainerAuthoring.md) separates read proof
access from local signing authority and models an untrusted server echoing a plan.

### Purge Recovery and Subtree Purge Scope

[`local-trust/PurgeRecovery.tla`](./local-trust/PurgeRecovery.tla) checks that
recovery adopts a replacement organization or root that an untrusted API
returns, or re-homes the local corpus there, only with this identity's explicit
signed replacement intent. Recovery starts from the API's unsigned purged
status only for the user's own personal organization. See the
[mapping and boundaries](./local-trust/PurgeRecovery.md).

[`local-trust/SubtreePurgeScope.tla`](./local-trust/SubtreePurgeScope.tla)
checks that unsigned listing edges cannot select purge candidates outside a
user-selected subtree. See the
[mapping and boundaries](./local-trust/SubtreePurgeScope.md).

### Session Retry Identity

[`local-trust/SessionRetryIdentity.tla`](./local-trust/SessionRetryIdentity.tla)
checks that a delayed 401 for one identity never replays its request as
another. See the
[mapping and boundaries](./local-trust/SessionRetryIdentity.md).

### Principal Acknowledgement Race

[`local-trust/PrincipalAcknowledgementRace.tla`](./local-trust/PrincipalAcknowledgementRace.tla)
models a signed compound receipt that arrives after an honest reader has
recovered that receipt or a later descendant; committing it must neither roll
progress back nor report an incident. See the
[mapping and boundaries](./local-trust/PrincipalAcknowledgementRace.md).

## Realtime

Models under [`realtime/`](./realtime).

### Container Interest Authorization

[`realtime/ContainerInterest.tla`](./realtime/ContainerInterest.tla) checks that
container subscriptions require current read access before indexing, cannot be
restored by an authorization that outlived revocation or close, and reach a
socket only after its own client declares; an ended session's socket never
outlives the next answered session read, and an unconfirmed session closes at
its deadline. See the
[production mapping and bounds](./realtime/ContainerInterest.md).

### Organization Read-Model Stamps

[`realtime/OrganizationReadModelStamps.tla`](./realtime/OrganizationReadModelStamps.tla)
checks that each source mutation stamps every lane or group it changed with the
organization's new cursor, so a delta from any cursor reloads every changed
entity and never skips a change. See the
[mapping and negative controls](./realtime/OrganizationReadModelStamps.md).

## Blob Attachments

Models under [`blob-attachments/`](./blob-attachments).

### Existing Blob Source Authority

[BlobSourceAuthority](./blob-attachments/BlobSourceAuthority.md) models existing
ciphertext binding with original-author or source-read authority in addition
to destination-write authority.

### Pending Attachment Detach

[`blob-attachments/PendingAttachmentDetach.tla`](./blob-attachments/PendingAttachmentDetach.tla)
models a bind that commits before its response reaches the client or local
settlement finishes: removing the slot must preserve a detached row that the
current store's detach pass sees, before and after a restart. See the
[mapping and boundaries](./blob-attachments/PendingAttachmentDetach.md).

## Backup and Restore

Models under [`backup-restore/`](./backup-restore).

### Backup Restore Terminal Anchors

[`backup-restore/TerminalAnchors.tla`](./backup-restore/TerminalAnchors.tla)
models preservation of the three kinds of local trust anchor across full
database restores: immutable purge decisions, append-only incident evidence,
and monotone verification checkpoints, including observations made after
restore preflight. Its mapping lists every production anchor table by kind and
the tables deliberately left out. See the
[mapping and boundaries](./backup-restore/TerminalAnchors.md).
