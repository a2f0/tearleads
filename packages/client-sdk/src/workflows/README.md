# Client SDK Workflows

Workflow facades compose API, storage, verification, and sync without React or
UI. Private leases stay hidden; authority loaders take exact heads. See
[history recovery](../../../../docs/developer/principal-history-recovery.md) and
[authored mutation journals](../../../../docs/developer/principal-policy-outcomes.md).

## Host Contract

Hosts implement interfaces directly; the SDK does not adapt host or wire shapes.
See [initialization](../../../../docs/developer/sdk-initialization.md). `deviceFirst.open()`
returns the tree handle. Container creation commits
the container and its metadata document in one compound API request. Create,
document link/unlink, writer-projection, and sync adapters provide the
structured `Result` methods, including complete transport failures; nullable
mutation methods the SDK does not call are not required. Container persistence
provides atomic `saveContainerWithPendingUpdate` and revision-checked
create/move settlement and error recording. Saving an accepted create or move
settles its intent in the same transaction; an acknowledgment without that
settlement is rejected, and settlement is never unconditional. Reconciliation
takes container- or document-scoped hints; `enqueueIdleBackfill()` only queues
known containers for catch-up.

Startup performs no schema upgrades: a local database whose document tables lack
the required columns must be reset. Principal-policy warming verifies and
durably caches evidence; there is no verify-without-persistence mode. Group
cache writes require an explicit organization owner in the public cache/save
TypeScript interfaces, pinned in the same transaction as current policies,
retained history, and checkpoint-only updates. Persisted group evidence without
an owner refuses scoped purge and requires a full local reset. Native purchase
providers invoke the supplied `onProviderPresented` callback exactly when their
UI becomes uncancellable; there is no capability-negotiation fallback.

Membership writes bind `expectedGroupName` to decrypted group metadata before
recipient key use. Custom names require `readEncryptedName`; creation requires
`metadataAccess`. See the [SDK guide](../../../../docs/developer/client-sdk.md).

`submitJournaledPrincipalMutation` saves exact principal requests before HTTP;
`recoverJournaledPrincipalMutation` resolves saved work before authoring again.
The `Tearleads` runtime supplies this for compound and standalone organization
policies, group creation, and group deletion. `AuthoredPrincipalMutation` binds
each operation kind and route; `PrincipalMutationResponse` is the receipt union.
Custom `submit` callbacks must dispatch every authenticated kind to its matching
route: `compound`, `organization`, `group-create`, or `group-delete`. Missing
kinds are invalid. Preserve unreadable work until the host explicitly discards
it. Both nullable and result methods for all four operations may throw
`PendingPrincipalMutationError` or `PrincipalMutationOutcomeUnknownError`.
Hosts inspect saved work with `readJournaledPrincipalMutation` and explicitly
stop its retries with `abandonJournaledPrincipalMutation`, acknowledging that it
may have committed. `Tearleads.organizations` exposes
`readPendingPolicyMutation`, `retryPendingPolicyMutation`, and
`abandonPendingPolicyMutation` for host controls; Org Manager provides retry and
explicit stop-retrying actions. Unreadable inspection throws
`UnreadablePrincipalMutationError` with an opaque record identifier.
`discardUnreadableJournaledPrincipalMutation` and the facade's
`discardUnreadablePolicyMutation` discard only those unchanged local bytes after
explicit unknown-outcome acknowledgement; they never submit unreadable work.

## Facade Taxonomy

| Facade | Classification | Notes |
| --- | --- | --- |
| `blobs` | Platform runtime | Encrypted blob upload, hydration, decryption, and local byte-store helpers. |
| `containers` | Platform runtime | Container mutation planning, remote container operations (create/share/move/revoke/rekey), and KEK-history recovery: `rebuildKeyringEntriesFromLog` walks the kek-log bridge chain, `recoverKeyringEntryFromWraps` recovers a severed epoch from the caller's retained envelope, and `rekeyRemoteContainer` with `keyringEntriesOverride` seals the repaired keyring once its ids match the verified signed lineage; an override that a later rotation outdated throws `ContainerKeyringOverrideStaleError`, so rebuild it. Principal rotations rematerialize retained group grants against the current principal head by wrapping only the current epoch, so an older epoch anchored only by a group wrap from before a principal key rotation fails with `principal-key-unreachable`. A rekey, revoke, or move that the API refuses with `container_descendant_rekeys_required` is resubmitted once carrying the named descendant rekeys, signed parent-first and pinned as one batch, so a writer granted only further down never waits on another device; a share first re-keys a lazily stale chain above its container. `classifyContainerWriteRefusal` separates a retryable `ContainerKekRepairRequiredError` from a `ContainerKekRepairInaccessibleError` that waits on another member and from a `ContainerAuthorAccessError`. A local create or move past the readable path length throws `ContainerPathTooDeepError` (`code` `container_path_too_deep`) before anything is queued; a queued move the API refuses with that code is abandoned. |
| `documents` | Platform runtime | Document creation, persistence, sync (including the headless `syncRemoteDocument` boundary: require `validateIncomingUpdates`, normally backed by `validateDocumentSyncUpdateImports`, before durably applying a page; repair ancestor KEKs parent-first before writes, using `rekeyContainer` for bounded prefixes beyond the inline limit; abandon as `inaccessible`, keeping the writes queued, when the stale ancestor is one the writer cannot re-key; `buildContainerRekeys` can override this planning; stale-policy retries rebuild signed material; schedule another bounded pass for `hasDeferredPendingUpdates` or `hasIncompletePull`; and retain `readPullContinuation(result.response)` as the next input `pullContinuation`; built-in stores persist it in local SQLite), projection keys, document link-set helpers, local orphan/blob maintenance, and the discard-to-shell escape hatch for documents whose queued writes can never sync. |
| `container-contents` | Platform query and runtime | Container tree projections, container metadata documents, document discovery, document links, identity-wide pending-write diagnostics, compact attribution diagnostics, lazy paginated attribution ranges, and sync-state helpers. Product UI routes, panels, menus, and selection state belong in `packages/app`. |
| `organizations` | Platform organization administration | Transactional local directory, group-summary, group-membership, grant, policy-head, user-detail, and separately reconciled durable data-usage projections; opaque feed cursors; exact-head history from verified principal-policy storage; ID-only user membership mutations; the session user's own membership list and per-organization sync pauses, which keep a paused organization's metadata root and remove the rest of its local copy once its writes have uploaded; verified principal-policy mutation helpers; organization-scoped system-container slot helpers; sync-billing reads; direct Stripe checkout; server-authoritative native-purchase eligibility; and verified, explicitly organization-scoped native-subscription claims chosen after receipt verification by the atomic `PurchasesCapability.moveNativeSubscription` flow. Its destination-preparation callback runs outside the bounded server-claim deadline and durably replays one fresh restore organization across reloads until completion. Org Manager screens and labels belong in `packages/app`. |
| `principals` | Platform runtime | Verified online/offline policies with durable identity trust and [history recovery](../../../../docs/developer/principal-history-recovery.md). |
| `registration` | Platform runtime | Atomic bootstrap. `RegistrationApi.registerUser` requires the organization metadata container at argument 13; omitted roster arguments 11–12 are `undefined`, and profile documents are optional. |
| `root` | Platform operator administration | Root-only identity lookups for internal staff: identities by fingerprint prefix, user ID, or root flag, identity detail with live sessions, each identity's organizations, organizations by exact ID, organization detail with persisted billing/provider state and the latest 50 billing events, paged organization rosters linking back to identities, synced data usage and organization usage reports, a cross-organization ops-health report of seat-sync, trial-expiry and purge trouble, each organization's stored RevenueCat webhook deliveries and a report of unmatched or ignored ones, the paged root audit trail, optionally narrowed to one identity or organization, and suspending or lifting a non-root identity (`suspendRootIdentity`, `liftRootIdentitySuspension`). Locally gated on the session's server-reported root flag; the API enforces access. Root console screens belong in `packages/app`. |
| `sync` | Platform runtime | Shared sync coordinator helpers and organization-scoped remote-state reset/recovery inputs. `SyncLaneConfig.priority()` ranks eligible work within a phase: lower finite values first, default zero, with fair rotation among ties. A throw or nonfinite result uses zero. |

Name SDK facades after platform state; keep product names in the app. For
example, the SDK exports `workflows/organizations`, while the app keeps
`OrgManager` provider, route, and screen names in `packages/app`.

`bun run lint:architecture` guards this taxonomy by rejecting product window
vocabulary in SDK TypeScript source and by checking that this table lists every
workflow facade aggregated by the root SDK entry point once.

## Containers

Container mutation API implementations must provide `ContainerReciteApi`.
Acknowledged mutations schedule a bounded, best-effort pass over already-held
verified descendants: eight attempts per pass, spaced 250 ms apart, with no
fetches, retries, or blocking of the original operation. A re-cite advances the
manifest, not key material or grants. The pass is process-local and
cancellation-aware. Container mutation facades require `reportSecurityIncident`
for contradictory background acknowledgements. Re-citation stops at prior epoch
512, reserving half of the API's 1,024-entry same-KEK history for ordinary
writes. Organization grant revocation requires a live `stillCurrent` guard. The
client facade binds it, and group rematerialization cascades, to the captured
session, organization, signing identity, and database lifetime.

Container purge and Empty Trash first wait for the container and document moves
this device queued inside their scope: until the server accepts a move, the
scope cannot prove what it would destroy. The store requests a structural sync
pass and waits until the moves settle, a pass it requested leaves one queued or
parked, a 30-second ceiling passes, or `signal` aborts. `onMoveSettlement`
reports `"waiting"`, then `"unsettled"` if the wait ends with a move still
queued; that purge resolves `false` without deleting anything. Each unsettled
ending, and each accepted container move that a replay leaves queued, reports
through `util.logError` with a fixed message and no identifiers.

A queued container move settles even when the server accepted it and this
device lost the result: a stale pass, a failed acknowledgement, or a failed
local settlement reports and asks the lane for another pass after 1, 5, then 30
seconds. Its replay verifies the folder's writer projection first; when the
verified head already sits under the destination, it settles the intent from
that head and posts nothing, so a lost response costs no second key rotation
and does not wait for a reload. `formal/local-trust/ContainerMoveReplay.tla`
models the replay.

Custom hosts that construct a container-contents store directly must pair
`createContainerContentsStoreWorkflowRuntime(...)` with a
`ContainerContentsRootAdopter`. The narrower store runtime keeps stale-root
recovery capability compile-time required; general query workflows use
`createContainerContentsWorkflowRuntime(...)`.

The device-first read/write/reconcile seam lives outside the workflow facades.
`tearleads.deviceFirst.open()` binds the locally durable per-scope container
mutation store to `src/stores/local-projection` (synchronous reads) and
`src/sync/reconciliation` (background remote discovery). Product UIs consume
that unified handle rather than owning those modules or reopening the tree
store independently. See
[device-first reads and writes](../../../../docs/developer/device-first.md).

### Retained folder recovery

`ContainerDocumentQueries.listRecoveryFolders` exposes the names and queued-work
counts of dormant metadata in the selected organization. `discardRecoveryFolder`
requires its exact revision token and returns false after concurrent edits or
rehydration. This explicit local action never deletes remote documents, and
unsigned discovery never calls it. `RecoveryFolder` is exported from the SDK
root.

`ContainerDocumentQueries.listRecoveryFolderMoveIds` lists queued folder moves
whose local destination parent is unavailable. Recovery uses it to distinguish
local work from shared folders with inaccessible parents.

### Explorer hydration and pending downloads

Explorer queries omit remote document shells until content is present,
including paginated counts. Explorer requests direct summaries with
`loadDocumentSummary(id, { requireHydrated: true })`; ordinary identity reads
still include shells. Orphan-route identity checks use the scoped
`loadOrphanedDocumentSummary` read before requesting `requireHydrated: true`
content. `ContainerNode.metadataReady` is false for remote folders awaiting
metadata; consumers can hide these nodes without removing their sync
registrations. `containerContents.documentQueries()` exposes
`listPendingDownloads()` and `PendingDownloadQueueItem` for known document and
folder metadata pulls (initial hydration or remaining pages), including durable
errors. The queue does not estimate undiscovered objects or on-demand blob
reads.

## Documents

The documents facade admits explicit `historyMode: "raw"` reads through
`syncRemoteDocument`. A raw consumer must start at a null version vector, send
no writes, validate every bounded page in scratch state, and publish only after
the complete retained frontier validates. The built-in rotation preflight is
the reference consumer; ordinary sync omits the mode. Raw consumers can handle
`DocumentRawHistoryUnavailableError` by its stable code and numeric content-key
epoch without parsing an integrity-error message.

Document stores and container metadata report incoming-update quarantines
through the optional `util.logError(message, error)` callback after recording
the durable failure. The `Tearleads` client supplies its host logger; direct
runtime consumers can provide their own. Preserve the original `Error` for host
diagnostics and apply privacy filtering there. Identical repeats within a live
document do not call the host again. Stale generations do not report, and
logger throws or rejections do not replace the quarantine.

Document stores report failed local writes through the same callback. The write
chain swallows its errors so an un-awaited edit cannot reject, which would
otherwise leave a failed content, row, or attachment persist invisible; the
store passes the original `Error` to `logError`, suppressing an identical repeat
per store and treating a vanished database as teardown rather than a fault. The
container-contents local refresh and the link/unlink/move/purge choke point
report the same way, alongside their local log line and without changing their
failure contract. A thrown container share reports before it rethrows. Hosts
filter their own catches with the documents facade's
`isDatabaseUnavailableError` and the containers facade's
`isProjectionVerificationCancelledError`, both exported from the SDK root.

### Persistence adapters

Custom `DocumentsPersistence` adapters implement the atomic create, enqueue,
commit, snapshot-load, hydration, and orphan-blob contract described in
[custom document persistence](../../../../docs/developer/custom-document-persistence.md).
Store maintenance uses the required `orphanBlobs` methods for every adapter, so
shared bytes survive until their final reference is removed; explicit
`reclaimDocumentOrphanBlobs(runtime, persistence)` awaits the complete
requested maintenance run.

### Deferred initial update

A store opened with `DocumentStoreOpenOptions.deferInitialUpdate` (an Explorer
file import) creates without that initial outgoing update and persists the
empty version as its outgoing marker. Scheduled sync waits until the first
`attachFiles` settles, so one update carries the birth and the attachment; a
failed attach enqueues the birth alone. A write that advances the marker, a
reset, or a failed initialization also lifts the wait, and a caller that gives
up before attaching releases it with `attachFiles([])`. The store factories
take that option, with `remoteSyncMode`, as a trailing
`DocumentStoreOpenOptions` object. Its `initialStructuredFields` and
`initialRows` join the birth update when the open creates the record.

### Persistence notifications

`PersistedDocumentListener` supplies a summary and `placementChanged` flag.
Creates, identity changes, and structural relinks set it and invalidate
in-flight reads. Ordinary content saves allow an initial read before the
trailing refresh. See
[document links](../../../../docs/developer/document-links.md).

### Remote deletion

Remote document deletion commits its verified terminal purge checkpoint in the
same local transaction as the matching document teardown. An interruption,
stale store generation, or identity replacement leaves both operations
uncommitted so the current generation can retry the retained proof. The public
entry point is `tearleads.containerContents.documentLinks().purgeDocument({
note })`. A remote document must have exactly one remaining container link;
recursive container purge unlinks any additional in-subtree links before
calling it. `null` means the purge was refused or could not be verified, and
callers must retain the local document. Recorded readers get signed genesis
history and its container/policy dependencies; purge-path access alone reveals
a terminal snapshot. The SDK authenticates before enforcing local pins, then
reuses the proof without a checkpoint-floor retry. Deletion requires an exact
pin or signed transitions from a pin or genesis. Missing history without a pin
defers deletion without an incident; snapshots cannot advance existing pins.
Later container pins fail closed because ancestry cannot order the separate
purge signature. Lost-response purge retries use this same flow.

Principal dependencies arrive as `policyEvidence` sources and signed directory
bindings. Built-in purge and remote deletion handlers use the private paged
resolver. Baseline recovery can retain checkpoint inclusion proofs but does not
compare or advance trust until the complete terminal proof authenticates. The
final transaction pins those verified observations and registers the
identity/database lease through the outer commit, including when a caller
performs document teardown after the nested proof commit. Hosts supplying
standalone purge handlers must forward the same resolver and `stillCurrent`
predicate used by their sync workflows. When local policy pins are newer than
the purge sources, the resolver's `resolveReference` capability connects their
ancestry with `preferLocalHistory`. It reuses private local proofs before
authorized online paging. Those recovered heads are checked for currency and
never admitted by the purge.

## Sync

The `sync` facade exposes read-only coordinator snapshots through
`getDomainSyncCoordinatorSnapshot(...)` and
`subscribeToDomainSyncCoordinator(...)`. Host diagnostics and product UI may use
those snapshots to show lane status, request/run/error counts, and last action
timestamps without reaching into coordinator internals or owning sync policy.

`clearRemoteSyncState(execSql, { organizationId })` clears the organization's
remote-derived rows and child/document cursors, plus the global root-list
cursor. It retains local Loro history for republish, principal-policy
checkpoints and ownership, and container/document access-manifest checkpoints
to detect rollback and forks. Cursor keys omit the selected organization. A
post-purge reset takes fresh organization/root ids through `replacement`.
`session.recoverPurgedOrganization(...)` verifies signed replacement intent
before reset. Until the replacement has sync-eligible billing, it exposes those
ids through `PurgedOrganizationRecoveryBillingRequiredError`. It then rebinds
retained local data and finalizes the server's default-organization pointer.

Workflow code consumes the resolved `runtime.state.online` value. Host-level
network detection and any manual online/offline override belong to the SDK
`tearleads.network` runtime state, not individual workflow facades.

## Blobs, Keys, and Identity

The `blobs` facade also exports encrypted local blob store helpers, including
`createLazyEncryptedBlobStore` for hosts that load encryption keys from an async
keyring provider. `BlobByteSource` is the replayable range-read contract used by
large attachment writes and multipart uploads; blob stores implement
`openByteSource` and `writeByteSource` so those paths stay bounded by the 5 MiB
chunk size instead of materializing the whole object.

Local keyring variants, including WebView and PIN-code wrapping helpers, are
client-facade exports rather than workflow facades. Keep platform keychain
composition in `client/*` so workflow modules stay focused on domain
operations. Hosts close a retired keyring through its optional public `close()`
lifecycle contract so browser-backed variants can release their IndexedDB
connections; callers still dispose the sessions they own.

Seed phrase generation/import lives on the `tearleads.identity` client facade.
The phrase derives identity key pairs only; product backup/restore UX and any
session/container recovery metadata stay in host/app code.

The `tearleads.userIdentities` gateway's `resolve` uses TOFU; `createLink`
encodes keys; `verifyLink` checks before pinning; `resolvePinned` reads any pin,
including TOFU
([trust scope](../../../../docs/developer/trusted-user-identity.md#identity-links)).
Workflows accept opaque trusted bundles or gateway-resolved user IDs. Raw API
identity and directory responses must not reach signature or encryption
helpers. Lower-level integration tests may use `@tearleads/client-sdk/testing`
to construct the nominal test values; production source must not import it.

Trust-boundary failures are terminal and feed the client-owned
`tearleads.securityIncidents` ledger. Workflow runtimes receive only its
internal reporter; they cannot clear the durable table. Equivalent detections
increment a repeat count, and each trust domain retains its 1,000 most recently
detected rows. Network and SQLite availability errors are not incidents.
Incident rows exclude exception messages, ciphertext, and decrypted values, and
remote-state reset does not erase them.

## Organizations

Organization billing views expose subscription ownership and direct
cancellation availability in the billing snapshot. The management URL read
returns only the native store link; it does not gate inline Stripe
cancellation. Provider-neutral purchase errors live in
`client/billing/purchaseErrors.ts`, outside the organization workflow facade;
callers can distinguish retryable identity races from provider stalls that
require an app restart.

Organization directory, group-summary, state-hash-bound membership, grant, and
policy-head rows are presentation projections. The SDK reconciles them through
the strict version 6 organization read-model feed, refusing any other version,
and keeps the opaque cursor in the same SQLite transaction as each applied
page. A retained-log cursor gap atomically replaces the affected organization's
projection from a new snapshot.

Organization data usage stays outside that feed because content and blob
writes do not share its administrative cursor. The SDK stores the strict
aggregate in a requester-scoped SQLite projection, paints it locally, and
single-flights canonical revalidation. Transient failures retain the
last-known-good projection; authoritative access loss purges it. If SQLite
rejects the purge transaction, the current executor still fails closed in
memory; physical rows can remain until a later successful canonical reconcile
replaces or removes them.

Grant lists, group containers, and user details are derived from this local
projection. User-detail group reachability is cycle-safe and traverses hidden
groups before filtering the displayed group catalog. Encrypted org/group labels
use a separate root with Admins/admin and Members/read grants. Container names
are joined from local encrypted metadata. Group containers repaint
independently from the local grants lane. State-hash and member-count checks
prevent torn local views, but do not make presentation rows authoritative.
`isSelf` is derived from the active user, while `isOrgAdmin` is
requester-scoped and UI-only. Metadata profile upload is a separate idempotent
content sync and never changes grants.

Group mutations are authorized through the verified reserved `Admins` policy.
Before committing a principal rotation, the client derives the complete
container batch from verified writer projections; the API atomically rejects
any transition that leaves a stale principal pin. Policy mutation receipts omit
the historical prefix. The client verifies the exact authored state and
artifacts. Built-in member changes and group revocation use bounded current
evidence and atomically retain authenticated progress. The public
`OrganizationGroupMutationReceipt` omits `previousStates`; explicit standalone
complete-bundle utilities retain their own contracts. See
[current mutations](../../../../docs/developer/principal-current-mutations.md).

### Policy history

`loadGroupPresentationDetails(groupId, beforeVersion?)` combines local members
with up to 32 authenticated history entries on the first page; older-page calls
return `members: null` without a member read.
`policyHistory.nextBeforeVersion` is an exclusive cursor for older entries, or
null at genesis. Each page verifies index proofs against a privately
authenticated prefix and retains its real predecessor for membership diffs. The
projected head bounds the displayed history even when local recovery has
already verified a newer head. Group history requires private paged recovery;
without custody it is unavailable, and no complete-bundle fallback exists. Raw
responses are never rendered.

`Organizations.loadPolicyHistory(beforeVersion?)` likewise selects 32
organization entries and an authenticated predecessor. Compact roster-scoped
history sources prove the exact referenced group states, including deleted
groups, without importing complete group snapshots or admitting their
checkpoints. Its optional cursor is exclusive; older-page failures preserve the
visible rows. This organization view requires private paged recovery from the
host.

Organization policy history details are derived in memory from existing signed
records returned by `GET /organizations/:organizationId/policy-history`, bound
to the exact selected organization state hash. Historical directory payloads
are checked against their signed hashes, and group membership/grant snapshots
are verified against every referenced directory head. This read endpoint is
available to current organization members, including non-admin members.
`OrganizationPolicyHistoryEntry.groupChanges` describes group creation,
deletion, membership, grants, and key rotation; `null` means the additional
evidence is unavailable. The exported `OrganizationPolicyGroupChange` and
`OrganizationPolicyGrantChange` types describe those details. They are not
persisted: there are no database columns, decrypted name snapshots, or stored
summaries for them. A memory cache reuses verified details at the same head
within the current identity/database scope; access-generation changes
invalidate cached entries. The app resolves current group names and roster
profile names through existing local projections; missing or deleted names fall
back to identifiers. Offline history retains its verified policy entries and
reports unavailable group details explicitly. Authoritative access denial purges
organization presentation through the access-revocation path.

## Registration

Registration validates local identity public keys before the API call and pins
only the server-confirmed user. The session facade returns
`SessionRegistrationRefusal` (`status: "identity-already-bound"`, `userId`) when
the device already binds that key, distinct from an unconfirmed `null` result.
Hosts should try login, and explain that an intentional environment reset
requires clearing local app data if that recovery cannot find the account.

## Principal History Recovery

Standalone document and container runtimes require private
`withPrincipalHistoryProtection: PrincipalHistoryProtectionLease` for built-in
history recovery. Store and derived-document adapters inherit custody without
exposing the callback on returned runtime views. This includes
[current group sharing](../../../../docs/developer/principal-current-sharing.md).
Hosts own key cleanup and lease invalidation on authority/storage changes, as
specified in the principal-history recovery guide.

`recoverProjectionPolicyHistory` resolves compact projection sources into
verified historical authorization selections. Standalone hosts provide private
local protection, the projection's manifest references, trusted identity
resolution, and a lifetime predicate. Attach it through the policy warmer's
`resolveProjectionHistory` capability and return the same lifetime predicate
with the selections. Projection verification rechecks that lifetime and the
latest local pins at final admission. Historical selections never advance
current-policy checkpoints or become current key material. Attachment detach,
hydration, retained-wrap checks, and relinking accept the same private policy
warmer and operation-lifetime guard; the document store supplies both.

`retainAcknowledgedPrincipalCurrents` atomically retains exact policy receipts,
authenticated resumable progress, checkpoints, and signed-grant retirements. It
requires the captured predecessor and a consistent durable pin. An
`initialGroup: true` entry instead verifies a genuine group genesis with
version one and no predecessor, paired with its exact signed directory
successor. Both publish atomically, and existing checkpoint or prefix conflicts
still fail; see
[current mutation primitives](../../../../docs/developer/principal-current-mutations.md).

`captureAcknowledgedPrincipalPredecessor` captures sealed evidence before
sending the mutation. Each acknowledgement requires this
`AcknowledgedPrincipalPredecessor` in `predecessor` (null only for a newly
created group). A newer authenticated prefix must prove the exact receipt
belongs to its history; its progress and checkpoint remain monotonic.
Concurrent local publication retries retention without resubmitting the
request. The public `AcknowledgedPrincipalCurrentInput` and
`AcknowledgedPrincipalCurrentRetirement` types describe batch inputs and
signed-grant retirements.

## API Request Counts

`tearleads.apiRequests` exposes in-memory HTTP attempt counts by identity and
endpoint. Hosts can retain an `ApiRequestMetrics` store across client
lifetimes. See the
[SDK request-count contract](../../../../docs/developer/client-sdk.md#api-request-counts)
for snapshot, subscription, reset, lifetime, and transport-outcome semantics.
