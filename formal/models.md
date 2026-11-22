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
[grant](../docs/glossary/access.md#grant) names either a group in the container's
organization or an active direct user in that organization; an
[organization](../docs/glossary/principals.md#organization) principal is never a
container grant subject. It also models roster removal as a guarded transition:
a user must first be unshared from every directly granted container, whose
revoke is a [container KEK](../docs/glossary/keys.md#container-kek) rotation in
the runtime and in the keyring model below.

A grant request may name any principal, and each API refusal is a parameter
with a registered negative control. See the
[mapping and controls](./container-keying/ContainerGrantScope.md).

### Container Keyring Reachability

[`container-keying/KeyringReachability.tla`](./container-keying/KeyringReachability.tla)
models cold recovery from persisted user/group recipient wraps, immutable
[predecessor bridges](../docs/glossary/keys.md#container-kek-predecessor-bridge),
and sealed historical
[keyrings](../docs/glossary/keys.md#container-kek-keyring). Its `Members`
abstraction is the set of users authorized by active direct-user or
same-organization group grants; organization principals are not recovery
recipients. `Descendants` extend it with child containers whose key epochs pin
the parent epoch current when they were minted: a descendant verifies against
any pinned epoch the parent's retained history still covers, and the negative
control `strict-parent-epoch-pin-strands-descendant` accepts only the parent's
current epoch, under which an ancestor rotation strands the subtree. An honest
rotation may also seal a forged entry, an invented epoch id over server-chosen
material that passes its material check, whether rebuilt for a repair or carried
in the served keyring. `RotationsSealOnlySignedLineage` requires that it never
does. Each projection's server chooses whether the lineage arrives under the
container's own KEK or its parent's; the control
`kek-history-anchor-seals-relocated-forgery` confines the check to the KEK's own
served history, and a forgery is sealed only once the server moves the lineage
under the parent. See the [mapping and boundaries](./container-keying/KeyringReachability.md).

[`container-keying/GroupGrantRevocation.tla`](./container-keying/GroupGrantRevocation.tla)
adds the group key as its own epoch dimension: container wraps sealed to a
group key outlive a revoked grant, so a revocation must rotate the group key
before an additive join hands that key out. It also checks batch completeness,
stale replans and that a requested change commits. See the
[mapping and boundaries](./container-keying/GroupGrantRevocation.md).

[`container-keying/OrganizationDirectoryKey.tla`](./container-keying/OrganizationDirectoryKey.tla)
checks the organization directory key: a directory write keeps the key while
the admins are unchanged or only grow (wrapping it for added admins) and the
writer can verify it, and rotates on any removal, so a removed admin never
holds the current key. See the
[mapping and negative controls](./container-keying/OrganizationDirectoryKey.md).

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
[Principal state](../docs/glossary/principals.md#principal-policy-state) models
cover [version availability](./container-keying/PrincipalHistory.md) and
[page verification](./container-keying/PrincipalHistoryPages.md), including
[authenticated resumption](./container-keying/PrincipalHistoryResume.md) and
[recovery reuse](./container-keying/PrincipalRecoveryReuse.md) with conditional
discovery.

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
required for writes). The API and SDK
[`ancestorRotationRecovery.test.ts`](../packages/api/src/routes/documents/ancestorRotationRecovery.test.ts)
and
[`ancestorRotationRecovery.test.ts`](../packages/client-sdk/src/workflows/containers/child/rekey/ancestorRotationRecovery.test.ts)
tests exercise those seams with signed manifests; the SDK test also uses actual
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
show that requiring stale [heads](../docs/glossary/sync.md#head) or chain
entries to cite the current authority bricks a device's reads. Its own write,
which the API accepts only at the current heads, must also eventually commit; a
writer that waits for the dependent to be re-signed first violates that. See the
[mapping, configurations, and boundary](./container-keying/NoBrickedDevice.md).

### Principal Reference Progress

[`container-keying/PrincipalReferenceProgress.tla`](./container-keying/PrincipalReferenceProgress.tla)
models current group references at commit and monotone references in signed
container history. See the [mapping and boundaries](./container-keying/PrincipalReferenceProgress.md).

## Document Sync

Models under [`document-sync/`](./document-sync), summarized in its
[index](./document-sync/README.md): sync lanes, baselines, deferred tails, the
outgoing-queue merge, false-span voids, recovery probes, metadata listings,
epoch advances, and attachment keys and content.

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
checks that persistent
[fingerprint-to-user bindings](../docs/developer/trusted-user-identity.md#pinning)
survive session recreation and stay unique per
[trust domain](../docs/glossary/principals.md#identity-trust-domain), and that only
[link or self pins](../docs/glossary/principals.md#identity-pin) directly admit
identities and new roster enrollments. See the
[mapping and boundaries](./local-trust/DurableIdentityBinding.md).

### Members Identity Commitments and Admission

[MemberIdentityCommitment](./local-trust/MemberIdentityCommitment.md) checks that
the signed group/organization projection commits the complete identity-link
bundle and that continuing members cannot change it.
[MemberIdentityChain](./local-trust/MemberIdentityChain.md) adds operation-local
transitive authentication from self/link roots through earlier Members admission
events, including departed signers. Its two configurations check twenty explicit
scenario machines, resource bounds, unsafe-admission refusal, and eventual
acceptance of valid bounded proofs. Neither model is a cryptographic proof or
an implementation-trace replay; persistent pin provenance remains unchanged.

### Queued Document Creation

[QueuedDocumentCreate](./local-trust/QueuedDocumentCreate.md) checks that a queued
store observes local purge before starting remote creation and that an obsolete
read cannot retire a replacement store generation. It also checks that a create
seed leaves the queue only once committed, and that a peer edit's hint
arriving before the create response still leads to a pull, and that a refused
bind carry neither drops the row nor publishes it unbound.

### Profile and Contact Identity

[ProfileDocumentIdentity](./local-trust/ProfileDocumentIdentity.md) checks
reopening materialized roster/organization profiles by their persisted local
identity, precedence of a known pointer and current/recovery identities,
discovery before or after birth, preservation of opaque content, and stale
lookup/open refusal. Stable-scope completion for existing profiles prevents a
refuse-everything resolver from satisfying the model.

[CanonicalMeSelection](./local-trust/CanonicalMeSelection.md) separately checks
canonical personal Me selection, current-format same-stream recovery,
ineligible-target refusal, and retained content. Matching fields on another
contact do not establish Me. Valid stable-scope targets must complete.

[ContactAddressRecovery](./local-trust/ContactAddressRecovery.md) bounds one
address draft and retry through queued admission, uncertain persistence,
clean-state row-ID reconciliation, and no-effect refusal. It checks local
acknowledgement and cancellation safety, not CRDT merge correctness or
unconditional retry progress.

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

[SystemDestination](./local-trust/SystemDestination.md) models
[signed destination roles](../docs/security-guarantees/overview.md#root-and-system-destinations),
acknowledged roots, administrator-only slot creation, and immutable root/system
parent edges.

[RootDocumentPriming](./local-trust/RootDocumentPriming.md) checks that documents
deferred during root verification are scheduled after remote acknowledgement.

[ContainerAuthoring](./local-trust/ContainerAuthoring.md) separates read proof
access from local signing authority and models an untrusted server echoing a plan
or forging its acknowledged head.

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
another, and that a request whose callers all retired neither renews the
session nor replays. See the
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
organization's new cursor, so a
[delta](../docs/organization-read-model-sync.md#snapshot-and-delta-contract)
from any cursor reloads every changed entity and never skips a change. A change
to Admins also stamps the directory, whose pending leave requests depend on the
reader's role, so a new administrator's next delta carries them. A mutation
that advances the head twice can hand its client the delta from the cursor it
held, built in its own transaction after its last stamp, without letting that
client skip a change. See the
[mapping and negative controls](./realtime/OrganizationReadModelStamps.md).

## Blob Attachments

Models under [`blob-attachments/`](./blob-attachments).

### Existing Blob Source Authority

[BlobSourceAuthority](./blob-attachments/BlobSourceAuthority.md) models existing
ciphertext binding with original-author or source-read authority in addition
to destination-write authority.

### Attachment Bind and Detach Document Versions

[`blob-attachments/AttachmentBindDocumentVersion.tla`](./blob-attachments/AttachmentBindDocumentVersion.tla)
models an upload racing another device's edits to its slot: the API refuses a
bind whose checked document version lacks a committed update, so an edit that
commits first always wins, and the uploader converges by its own pulls once
edits stop ([mapping](./blob-attachments/AttachmentBindDocumentVersion.md)).
[`AttachmentRemovedSlotDetach.tla`](./blob-attachments/AttachmentRemovedSlotDetach.tla)
models a removal that syncs after the bind, detached at a version holding
every committed op and the bind's own unsent ops
([mapping](./blob-attachments/AttachmentRemovedSlotDetach.md)).

### Pending Attachment Detach

[`blob-attachments/PendingAttachmentDetach.tla`](./blob-attachments/PendingAttachmentDetach.tla)
models a bind that commits before its response reaches the client or local
settlement finishes: removing the slot must preserve a detached row that the
current store's detach pass sees, before and after a restart. See the
[mapping and boundaries](./blob-attachments/PendingAttachmentDetach.md).

### Attachment Re-add Reconciliation

[`blob-attachments/AttachmentReaddReconcile.tla`](./blob-attachments/AttachmentReaddReconcile.tla)
models a removed slot coming back around the detach of its binding: another
device binding its re-add before the content update that records it, a merge
recording the slot again, a staged re-add that rolls back, and a restart. The
marker detaches its own copy's binding, or another blob's once a pull shows
the slot still removed, and settles against committed history before the
detach and again after it lands, so a re-add keeps or regains a binding and
its bytes, other bytes free the slot's first download, and a removal that
stands is cleaned up whichever copy it binds. See the
[mapping and boundaries](./blob-attachments/AttachmentReaddReconcile.md).

### Stage Promotion and Server Reclamation

[StagePromotion](./blob-attachments/StagePromotion.md) models
[staging](../docs/glossary/content.md#blob-stage), promotion, the sweep and stage
cleanup across the database and object store.

## Backup and Restore

Models under [`backup-restore/`](./backup-restore).

### Backup Restore Terminal Anchors

[`backup-restore/TerminalAnchors.tla`](./backup-restore/TerminalAnchors.tla)
models preservation of the three kinds of local trust anchor across full
database restores: immutable purge decisions, append-only incident evidence,
and monotone verification [checkpoints](../docs/glossary/sync.md#checkpoint),
including observations made after restore preflight. Its mapping lists every
production anchor table by kind and the tables deliberately left out. See the
[mapping and boundaries](./backup-restore/TerminalAnchors.md).
