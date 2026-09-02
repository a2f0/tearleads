# Client SDK Workflows

Workflow facades are the SDK's public domain-operation boundary. They may
compose API calls, local persistence, key/projection verification, and sync
coordination, but they must stay React-free and product-UI-free.

## Facade Taxonomy

| Facade | Classification | Notes |
| --- | --- | --- |
| `blobs` | Platform runtime | Encrypted blob upload, hydration, decryption, and local byte-store helpers. |
| `containers` | Platform runtime | Container mutation planning, remote container operations (create/share/move/revoke/rekey), and KEK-history recovery: `rebuildKeyringEntriesFromLog` walks the kek-log bridge chain, `recoverKeyringEntryFromWraps` recovers a severed epoch from the caller's retained current envelope, and `rekeyRemoteContainer` with `keyringEntriesOverride` seals the repaired keyring. Principal rotations rematerialize retained group grants against the current principal head, so recovery does not depend on historical principal keys. |
| `documents` | Platform runtime | Document creation, persistence, sync (including the headless `syncRemoteDocument` boundary: require `validateIncomingUpdates`, normally backed by `validateDocumentSyncUpdateImports`, before durably applying a page; return materialized rekey plans from `buildContainerRekeys` so each write derives successor targets and stale-policy retries rebuild signed material; schedule another bounded pass for `hasDeferredPendingUpdates` or `hasIncompletePull`; and retain `readPullContinuation(result.response)` as the next input `pullContinuation`; built-in stores persist it in local SQLite), projection keys, document link-set helpers, local orphan/blob maintenance, and the discard-to-shell escape hatch for documents whose queued writes can no longer sync. |
| `container-contents` | Platform query and runtime | Container tree projections, container metadata documents, document discovery, document links, identity-wide pending-write diagnostics, compact attribution diagnostics, lazy paginated attribution ranges, and sync-state helpers. Product UI routes, panels, menus, and selection state belong in `packages/app`. |
| `organizations` | Platform organization administration | Transactional local directory, group-summary, group-membership, grant, policy-head, user-detail, and separately reconciled durable data-usage projections; opaque feed cursors; exact-head history from verified principal-policy storage; ID-only user membership mutations; verified principal-policy mutation helpers; organization-scoped system-container slot helpers; sync-billing reads; direct Stripe checkout; server-authoritative native-purchase eligibility; and verified, explicitly organization-scoped native-subscription claims chosen after receipt verification by the atomic `PurchasesCapability.moveNativeSubscription` flow. Its destination-preparation callback runs outside the bounded server-claim deadline and durably replays one fresh restore organization across reloads until completion. Org Manager screens and labels belong in `packages/app`. |
| `principals` | Platform runtime | Principal-policy cache and verification support routed through the durable trusted-user-identity gateway. |
| `registration` | Platform runtime | Local registration and atomic organization bootstrap helpers, including the initial encrypted roster and organization-profile bodies. |
| `sync` | Platform runtime | Shared sync coordinator helpers and organization-scoped remote-state reset/recovery inputs. |

The documents facade also admits explicit `historyMode: "raw"` reads through
`syncRemoteDocument`. A raw consumer must start at a null version vector, send
no writes, validate every bounded page in scratch state, and publish only after
the complete retained frontier validates. The built-in rotation preflight is
the reference consumer; ordinary sync must omit the mode. Raw consumers can
handle `DocumentRawHistoryUnavailableError` by its stable code and numeric
content-key epoch without parsing an integrity-error message.

The `sync` facade exposes read-only coordinator snapshots through
`getDomainSyncCoordinatorSnapshot(...)` and
`subscribeToDomainSyncCoordinator(...)`. Host diagnostics and product UI may use
those snapshots to show lane status, request/run/error counts, and last action
timestamps without reaching into coordinator internals or owning sync policy.
`clearRemoteSyncState(execSql, { organizationId })` clears only one
organization's remote-derived rows and cursor lanes while retaining local Loro
history for republish. A post-purge replacement supplies a fresh organization
and root through `replacement`; normal session consumers use
`session.recoverPurgedOrganization(...)` after billing reaches `purged`. The
method exposes the replacement organization and root-container ids through
`PurgedOrganizationRecoveryBillingRequiredError` until that replacement has
sync-eligible billing; only then does it rebind retained local data and finalize
the server default-organization pointer.

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
uncommitted so the current generation can retry the retained proof.
The public entry point is
`tearleads.containerContents.documentLinks().purgeDocument({ note })`. A remote
document must have exactly one remaining container link; recursive container
purge unlinks any additional in-subtree links before calling it. `null` means
the purge was refused or could not be verified, and callers must retain the
local document.
Proof fetching reveals only purge-time heads by default. The SDK authenticates
that baseline, including its redacted signed principal-policy snapshots, before
reading local checkpoint identities. It may then supply an already-known
document hash to fetch signed predecessor history. The purge-time container
path must satisfy local container checkpoints directly; a later local head is
ambiguous and fails closed because ancestry cannot order the separate purge
signature. A coded not-found while retrying a user-initiated purge follows this
retained-proof path as well.

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
last-known-good projection; authoritative access loss purges it. No nullable
HTTP fallback or older cache format is read. If SQLite rejects the purge
transaction, the current executor still fails closed in memory; physical rows
can remain until a later successful canonical reconcile replaces or removes
them.

Grant lists, group containers, and user details are derived from this local
projection. User-detail group reachability is cycle-safe and traverses hidden
groups before filtering the displayed group catalog. Container display names are
joined from local encrypted metadata. `loadGroupPresentationDetails(...)`
combines local members with policy history only after the separately verified
policy bundle exactly matches the projected head. A missing bundle runs the
canonical fetch, signature, trusted-identity, checkpoint, and persistence path
before rereading local history; raw responses are never rendered. Group
containers repaint independently from the local grants lane. State-hash and
member-count checks prevent torn local views, but do not make presentation rows
authoritative. `isSelf` is derived from the active user, while `isOrgAdmin` is
requester-scoped and UI-only. Group mutations are authorized through the
verified reserved `Admins` policy. Before committing a principal rotation, the
client derives the complete container batch from verified writer projections;
the API atomically rejects any transition that leaves a stale principal pin.
Metadata profile upload remains a separate idempotent content sync and never
changes grants.

Name SDK facades after the platform state they expose. Product names can stay
in app providers and components that adapt those platform facades into a UI.
For example, the SDK exports `workflows/organizations`, while the app can keep
`OrgManager` provider, route, and screen names in `packages/app`.

`bun run lint:architecture` guards this taxonomy by rejecting product window
vocabulary in SDK TypeScript source and by checking that this table lists every
workflow facade aggregated by the root SDK entry point exactly once.
