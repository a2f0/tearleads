# Client SDK Workflows

Workflow facades compose API, storage, verification and sync without React or UI.
Private leases stay hidden; authority loaders take exact heads. See
[history recovery](../../../../docs/developer/principal-history-recovery.md) and
[authored mutation journals](../../../../docs/developer/principal-policy-outcomes.md).

## Current Host Contract

Hosts implement the current interfaces directly; the SDK does not adapt older
hosts or wire responses. `deviceFirst.open()` is the sole unified tree handle.
Container creation always commits the container and its metadata document in
one compound API request. Create, document link/unlink, writer-projection, and
sync adapters provide their required structured `Result` methods, including
complete transport failures. Unused nullable mutations are not host requirements.
Container persistence provides atomic `saveContainerWithPendingUpdate` and
revision-checked create/move settlement and error recording. Saving an accepted
create or move must also settle its intent in the same transaction; an
acknowledgment without that settlement is rejected. There is no two-step save
and settle, unconditional settlement, or three-argument error-recorder fallback.
Reconciliation's `enqueueIdleBackfill()` performs catch-up only; scoped events
replace the force argument and `flushPendingUnscopedInvalidation()` method.

Local document tables must contain the current required columns; obsolete tables
require reset, not an additive upgrade. Principal-policy warming verifies and
durably caches evidence; it has no verify-without-persistence mode. Group cache
writes require an explicit organization owner in the public cache/save
TypeScript interfaces. It is pinned in the same transaction as current policies,
retained history, and checkpoint-only updates. Unowned
persisted group evidence refuses scoped purge and requires a full local reset. Native
purchase providers invoke the supplied `onProviderPresented` callback exactly
when their UI becomes uncancellable, with no capability-negotiation fallback.
Historical signed manifests and sealed keyrings remain current security
evidence, not compatibility formats.

Membership writes bind `expectedGroupName` to decrypted group
metadata before recipient key use. Custom names require `readEncryptedName`;
creation requires `metadataAccess`. See the [SDK guide](../../../../docs/developer/client-sdk.md).
`submitJournaledPrincipalMutation` saves exact principal requests before HTTP;
`recoverJournaledPrincipalMutation` resolves saved work before authoring again.
The `Tearleads` runtime supplies this for compound and standalone organization
policies, group creation and group deletion. `AuthoredPrincipalMutation` binds
each operation kind and route; `PrincipalMutationResponse` is the receipt union.
Custom `submit` callbacks must dispatch every authenticated kind to its matching
route, including absent kind for compound policies. SDK downgrades are unsupported
while a request is pending; retain its bytes for recovery with a supported SDK.
Both nullable and result methods for all four operations may throw
`PendingPrincipalMutationError` or `PrincipalMutationOutcomeUnknownError`.
Hosts can inspect saved work with
`readJournaledPrincipalMutation` and explicitly stop its retries with
`abandonJournaledPrincipalMutation`, acknowledging that it may have committed.
`Tearleads.organizations` exposes `readPendingPolicyMutation`,
`retryPendingPolicyMutation` and `abandonPendingPolicyMutation` for host controls;
Org Manager provides retry and explicit stop-retrying actions.
Unreadable inspection throws `UnreadablePrincipalMutationError` with an opaque
record identifier. `discardUnreadableJournaledPrincipalMutation` and the facade's
`discardUnreadablePolicyMutation` discard only those unchanged local bytes after
explicit unknown-outcome acknowledgement; they never submit unreadable work.

## Facade Taxonomy

| Facade | Classification | Notes |
| --- | --- | --- |
| `blobs` | Platform runtime | Encrypted blob upload, hydration, decryption, and local byte-store helpers. |
| `containers` | Platform runtime | Container mutation planning, remote container operations (create/share/move/revoke/rekey), and KEK-history recovery: `rebuildKeyringEntriesFromLog` walks the kek-log bridge chain, `recoverKeyringEntryFromWraps` recovers a severed epoch from the caller's retained current envelope, and `rekeyRemoteContainer` with `keyringEntriesOverride` seals the repaired keyring once its ids match the verified signed lineage; an override that a later rotation outdated throws `ContainerKeyringOverrideStaleError`, so rebuild it. Principal rotations rematerialize retained group grants against the current principal head, so recovery does not depend on historical principal keys. A rekey, revoke, or move that the API refuses with `container_descendant_rekeys_required` is resubmitted once carrying the named descendant rekeys, signed parent-first and pinned as one batch, so a writer granted only further down never waits on another device; a share first re-keys a lazily stale chain above its container. `classifyContainerWriteRefusal` separates a retryable `ContainerKekRepairRequiredError` from a `ContainerKekRepairInaccessibleError` that waits on another member and from a `ContainerAuthorAccessError`. A local create or move past the readable path length throws `ContainerPathTooDeepError` (`code` `container_path_too_deep`) before anything is queued; a queued move the API refuses with that code is abandoned. |
| `documents` | Platform runtime | Document creation, persistence, sync (including the headless `syncRemoteDocument` boundary: require `validateIncomingUpdates`, normally backed by `validateDocumentSyncUpdateImports`, before durably applying a page; repair ancestor KEKs parent-first before writes, using `rekeyContainer` for bounded prefixes beyond the inline limit; abandon as `inaccessible`, keeping the writes queued, when the stale ancestor is one the writer cannot re-key; `buildContainerRekeys` can override this planning; stale-policy retries rebuild signed material; schedule another bounded pass for `hasDeferredPendingUpdates` or `hasIncompletePull`; and retain `readPullContinuation(result.response)` as the next input `pullContinuation`; built-in stores persist it in local SQLite), projection keys, document link-set helpers, local orphan/blob maintenance, and the discard-to-shell escape hatch for documents whose queued writes can no longer sync. |
| `container-contents` | Platform query and runtime | Container tree projections, container metadata documents, document discovery, document links, identity-wide pending-write diagnostics, compact attribution diagnostics, lazy paginated attribution ranges, and sync-state helpers. Product UI routes, panels, menus, and selection state belong in `packages/app`. |
| `organizations` | Platform organization administration | Transactional local directory, group-summary, group-membership, grant, policy-head, user-detail, and separately reconciled durable data-usage projections; opaque feed cursors; exact-head history from verified principal-policy storage; ID-only user membership mutations; verified principal-policy mutation helpers; organization-scoped system-container slot helpers; sync-billing reads; direct Stripe checkout; server-authoritative native-purchase eligibility; and verified, explicitly organization-scoped native-subscription claims chosen after receipt verification by the atomic `PurchasesCapability.moveNativeSubscription` flow. Its destination-preparation callback runs outside the bounded server-claim deadline and durably replays one fresh restore organization across reloads until completion. Org Manager screens and labels belong in `packages/app`. |
| `principals` | Platform runtime | Verified online/offline policies with durable identity trust and [history recovery](../../../../docs/developer/principal-history-recovery.md). |
| `registration` | Platform runtime | Atomic bootstrap. `registerUser` requires metadata at argument 13; omitted roster arguments 11–12 are `undefined`. Profile bodies remain optional. |
| `root` | Platform operator administration | Root-only identity lookups for internal staff: paged identity listing with fingerprint filter, identity detail with live sessions, per-identity organization membership, searchable organization pages, organization detail with persisted billing/provider state and the latest 50 billing events, paged organization rosters linking back to identities, and [synced data usage and organization usage reports](../../../../docs/developer/client-sdk.md#advanced-configuration). Locally gated on the session's server-reported root flag; the API enforces access. Root console screens belong in `packages/app`. |
| `sync` | Platform runtime | Shared sync coordinator helpers and organization-scoped remote-state reset/recovery inputs. |

Organization billing views expose subscription ownership and direct cancellation
availability in the billing snapshot. Current clients use management URL reads
only for the native store link; they do not gate inline Stripe cancellation.
The management response retains its cancellation field for installed clients.

Container mutation API implementations must provide `ContainerReciteApi`.
Acknowledged mutations schedule a bounded, best-effort pass over already-held
verified descendants: eight attempts per pass, spaced 250 ms apart, with no
fetches, retries, or blocking of the original operation. A re-cite advances the
manifest, not key material or grants. The pass is process-local and
cancellation-aware.
Container mutation facades require `reportSecurityIncident` for contradictory
background acknowledgements. Re-citation stops at prior epoch 512,
reserving half of the API's 1,024-entry same-KEK history for ordinary writes.
Organization grant revocation requires a live `stillCurrent` guard. The client
facade binds it, and group rematerialization cascades, to the captured session,
organization, signing identity, and database lifetime.

The documents facade also admits explicit `historyMode: "raw"` reads through
`syncRemoteDocument`. A raw consumer must start at a null version vector, send
no writes, validate every bounded page in scratch state, and publish only after
the complete retained frontier validates. The built-in rotation preflight is
the reference consumer; ordinary sync must omit the mode. Raw consumers can
handle `DocumentRawHistoryUnavailableError` by its stable code and numeric
content-key epoch without parsing an integrity-error message.

Document stores and container metadata report incoming-update quarantines
through the optional `util.logError(message, error)` callback after recording
the durable failure. The `Tearleads` client supplies its host logger; direct
runtime consumers can provide their own. Preserve the original `Error` for
host diagnostics and apply privacy filtering there. Identical repeats within a
live document do not call the host again. Stale generations do not report, and
logger throws or rejections do not replace the quarantine.

Document stores report failed local writes through the same callback. The
write chain swallows its errors so an un-awaited edit cannot reject, so a
failed content, row, or attachment persist is otherwise invisible; it now
reaches `logError` with the original `Error`, suppressing an identical repeat
per store and treating a vanished database as teardown rather than a fault.
The container-contents local refresh and the link/unlink/move/purge choke
point report the same way, keeping their existing local log line and failure
contract unchanged. A thrown container share reports before it rethrows.
Hosts filter their own catches with the documents facade's
`isDatabaseUnavailableError` and the containers facade's
`isProjectionVerificationCancelledError`, both exported from the SDK root.

The `sync` facade exposes read-only coordinator snapshots through
`getDomainSyncCoordinatorSnapshot(...)` and
`subscribeToDomainSyncCoordinator(...)`. Host diagnostics and product UI may use
those snapshots to show lane status, request/run/error counts, and last action
timestamps without reaching into coordinator internals or owning sync policy.
`clearRemoteSyncState(execSql, { organizationId })` clears the organization's
remote-derived rows and child/document cursors, plus the global root-list
cursor. It retains local Loro history for republish, principal-policy checkpoints
and ownership, and container/document access-manifest checkpoints to detect
rollback and forks. Cursor keys omit the selected organization.
A post-purge reset takes fresh organization/root ids through `replacement`.
`session.recoverPurgedOrganization(...)` verifies signed replacement intent
before reset.
Until the replacement has sync-eligible billing, it exposes those ids through
`PurgedOrganizationRecoveryBillingRequiredError`. It then rebinds retained local
data and finalizes the server's default-organization pointer.

Provider-neutral purchase errors live in
`client/billing/purchaseErrors.ts`, outside the organization workflow
facade; callers can distinguish retryable identity races from provider
stalls that require an app restart.

Workflow code consumes the resolved `runtime.state.online` value. Host-level
network detection and any manual online/offline override policy belongs to the
SDK `tearleads.network` runtime state, not individual workflow facades.

Custom hosts that construct a container-contents store directly must pair
`createContainerContentsStoreWorkflowRuntime(...)` with a
`ContainerContentsRootAdopter`. The narrower store runtime keeps stale-root
recovery capability compile-time required; general query workflows can continue
to use `createContainerContentsWorkflowRuntime(...)`.

The device-first read/write/reconcile seam lives outside the workflow facades.
`tearleads.deviceFirst.open()` binds the locally durable per-scope container
mutation store to `src/stores/local-projection` (synchronous reads) and
`src/sync/reconciliation` (background remote discovery). Product UIs consume
that unified handle rather than owning those modules or reopening the tree
store independently. See `docs/developer/device-first.md`.

Custom `DocumentsPersistence` adapters implement the current flag-day document
durability contract. `createDocumentWithHistoryCheckpoint(...)` must atomically
create the canonical record, standard and host projections, birth checkpoint,
and optional initial outgoing update plus history tail. It must return `null`
when another initializer owns the local id.
`enqueuePendingUpdate(...)` must atomically append both the outgoing queue row
and its local durable-history tail row. When given `expectedDocumentId`, it
returns `false` without writing either row if the canonical identity is absent
or differs. Callers treat that false result as normal compare-and-set loss and
reload the winner. `commitDocumentMutation(...)` includes an ordinary local
edit's optional attachment rows, outgoing update, matching history tail,
snapshot frontier, and projections in its complete-record CAS transaction.
`loadDocumentStoreState(...)` must return the canonical record, history, and
attachment rows from one database snapshot so startup cannot cross a relink.
`saveHydratedAttachment(...)` must compare `expectedStorageKey` with the durable
slot and `expectedSnapshotEndVersion` with the canonical row for the attachment's
local document id inside one immediate transaction. A `null` expected version
requires that document row to be absent. Its synchronous current-intent guard runs
immediately before commit dispatch. Either comparison or guard can refuse the
commit with `false`; replaced or refused bytes enter reference-checked reclaim.
`findLocalIdByDocumentId(...)` must preserve a duplicate row carrying queued
updates or a deferred-sync frontier behind its snapshot; otherwise it selects
deterministically by descending update time and local id. This lets a restarted
store adopt the same local owner without discarding unsynced work.
`deleteDocumentSideRowsIfAbsent(...)` likewise owns one transaction spanning
the canonical absence check, remote-document alias rejection, and orphaned
side-row/client-projection cleanup.
There is no separate attachment-staging commit, legacy create, or void-enqueue
fallback.

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

Remote user identity material is a data-layer trust boundary shared by
workflows, not an ad hoc key fetch. The `tearleads.userIdentities` facade
exposes the same pinned identity gateway to host-owned contact projections.
Workflow inputs accept the opaque trusted bundle or a user id resolved by the
injected gateway; raw identity endpoint and organization response objects must
not reach signature or encryption helpers.
Lower-level integration tests may use `@tearleads/client-sdk/testing` to
construct the nominal test values; production source must not import it.

Trust-boundary failures are terminal and feed the client-owned
`tearleads.securityIncidents` ledger. Workflow runtimes receive only its
internal reporter; they cannot clear the durable table. Equivalent detections
increment a repeat count, and each trust domain retains its 1,000 most recently
detected rows. Network and SQLite availability errors are not incidents.
Incident rows intentionally exclude exception messages, ciphertext, and
decrypted values, and remote-state reset does not erase them.

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
a terminal snapshot. The SDK authenticates before reading local pins, then
reuses the proof without a checkpoint-floor retry. Deletion requires an exact
pin or signed transitions from a pin or genesis. Missing history without a pin
defers deletion without an incident; snapshots cannot advance existing pins.
Later container pins fail closed because ancestry cannot order the separate
purge signature. Lost-response purge retries use this same flow.

Organization directory, group-summary, state-hash-bound membership, grant, and
policy-head rows are presentation projections. The SDK reconciles them through
the strict version 6 organization read-model feed and keeps the opaque cursor in
the same SQLite transaction as each applied page. Version changes are flag-day
resets that discard the old projection instead of upgrading it; a retained-log
cursor gap atomically replaces the affected organization's projection from a
new snapshot. Local storage contains only the current projection schema, with no
alternate HTTP path.

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
are joined from local encrypted metadata. `loadGroupPresentationDetails(groupId,
beforeVersion?)` combines local members with up to 32 authenticated history
entries on the first page; older-page calls return `members: null` without a
member read. `policyHistory.nextBeforeVersion` is an exclusive cursor for older
entries, or null at genesis. Each page verifies index proofs against a privately
authenticated prefix and retains its real predecessor for membership diffs.
The projected head bounds the displayed history even when local recovery has
already verified a newer head. Hosts without private paged recovery retain the
complete-bundle path for cursor-free calls and reject explicit cursors;
verification failures never downgrade to that path. Raw responses are never
rendered. Group containers repaint independently from the local grants lane.
State-hash and member-count checks prevent torn local views, but do not make
presentation rows authoritative. `isSelf` is derived from the active user, while
`isOrgAdmin` is
requester-scoped and UI-only. Group mutations are authorized through the
verified reserved `Admins` policy. Before committing a principal rotation, the
client derives the complete container batch from verified writer projections;
the API atomically rejects any transition that leaves a stale principal pin.
Policy mutation receipts omit the historical prefix. The client verifies the
exact authored state and artifacts. Built-in member changes and group revocation
use bounded current evidence and atomically retain authenticated progress. The
public `OrganizationGroupMutationReceipt` does not require `previousStates`;
full-bundle hosts and standalone workflows can still return it. See
[current mutations](../../../../docs/developer/principal-current-mutations.md).
Metadata profile upload remains a separate idempotent content sync and never
changes grants.

Name SDK facades after platform state; keep product names in the app.
For example, the SDK exports `workflows/organizations`, while the app can keep
`OrgManager` provider, route, and screen names in `packages/app`.

`bun run lint:architecture` guards this taxonomy by rejecting product window
vocabulary in SDK TypeScript source and by checking that this table lists every
workflow facade aggregated by the root SDK entry point once.

## Document persistence notifications

`PersistedDocumentListener` supplies a summary and `placementChanged` flag.
Creates, identity changes, and structural relinks set it and invalidate in-flight
reads. Ordinary content saves allow an initial read before the trailing refresh.
See [document links](../../../../docs/developer/document-links.md).

## Registration

Registration validates local identity public keys before the API call and pins
only the server-confirmed user. The session facade returns
`SessionRegistrationRefusal` (`status: "identity-already-bound"`, `userId`) when
the device already binds that key, distinct from an unconfirmed `null` result.
Hosts should try login, and explain that an intentional environment reset
requires clearing local app data if that recovery cannot find the account.

Organization policy history details are derived in memory from existing signed
records returned by `GET /organizations/:organizationId/policy-history`, bound
to the exact selected organization state hash. Historical directory payloads
are checked against their signed hashes, and group membership/grant snapshots
are verified against every referenced directory head. This read endpoint is
available to current organization members, including non-admin members.
`OrganizationPolicyHistoryEntry.groupChanges` describes group creation,
deletion, membership, grants, and key rotation; `null` means the additional
evidence is unavailable. The exported `OrganizationPolicyGroupChange` and
`OrganizationPolicyGrantChange` types describe those details. No new database
columns, decrypted name snapshots, or persisted summaries are introduced.
A memory cache reuses verified details at the same head within the current
identity/database scope; access-generation changes invalidate cached entries.
The app resolves current group names and roster profile names through existing
local projections; missing or deleted names fall back to identifiers. Offline
history retains its verified policy entries and reports unavailable group
details explicitly. Authoritative access denial purges organization presentation
through the existing access-revocation path.

## Retained folder recovery

`ContainerDocumentQueries.listRecoveryFolders` exposes the names and queued-work
counts of dormant metadata in the selected organization. `discardRecoveryFolder`
requires its exact revision token and returns false after concurrent edits or
rehydration. This explicit local action never deletes remote documents. Unsigned
discovery never calls it. `RecoveryFolder` is exported from the SDK root.

`ContainerDocumentQueries.listRecoveryFolderMoveIds` lists queued folder moves
whose local destination parent is unavailable. Recovery uses it to distinguish
local work from shared folders with inaccessible parents.

Standalone document and container runtime constructors accept a private
`withPrincipalHistoryProtection: PrincipalHistoryProtectionLease` input. It enables
their built-in history resolvers and passes through store/derived-document
adapters without exposing the callback on returned runtime views. Hosts retain
responsibility for key cleanup and invalidating the lease on authority/storage
changes, as specified in the principal-history recovery guide.

`recoverProjectionPolicyHistory` resolves compact projection sources into verified
historical authorization selections. Standalone hosts provide private local
protection, the projection's manifest references, trusted identity resolution,
and a lifetime predicate. Attach it through the policy warmer's
`resolveProjectionHistory` capability and return the same lifetime predicate
with the selections. Projection verification rechecks that lifetime and the
latest local pins at final admission. Historical selections never advance
current-policy checkpoints or become current key material. Attachment detach,
hydration, retained-wrap checks and relinking accept the same private policy
warmer and operation-lifetime guard; the document store supplies both.

`retainAcknowledgedPrincipalCurrents` atomically retains exact policy receipts,
authenticated resumable progress, checkpoints and signed-grant retirements.
It requires the previously recovered prefix and durable predecessor pin. An
`initialGroup: true` entry instead verifies a genuine group genesis with version
one and no predecessor, paired with its exact signed directory successor. Both
publish atomically, and existing checkpoint or prefix conflicts still fail; see
[current mutation primitives](../../../../docs/developer/principal-current-mutations.md).

The public `AcknowledgedPrincipalCurrentInput` and
`AcknowledgedPrincipalCurrentRetirement` types describe batch inputs and
signed-grant retirements.
