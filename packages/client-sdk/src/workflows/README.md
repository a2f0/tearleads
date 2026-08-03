# Client SDK Workflows

Workflow facades are the SDK's public domain-operation boundary. They may
compose API calls, local persistence, key/projection verification, and sync
coordination, but they must stay React-free and product-UI-free.

## Facade Taxonomy

| Facade | Classification | Notes |
| --- | --- | --- |
| `blobs` | Platform runtime | Encrypted blob upload, hydration, decryption, and local byte-store helpers. |
| `containers` | Platform runtime | Container mutation planning, remote container operations (create/share/move/revoke/rekey), and KEK-history recovery: `rebuildKeyringEntriesFromLog` walks the kek-log bridge chain, `recoverKeyringEntryFromWraps` recovers a severed epoch from the caller's retained envelope, and `rekeyRemoteContainer` with `keyringEntriesOverride` seals the repaired keyring. A group-addressed envelope sealed to a rotated principal key epoch is opened by walking that principal's signed policy history; hosts supply the reader through the `PrincipalPolicyHistoryFetcher` contract, and omitting it leaves such envelopes unopened rather than failing the recovery. |
| `documents` | Platform runtime | Document creation, persistence, sync, projection keys, document link-set helpers, local orphan/blob maintenance, and the discard-to-shell escape hatch for documents whose queued writes can no longer sync. |
| `container-contents` | Platform query and runtime | Container tree projections, container metadata documents, document discovery, document links, identity-wide pending-write diagnostics, compact attribution diagnostics, lazy paginated attribution ranges, and sync-state helpers. Product UI routes, panels, menus, and selection state belong in `packages/app`. |
| `organizations` | Platform organization administration | Transactional local directory, group-summary, group-membership, grant, policy-head, user-detail, and separately reconciled durable data-usage projections; opaque feed cursors; exact-head history from verified principal-policy storage; ID-only user membership mutations; verified principal-policy mutation helpers; organization-scoped system-container slot helpers; sync-billing reads; direct Stripe checkout; and verified, explicitly organization-scoped native-subscription claims after an App Store or Play restore. Org Manager screens and labels belong in `packages/app`. |
| `principals` | Platform runtime | Principal-policy cache and verification support routed through the durable trusted-user-identity gateway. |
| `registration` | Platform runtime | Local registration and atomic organization bootstrap helpers, including the initial encrypted roster and organization-profile bodies. |
| `sync` | Platform runtime | Shared sync coordinator helpers. |

The `sync` facade exposes read-only coordinator snapshots through
`getDomainSyncCoordinatorSnapshot(...)` and
`subscribeToDomainSyncCoordinator(...)`. Host diagnostics and product UI may use
those snapshots to show lane status, request/run/error counts, and last action
timestamps without reaching into coordinator internals or owning sync policy.

Provider-neutral purchase errors live in `client/purchases.ts`, outside the
organization workflow facade; callers can distinguish retryable identity races
from provider stalls that require an app restart.

Workflow code consumes the resolved `runtime.state.online` value. Host-level
network detection and any manual online/offline override policy belongs to the
SDK `tearleads.network` runtime state, not individual workflow facades.

Custom hosts that construct a container-contents store directly must pair
`createContainerContentsStoreWorkflowRuntime(...)` with a
`ContainerContentsRootAdopter`. The narrower store runtime keeps stale-root
recovery capability compile-time required; general query workflows can continue
to use `createContainerContentsWorkflowRuntime(...)`.

The device-first read/reconcile seam lives outside the workflow facades, in
`src/stores/local-projection` (the synchronously-readable `LocalProjectionStore`)
and `src/sync/reconciliation` (the background `ReconciliationService` that owns
remote document discovery over the sync coordinator). Product UIs consume both
through the `tearleads.deviceFirst` SDK facade rather than these modules
directly. See `docs/developer/device-first-reconciliation.md`.

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

Organization directory, group-summary, state-hash-bound membership, grant, and
policy-head rows are presentation projections. The SDK reconciles them through
the strict version 4 organization read-model feed and keeps the opaque cursor in
the same SQLite transaction as each applied page. Local storage contains only
the current projection schema; there is no projection upgrade or alternate HTTP
path.

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
requester-scoped and UI-only; mutations derive authority from verified writer
projections and signed policies. Root and metadata key rewraps test verified
existing grants, never read-model grant IDs, group IDs, or memberships.

Name SDK facades after the platform state they expose. Product names can stay
in app providers and components that adapt those platform facades into a UI.
For example, the SDK exports `workflows/organizations`, while the app can keep
`OrgManager` provider, route, and screen names in `packages/app`.

`bun run lint:architecture` guards this taxonomy by rejecting product window
vocabulary in SDK TypeScript source and by checking that this table lists every
workflow facade aggregated by the root SDK entry point exactly once.
