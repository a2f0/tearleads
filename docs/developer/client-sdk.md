# Client SDK

`@tearleads/client-sdk` owns SQLite, keys, blobs, and React-free workflows.
Hosts adapt platform behavior into the SDK rather than duplicate its setup.

## Quick Start

Create one SDK instance for the active client environment:

```ts
import { Tearleads } from "@tearleads/client-sdk";

const tearleads = new Tearleads();
```

Initialize a SQLite runtime as shown in [SQLite setup](sqlite-setup.md),
then configure the SDK before using persistence, sync, or identity generation:

```ts
tearleads.database.configure({
  client: sqliteRuntime.client,
  id: sqliteRuntime.id,
});

const { rootContainerId } = await tearleads.identity.generate();
```

Single-identity clients can pass `identityProvisioning: "auto"` instead of
calling `generate()`; see [Constructor Options](#constructor-options).
For local editing versus custom remote creation workflows, see
[Choosing a document creation API](document-creation.md).

## Host Contract

`deviceFirst.open()` returns one shared handle. Reconciliation takes scoped
hints, and `enqueueIdleBackfill()` performs catch-up. Container creation
commits the container and its metadata document in one compound API request.
Create, link/unlink, projection, and sync adapters provide structured `Result`
methods that report complete transport failures. Container persistence saves
pending mutations atomically: an accepted create or move saves its state and
settles its exact intent revision in one transaction, and an acknowledgment
without that settlement is refused. Error recording also checks the intent
revision; settlement is never unconditional.

Startup creates missing tables and indexes but never alters existing ones, so a
local database whose tables do not match the current schema must be reset.

Verified writer projections leave their access-manifest bundles in the local
`verified_access_manifest_bundles` table (at most 1,024 rows, oldest evicted
first, cleared with an organization's remote reset). Later reads cite up to 48
from the read object's organization so the API omits those bytes; the SDK
refills and re-verifies them. The table is a byte cache, not a checkpoint:
losing it only makes reads larger. See
[incremental evidence](../projection-policy-evidence.md#cost-and-retained-history-tradeoff).

Principal-policy warming verifies and persists its cache. Group policy writes
pin an organization owner atomically with current, history, and checkpoint
rows, and the public policy-cache and bundle-save types require that owner.
Persisted group evidence without an owner refuses scoped purge and requires a
full local reset. The wire contract requires explicit commit-LSN mode,
inline-rekey commit markers for nonempty batches, and the original
document/blob write-authorization evidence. See the
[workflow contract](../../packages/client-sdk/src/workflows/README.md) for
custom adapter details.

## Advanced Configuration

The [SQLite setup guide](sqlite-setup.md) shows explicit durable storage,
keyring-derived keys, custom API routing, and encrypted blob adapters.
Initialize the worker before passing its runtime to the SDK.

Client capabilities:

| Namespace | Owns |
| --- | --- |
| `tearleads.database` | SQLite client and `ExecSql` executor |
| `tearleads.identity` | signing and encapsulation key pairs, seed phrase state |
| `tearleads.blobs` | local blob byte storage |
| `tearleads.session` | registration, auth token, personal-org identity, and active context |
| `tearleads.network` | online/offline state passed into sync workflows |
| `tearleads.apiVersion` | latest `X-Tearleads-Api-Version` response header, for diagnostics |
| `tearleads.apiRequests` | per-identity HTTP attempt counts and timings (see [API Request Counts](#api-request-counts)) |
| `tearleads.events` | remote event list passed into sync workflows |
| `tearleads.runtime` | workflow runtime input snapshots for host stores and providers |
| `tearleads.syncBillingGate` | organizations whose sync writes the API refused with HTTP 402, for billing prompts |
| `tearleads.documents` | document editing, lists, deletion, subscriptions, and runtime composition |
| `tearleads.containerContents` | container tree, document queries/links, discovery, diagnostics, and runtime composition |
| `tearleads.deviceFirst` | shared locally durable container mutation store, instant container/document projection, and background reconciler |
| `tearleads.organizations` | strict local-first organization and durable data-usage projections, exact-head history from verified policy storage, server-authoritative billing eligibility, and the user's own memberships with per-organization sync pauses (`memberships`; see [organization memberships](../organization-memberships.md)) |
| `tearleads.root` | platform-operator identity and organization lookups (paged directories and rosters, sessions, billing with the latest 50 billing events, data usage), the ops-health report, RevenueCat webhook deliveries, the root audit trail, and identity suspension, offered only when the session is root |
| `tearleads.userIdentities` | TOFU `resolve`; `resolvePinned`; identity-link `createLink` / `verifyLink` |
| `tearleads.securityIncidents` | durable local records of terminal trust-boundary verification failures |

Prefer instance services so document and container stores share the active
database, identity, sync, and subscription scope. Product code should use the
namespaces above; import internals only for SDK development or
[custom persistence](./custom-document-persistence.md).

`tearleads.network` defaults to automatic mode: browser events and API request
results set `online`. Hosts can force diagnostics with `setMode("offline")` or
`setMode("online")`, then resume detection with `setMode("automatic")`.

### Organizations and groups

Organization and custom group names are encrypted. Every organization requires
an independent metadata root with Admins/admin and Members/read grants, isolated
from personal-root shares and rotations. The SDK verifies signed directories and
decrypts group names for all members. Built-in labels follow signed roles;
operator organization listings expose IDs, never names. Organization profile
documents are optional.

Group membership add/remove inputs require `expectedGroupName`, captured from
the label the user selected. The SDK verifies the signed policy name before
recipient resolution or key use. A mismatch raises
`GroupMembershipNameMismatchError` and is reported as a security incident.

Low-level group creation requires `metadataAccess`. The initial policy builder
requires `metadataKey` for a custom group or `builtinRole` for a reserved group.
Membership and share helpers use `readEncryptedName` to bind the selected label
to verified metadata. The normal client facade supplies these dependencies.

### Root operator lookups

Root exposes `loadOrganizationDataUsage(organizationId)` for the synced document
and blob breakdown, and `listDataUsageReport({ search, cursor, limit })` for
paginated usage by organization. Both enforce the same session lifecycle gate
as other Root lookups. Report rows include zero-usage organizations; each page
is read on demand and does not represent a frozen platform-wide snapshot.

Root also exposes `listAuditEvents({ subjectId, cursor, limit })`: every
recorded root lookup and root access change, newest first, optionally only
those an identity or organization acted in or was the target of. The server
records each Root request, including this listing, before answering it; an
event with a null actor came from the API CLI.

### Documents and attachments

Document stores initialize automatically before mutating operations such as
`setText(...)`, `setStructuredFields(...)`, `attachFiles(...)`,
`replaceAttachment(...)`, and `relink(...)`. Use `ensureInitialized()` only for
an explicit readiness probe before reading a ready snapshot. Use
`tearleads.runtime.input(containerId)` for host runtime input; SDK facades retain
API access and incident reporting. Orphan-recovery queries accept a null
container plus the active organization; use the indexed
`hasOrphanedDocuments(...)` probe.

Attachment methods persist required `contentSha256` digests in encrypted
document content and pending-upload rows. Recovery restores slots without
reading bytes. Hydration replaces a held copy only with bytes matching the
document intent; a valid served binding the document has not recorded fills
only an empty slot. Removal queues local bytes for reference-aware reclamation,
including copies shared by pending uploads after reset. Custom
`DocumentsPersistence` adapters provide the required `orphanBlobs` queue and
reference methods described in
[custom persistence](./custom-document-persistence.md).

A host that attaches a file right after creating its document can open it with
`documentLinks().openDocument({ ..., deferInitialUpdate: true })`. The birth
commits without its own pending update and scheduled sync waits, so the first
`attachFiles` delta carries it and the import costs one Loro update; if that
attach does not land, the store enqueues the birth on its own. A caller that
gives up before attaching must call `attachFiles([])` to release the wait. The
`createDocumentStore`, `getOrCreateDocumentStore`, and `openDocumentStore`
factories take the option, with `remoteSyncMode`, in a trailing
`DocumentStoreOpenOptions` object.

`initialStructuredFields` and `initialRows`, on the same options and on the
`tearleads.documents.open(...)` and `documentLinks().openDocument(...)` inputs,
put content known at creation into the birth update beside the kind and text,
so the first sync can send it inside the create. An existing record ignores
them; fields need a non-note kind.

For bounded UI hydration, resolve `localId` with
`tearleads.documents.findLocalIdByDocumentId(documentId)`, open with
`remoteSyncMode: "on-demand"`, and await `requestRemoteSyncAndWait(signal)`.
It returns `false` unless a pass completes. Abort on unmount; cancellation
releases only waiter-owned work. See the
[on-demand lifecycle](./custom-document-persistence.md#on-demand-document-lifecycle).

### Sync and container recitation

Loop `syncRemoteDocument(...)`; resume with `readPullContinuation(...)` and
validate via `validateDocumentSyncUpdateImports(...)`. Inline callbacks pass
`verification` to `buildMaterializedContainerRekeyPlan(...)`, including
chains; sync derives successor targets and coded retries. Preserve
`KeyingVerificationError`; missing [raw-history](../raw-document-history-recovery.md)
epochs throw `DocumentRawHistoryUnavailableError`.

Custom sync lanes may provide `SyncLaneConfig.priority()`: lower finite numbers
start first within a phase, with fair rotation among ties. Missing, throwing,
or nonfinite priority values use zero. Structural work remains a phase barrier;
priority never interrupts a running callback.

Custom container mutation APIs must implement `ContainerReciteApi` (including
`reciteContainer`); the built-in API client supplies it. Container mutations
and atomic group-policy rematerializations schedule non-blocking re-cites for
already-held verified descendants, retaining up to 256 heads and sending at
most eight re-cites per pass, spaced 250 ms apart. No subtree fetch or retry
occurs, and keys and grants stay unchanged. It is not a descendant-rekey or
freshness guarantee. These mutation facades require `reportSecurityIncident`;
the built-in runtime wires its durable incident service. Re-citation stops at
container epoch 512 to reserve the remaining verifier history budget for
ordinary mutations. Organization grant revocation requires a live
`stillCurrent` guard. The client facade binds it, and group rematerialization
cascades, to the captured session, organization, signing identity, and database
lifetime.

Container listing cursors mirror the API's feeds: one `root` cursor lists all
accessible organizations; `parent:<containerId>` and document lanes use the
globally unique container ID, never the viewer's selected organization. Purging
an organization clears that global root cursor and only its own child/document
lanes.

### Runtime input

Runtime input snapshots expose only these capability groups:

| Group | Fields |
| --- | --- |
| `auth` | `userId`, `defaultOrganizationId`, `organizationId`, `rootContainerId`, `isAuthenticated`, `isRoot` |
| `crypto` | `signingKeyPair`, `signingFingerprint`, `encapsulationKeyPair` |
| `infra` | `dbStatus`, `execSql`, `blobStore`, `documentProjectors` |
| `state` | `containerId`, `domainScope`, `events`, `online`, `serverEventsConnectionGeneration`, `peerScope` |
| `util` | `log`, `logError`, `isRemoteSyncBlocked` |

`util.logError` is optional for document/container runtimes. Quarantines,
failed local writes, failed lane runs, and thrown container shares retain the
original `Error` for the host's [private diagnostics](./sentry.md), and never
change an outcome. Hosts filter their own catches with the exported
`isDatabaseUnavailableError` and `isProjectionVerificationCancelledError`.

`auth.defaultOrganizationId` moves after local reset and finalization in
[billing-purge recovery](./billing-purge-recovery.md).
Hosts catch `PurgedOrganizationRecoveryBillingRequiredError` to activate it
without early local rebind.

`tearleads.containerContents.workflowRuntime()` gives advanced host stores a
runtime that includes root adoption. Custom hosts assembling a store directly
must use `createContainerContentsStoreWorkflowRuntime(input, adopter)`; the
adopter atomically validates and updates the session root. The general workflow
factory has no root-adoption capability. Product code should use the
higher-level helpers.

### Pending writes and diagnostics

`tearleads.containerContents.documentQueries().listPendingWrites()` returns an
identity-wide, locally derived view of durable writes that have not converged.
Rows are grouped by logical container, document, or unknown document namespace
and include safe navigation metadata plus aggregate operation counts, attachment
bytes, move targets, status, and persisted intent errors. A document whose
read-only revalidation was refused surfaces as a diagnostic `revalidation`
item even with zero queued writes, so a document that can never refresh is
visible; such items carry no local data and never offer the destructive
discard. Serialized Loro updates, local blob storage keys, and upload
cryptographic material stay private. This view answers what remains pending;
sync snapshots show scheduler work and `blobStorageKey` navigation into Blob
Browser.

Two per-row recovery actions pair with that view.
`documentQueries().retryPendingWriteItem(...)` resets the item's parked retry
state (for documents, the durable re-key budget; the recorded terminal failure
clears only alongside queued work — a failure-only revalidation row survives as
the priming ticket and clears on the next clean pass) before the caller re-arms
the sync lanes and, for documents, requests a priming pass.
`discardRegisteredDocumentLocalState(domainScope, localId, documentId)` is the
give-up path for a remote-backed document whose queue can never converge: one
transaction converts the local record to the freshly-discovered-share shell
(queued updates, staged uploads, durable history, kind projections, and the
failure row dropped; identity, title, placement, and links kept) and the store
re-pulls the server copy. Local-only, unlinked, and move-pending documents are
refused. `requestContainerContentsDocumentPriming(domainScope)` re-arms the
structural pass's document-priming scan for callers outside a registered store.

Document diagnostics keep the default read bounded: `loadDocumentInfo(...)`
uses at most 2,000 compact effective attribution intervals for contributor and
local blame derivation. An explicitly `truncated` result disables partial blame.
Per-upload provenance is lazy through `loadDocumentAttributionRanges(...)`;
follow `nextCursor` only while Edit Ranges is visible. Cursors bind the document
incarnation and attribution revision, so stale pages fail instead of mixing
histories.

### Device-first reads, writes, and background reconciliation

`tearleads.deviceFirst.open()` returns one shared scope containing the locally
durable `containerStore`, the synchronously readable `view`, and the background
`reconciler`. Ordinary tree writes persist and update subscribers locally, then
converge through durable sync lanes without blocking on the network. The view's
`ready` reflects **local** hydration only (never auth/network), while the
reconciler owns remote discovery and prioritizes the active container.
Permanently destroy with
`tearleads.containerContents.documentLinks().purgeDocument({ note })`; remote
purge requires one link and verifies its signed proof. A container store's
`purgeContainer` and `emptyTrash` first wait for moves queued inside their
scope, reporting the wait through `PurgeOptions.onMoveSettlement`
(`PurgeMoveSettlement`). See [device-first.md](./device-first.md).

## Constructor Options

`new Tearleads(options)` accepts a `TearleadsOptions` object of host adapters
and initial runtime state; its `database` field is `TearleadsDatabaseOptions`:

```ts
const tearleads = new Tearleads({
  apiBaseUrl,
  apiRequestMetrics,
  blobStore,
  blobStoreFactory,
  database,
  documentProjectors,
  events,
  identity,
  identityProvisioning,
  identityTrustDomain,
  logger,
  onSecurityIncident,
  online,
  peerScope,
  principalHistoryKeyProvider,
  principalMutationTimeoutMs,
  provisionedSystemContainers,
});
```

Every option is optional: defaults are same-origin API paths, anonymous memory
blob storage (OPFS after identity setup), manual identity provisioning, ignored
`log` messages, `console.error` errors, and an idle database.

`documentProjectors` takes a prebuilt `DocumentProjectorRegistry` or a readonly
array of `DocumentProjectorDefinition` values; prefer definitions for an
app-owned document type list, and the SDK normalizes and caches the registry.
`peerScope` gives each pane distinct Loro peer ids; omit it for a single pane.
`provisionedSystemContainers` names app-owned system containers, such as a
trash bin, that every new organization is created with.
`principalHistoryKeyProvider` is covered in
[history recovery](./principal-history-recovery.md), and
`principalMutationTimeoutMs` (default 60 seconds) in
[policy outcomes](./principal-policy-outcomes.md).

HTTP uses `apiBaseUrl`; see [SDK hosting](./sdk-hosting.md) and
[identity trust](./trusted-user-identity.md).
Use `database.client` for a SQLite worker client that implements
`ExecSqlClientLike`; the SDK creates the canonical `ExecSql` adapter from it.
Use `database.execSql` only when the host already owns executor construction.

`onSecurityIncident` is called after a typed keying-verification failure is
durably appended. Read rows with `await tearleads.securityIncidents.list()`,
watch them with `tearleads.securityIncidents.subscribe(listener)`, and append a
host-found failure (two purge proofs for one document in a local backup merge)
with `securityIncidents.record(error, context)`, given a
`KeyingVerificationError` and `SecurityIncidentContext`; it resolves
`"recorded"` once durable, else `"buffered"` (retry pending) or `"failed"`, so
claim a recording only on `"recorded"`. An incident holds the code, operation,
first/last timestamps, repeat count, protocol hashes, and object identity and
trust domain when known; equivalent repeats coalesce, the newest 1,000 rows per
trust domain are kept, and no error text or content is stored. `list()` is
`null` while the database is unavailable; startup detections wait in a bounded,
redacted buffer. Transport errors add none.

For SQLite initialization, runtime lifecycle methods, identity generation, and
blob storage selection, see [SDK initialization](sdk-initialization.md).

## Local Keyring

The SDK exports a local keyring helper for host-controlled at-rest secret
management:

```ts
import {
  createBrowserLocalKeyring,
  createLocalKeyring,
  createWebViewLocalKeyring,
} from "@tearleads/client-sdk";

const keyring = createLocalKeyring({
  keystore: platformWrappingKeyKeystore,
  manifestStore: persistedManifestStore,
});

const session = await keyring.getOrCreateSession({
  namespace: "tearleads",
  accountId: userId,
  signingFingerprint,
});
```

Browser hosts can use the built-in durable wiring:

```ts
const keyring = createBrowserLocalKeyring();
```

`createBrowserLocalKeyring()` stores both the JSON manifest and the wrapping-key
handle in IndexedDB (the manifest falls back to localStorage where IndexedDB is
unavailable); the wrapping key is a non-extractable AES-GCM `CryptoKey`.
The wrapped account-root secret and browser `CryptoKey` survive same-origin app
restarts; `keyring.deleteSession(scope)` removes both. Hosts that need custom
storage can compose `createIndexedDbWrappingKeyKeystore(...)` with an explicit
manifest store.

WKWebView-based shells that cannot structured-clone `CryptoKey` objects into
IndexedDB can use `createWebViewLocalKeyring()`. It uses the same manifest and
wrapping-key ids as `createBrowserLocalKeyring()`, but writes new wrapping keys
as raw AES-256 bytes to avoid the WebKit keychain clone path. It does not
interchange records with the browser `CryptoKey` mode, so hosts must choose the
appropriate storage mode before creating local identity data. Raw-byte storage
is weaker at rest, so browser hosts should keep the default
`createBrowserLocalKeyring()` wiring when `CryptoKey` cloning works.

`createPinCodeBrowserLocalKeyring({ pinCode })` enables opt-in PIN
locking.

`WrappingKeyKeystore` is the platform boundary. Browser, Electron, iOS, and
Android hosts should implement it with their available keychain or secure
storage primitive. The SDK stores only a manifest containing a wrapped
account-root secret; the unwrapped account root is used with HKDF to derive:

- `session.sqliteKey` for SQLCipher/SQLite initialization
- `session.blobStoreKey` for encrypted local blob storage
- `session.identityPersistenceKey` for persisted identity-key material
- additional 32-byte keys through `session.deriveKey(purpose)`

The manifest is explicit JSON with format
`tearleads.local-keyring.manifest`. Hosts persist it through
`LocalKeyringManifestStore`, and can serialize or parse it with
`serializeLocalKeyringManifest(...)` and `parseLocalKeyringManifest(...)`.
The wrapped root envelope uses format `tearleads.wrapped-local-secret` and
binds the wrapping context to the normalized scope plus key purpose.

Scopes are intentionally part of derivation and wrapping associated data:
`namespace` is required, while `accountId` and `signingFingerprint` are optional
isolation fields. `localKeyringScopeKey(scope)` provides the canonical storage
key when a manifest store needs a stable index.

`createMemoryWrappingKeyKeystore()` and
`createMemoryLocalKeyringManifestStore()` are process-local helpers for tests
and development wiring. They are not a durable or platform-secure keychain.
The browser IndexedDB helper is durable but origin-bound: same-origin code can
ask the stored `CryptoKey` to unwrap the local secret even though it cannot
export the key bytes. Hosts needing unlock can use
`createPinCodeWrappingKeyKeystore`, passphrases, OS keychains, or secure
enclaves.

Call `session.dispose()` when a host is done with a local keyring session; it
zeroes the in-memory root and derived byte keys owned by that session.
Built-in keyrings implement optional `close()` for resource release; caller-held
sessions stay valid until `session.dispose()`.

Session snapshots retain `rootAcknowledgments` separately from `containerId`,
which is the selected local view. Login, registration, and organization creation
record the server root for the signing fingerprint, user, and organization. A host
restoring an encrypted session must persist and restore these acknowledgements;
passing a view container to `setContext` never establishes root authority.

Session state is explicit. `session.registerIdentity()` persists the current
identity and canonical IDs. With keys, a container, and the database ready,
registration can recover an unconfirmed response through login:

```ts
const registration = await tearleads.session.registerIdentity();
if (registration && !("status" in registration)) {
  await tearleads.session.login(registration.challenge);
} else {
  await tearleads.session.login();
}
```

Registration validates local public keys before contacting the API, then pins
only the confirmed user. `SessionRegistrationRefusal` identifies an
`identity-already-bound` result with the previously bound `userId`; no registration
request is sent. Try login first. If the environment was intentionally reset,
clear local app data before registering again. A `null` result still covers an
unavailable prerequisite or unconfirmed response. Restore missing prerequisites
before retrying; login requires the signing key.

A platform operator can suspend an account. Its login, including the automatic
renewal of an expired session, then rejects with an error named
`AccountSuspendedError` and clears the session, so the expired session's
requests stop renewing. Retrying cannot succeed until the suspension is lifted;
name the reason instead of reporting a generic failure.

`prepareNativeSubscriptionRestoreOrganization()` durably replays one fresh
restore org. Activate it, then call
`completeNativeSubscriptionRestoreOrganization(organizationId)`.

## Public API Entry Points

Supported package entry points are:

| Entry point | Use for |
| --- | --- |
| `@tearleads/client-sdk` | `Tearleads`, SDK service types, local keyring helpers, document contracts, sync diagnostics, stores, purchase capabilities, and public workflow symbols |
| `@tearleads/client-sdk/sqlite` | SQLite worker runtime factory, executor contracts, and adapter helpers |
| `@tearleads/client-sdk/sqlite/worker.js` | The SQLite worker module a host serves for `createSQLiteRuntime` |
| `@tearleads/client-sdk/sqlite/sqlite3.wasm` | The SQLite WebAssembly the host serves beside `worker.js` |
| `@tearleads/client-sdk/sqlite/sqlite3-licenses.md` | The licenses that ship with the two SQLite files |
| `@tearleads/client-sdk/testing` | Nominal trusted-identity fixtures for lower-level repository integration tests; never production code |

Each module export maps `types` to an emitted `.d.ts` file and `default` to an
emitted ESM JavaScript file under `dist`; each `sqlite/` file export names the
built file itself. Host code reaches document contracts, store facades, and
public workflow symbols through the root entry point; the SQLite entry point
owns its runtime adapter boundary, and production source never imports the
testing entry point.

Do not import `@tearleads/client-sdk/data/*` from host code. The root entry
point aggregates documented public facades and does not make `data/*` internals,
deep workflow files, or store implementation files public. Promote a contract
through the root entry point when it is meant to become public.

When a lower-level workflow facade name conflicts with a root service type, the
root meaning stays stable and the lower-level name is exposed under a distinct
alias. For example, root `ContainerDocumentLinkInput` is the high-level client
document-link input, while the lower-level container query link input is
`ContainerDocumentQueriesLinkInput`.

Container KEK-history recovery is public workflow surface: `rekeyRemoteContainer`
performs an explicit rotation (and, with `keyringEntriesOverride`, the repair
that replaces a poisoned keyring snapshot), `rebuildKeyringEntriesFromLog`
reconstructs history from the `GET /containers/:id/kek-log` bridge log, and
`recoverKeyringEntryFromWraps` recovers a bridge-severed epoch from the caller's
retained recipient envelope. An override must name exactly the epoch ids of the
container's verified signed lineage: a foreign id is refused as
`object_mismatch`. An omitted one throws `ContainerKeyringOverrideStaleError`,
not a verification error, since that is how a rebuild that predates a
concurrent rotation fails: rebuild and retry.

Document sync automatically plans ancestor KEK repairs before a queued write.
It repairs parent-first, shares repaired ancestors across linked paths, and
commits the signed rekeys with the content update. Planning does not advance
checkpoints before acknowledgement; read-only sync does not rotate keys.
Child-only writers use authenticated parent public keys. Up to 16 repairs fit
inline; larger sets first commit bounded prefixes through `rekeyContainer`,
validate each acknowledgement, and refetch before planning the next batch.
Interrupted prefixes remain recoverable from the server's retained keys.
Custom sync adapters must supply `rekeyContainer` as well as document methods.
Stale ancestors remain forbidden for new ciphertext, including when a valid
recovery projection is available.

A writer whose only grant sits below a stale intermediate cannot re-key it, and
is never given its key: a stale container's KEK may be held by a revoked
ancestor member. Such a writer must never wait on another device, so a rotation
may not leave those levels stale. The API refuses a rekey, revoke, or move that
would leave a descendant above a directly granted container pinned to a retired
epoch, with `container_descendant_rekeys_required` and the `requiredContainerIds`
it must carry, parent-first. `rekeyRemoteContainer`, `revokeRemoteContainer`,
`moveRemoteContainer`, and document sync's standalone repairs answer it
themselves: they sign those rekeys against the path the batch leaves behind,
resubmit once with `containerRekeys` carried, and pin the whole batch together.
Access and keys inherit downward only while the rotator retains authority.
A self-revoke that removes write access on an owed level is refused atomically
with `container_descendant_rekeys_inaccessible`; another authorized member must
complete it. The SDK reports the refusal and returns null. Proactively carried
rekeys are also refused by the batch's signature/authorization verification.
The set is empty for almost every rotation,
since a child container carries no direct
grant unless shared. At most 64 rekeys ride one rotation; beyond that the
remainder repairs lazily rather than refuse a revocation. Custom adapters opt in
by supplying the status-bearing `rekeyContainerResult`, `revokeContainerResult`,
or `moveContainerResult`, and `getContainerWriterProjection`.

A user share whose path advanced in flight, most often under this device's own
held-descendant re-citation, is planned once more from a fresh projection that
is held to the same pins. Adapters opt in with `shareContainerResult`; without
it a stale share fails as any other refusal does. A group policy batch whose
served heads the re-citation pins past is likewise planned once more.

Principal-policy writes acknowledge the exact submitted state and current
artifacts without retransmitting `previousStates`. The SDK verifies that receipt
against its authored request. Built-in membership changes and group revocation
return `OrganizationGroupMutationReceipt` and atomically retain current artifacts
and authenticated progress. Built-in workflows require private paged recovery;
standalone full-bundle utilities keep their explicit complete-history contracts.
See [current mutations](principal-current-mutations.md). Missing or
substituted receipts cannot advance the local checkpoint.
The runtime journals compound policies, standalone organization policies, group
creation and group deletion before HTTP. Pending work shares one organization
lane and blocks another mutation. `AuthoredPrincipalMutation` records the kind
and route; `PrincipalMutationResponse` covers the exact receipt variants.
Advanced hosts use
`submitJournaledPrincipalMutation` and `recoverJournaledPrincipalMutation`
with durable SQLite, the actor's signing key and a current-lifetime guard.
Their `PrincipalMutationJournalContext.submit` callback must dispatch every
`kind` to its matching API route: `compound`, `group-create`, `group-delete`, or
`organization`. Missing or unsupported kinds are rejected. A compound-only
adapter cannot recover the other kinds. Keep unreadable pending bytes until the
host explicitly acknowledges the unknown outcome and discards that exact row.
An unknown result remains pending even if a later retry receives 403 or 409.
A recovered receipt acknowledges a past request without advancing current pins.
`Organizations.loadPolicyHistory(beforeVersion?)` displays verified organization
history in pages of 32 entries. The API supplies only their directory payloads,
one boundary predecessor and compact public group sources. Historical group
proofs do not admit current checkpoints. Custom hosts need private paged recovery;
older-page errors remain retryable without clearing visible entries.
Both runtime policy API variants may throw `PendingPrincipalMutationError` or
`PrincipalMutationOutcomeUnknownError`. `readJournaledPrincipalMutation` inspects
saved work. `abandonJournaledPrincipalMutation` stops retries only after an explicit
choice accepting its unknown outcome and matching that exact inspected request;
it does not undo a remote commit. Later mutations still verify current policy.
The organization facade exposes `readPendingPolicyMutation(organizationId)`,
`retryPendingPolicyMutation(organizationId)` and `abandonPendingPolicyMutation`,
whose `AbandonOrganizationPolicyMutationInput` includes the inspected request.
Org Manager shows saved work and requires confirmation before stopping retries.
Unreadable inspection throws `UnreadablePrincipalMutationError`, distinguishing
authentication and format failures. Advanced hosts can use
`discardUnreadableJournaledPrincipalMutation`; the facade exposes
`discardUnreadablePolicyMutation` with `DiscardUnreadableOrganizationPolicyMutationInput`.
Both require the inspected opaque record identifier and explicit unknown-outcome
acknowledgement. They clear only unchanged unreadable bytes, without HTTP or pin
changes. Org Manager offers the same confirmed discard action.
See [principal policy outcomes](principal-policy-outcomes.md) for scope and limits.

A container's first direct grant has the matching precondition: the chain above
it must be current, since its new grantee could not repair it; the API refuses
one below a stale chain with `container_ancestor_rekeys_required`.
A group policy change rematerializes the group's granted containers, and a
rekey or revoke among them is a rotation like any other: `addOrganizationGroupUser`,
`removeOrganizationGroupUser`, and the other group mutations answer the same
refusal through the prepared batch's `carry` step, which re-signs the whole
batch parent-first with the named rekeys woven in (a named container the batch
already rotates is re-planned beneath them, never rotated twice), and retry
once, acknowledging every response with the batch. The batch also carries, on
its own, any level its rotations strand between two of its own containers.
Custom adapters opt in with `commitOrganizationGroupPolicyResult`; a group share
commits only grants, which rotate nothing, so it has nothing to carry. A
container that already carries a grant has had its chain kept current by every
rotation above it, so further grants and group rematerialization refreshes owe
nothing more.
`shareRemoteContainer` and `shareRemoteContainerWithGroup` re-key a lazily stale
path first, the container included, because a grant cites the parent's current
epoch and the container's key epoch must pin it. An adapter without
`rekeyContainer` cannot make that repair and gets a plain error, not one that
names another member; a sharer who cannot reach a stale level gets
`ContainerKekRepairInaccessibleError`. Under this
rule a stale container is never above a granted one, so an honest inline repair
never strands anything. The API still checks: a document write refused that way
fails with `document_sync_descendant_rekeys_required`, and the sync pass retries
with its repairs committed standalone, where each carries its own descendants.
A blob bind or detach refused that way is an uncoded 409; the document's next
sync pass makes the path current.

If a writer still meets a stale ancestor it cannot re-key (a dishonest server, a
tree past the cap in [limits.md](../limits.md#limits-that-trade-write-liveness),
or a race), its pass refetches once, then abandons with the
`inaccessible` trace reason and reports `document_ancestor_repair_inaccessible`
to `onTerminalSubmitFailure` instead of failing the sync lane; built-in stores
keep its message, not the code, on the write-queue row. Its writes stay
queued, and built-in stores re-run the pass on the next
`container_path_changed` hint. Hosts
that author container-scoped writes directly can call
`classifyContainerWriteRefusal` on a thrown error: `repair-required` is
retryable, `repair-inaccessible` waits on another member and names the
container, and `unauthorized` is a `ContainerAuthorAccessError`.
`ContainerKekRepairRequiredError` and its subclass
`ContainerKekRepairInaccessibleError` are exported for `instanceof` checks.
A local create or move whose path would exceed the readable length throws
`ContainerPathTooDeepError` (`code` `container_path_too_deep`) before anything
is queued; hosts can map that code to a specific message. A queued move the
API refuses with that code is abandoned and its previous placement restored.

Principal rotations and membership changes rematerialize every retained group
grant against the new current principal head in the same transaction, so
`recoverKeyringEntryFromWraps` resolves group-addressed anchors through current
verified principal policies. Rematerialization wraps only a container's current
epoch: an older epoch whose only anchor is a group wrap from before a principal
key rotation fails with `HistoricalWrapUnavailableError`
(`principal-key-unreachable`). See
[keying-design.md](../keying-design.md#container-key-epoch-database-row).

### Purchase capabilities

`OrganizationBillingView` carries `subscriptionSource` and `canCancelDirectly`
from the server billing snapshot. Use that snapshot to choose purchase controls
and inline Stripe cancellation; a native owner can still have a quarantined
Stripe subscription to cancel. Fetch the management URL separately for a native
store link. A URL lookup failure must not hide cancellation.

Org sync billing exposes two provider-neutral capabilities:

| Capability | Who owns the payment UI | Injected by |
| --- | --- | --- |
| `PurchasesCapability` | App Store or Play via RevenueCat; web and desktop use the stub | `AppHostConfig.createPurchases` |
| `DirectCheckoutCapability` | The app around Stripe's mounted element | `AppHostConfig.createDirectCheckout` |

Both have unavailable stubs. Web loads no RevenueCat SDK and purchases only
through direct checkout. Native purchases are personal-org only. Handle
`PurchaseAlreadyOwnedError` with `purchases.moveNativeSubscription`: verify the
receipt, prepare a fresh org outside the claim deadline, claim it, then publish
attribution. Identity pending means retry; provider stalled means restart.
Before purchase or restore, use
`checkNativePurchaseEligibility(organizationId, store)` to block a second
subscription; claims and webhooks still recheck ownership and conflicts. Native
providers must invoke the supplied `onProviderPresented` callback exactly when
their store sheet becomes uncancellable. Before that notification, cancellation
must prevent later presentation; there is no capability flag or conservative
provider-start fallback. Keep restore/claim/bind atomic.
See [revenuecat-billing.md](./revenuecat-billing.md).

## Package Contract

The package is `private: true` and consumed across the monorepo by build output.
The build emits ESM JavaScript, inline-source source maps, and declaration files
from `tsconfig.build.json`, replacing any previous `dist`:

```sh
bun run --filter='@tearleads/client-sdk' build
```

`bun run lint:architecture` enforces the package-consumption contract:

- `@tearleads/client-sdk` is private, ESM, side-effect-free, and backed by
  build-output package exports.
- Local `@tearleads/*` package dependencies use `workspace:*` ranges.
- The package export map matches the
  [entry-point table](#public-api-entry-points) exactly and points at `dist`
  JavaScript/declaration files.
- `data/*`, document, store, workflow, and deep implementation package exports
  are rejected.
- App code uses SDK root services instead of importing SDK workflow or store
  facades directly.
- Product window vocabulary such as `OrgManager` and `mini-app` stays in
  `packages/app`; SDK source uses platform workflow names.

## Document persistence notifications

`PersistedDocumentListener` supplies a summary and `placementChanged` flag.
Creates, identity changes, and structural relinks set it, including
[document links](./document-links.md) that retain the preferred container.
Placement changes invalidate in-flight device-first reads; ordinary content saves
allow an initial read before the trailing refresh.

## Organization policy history

Organization policy history details are derived in memory from the signed
records returned by `GET /organizations/:organizationId/policy-history`, bound
to the exact selected organization state hash. Historical directory payloads
are checked against their signed hashes, and group membership/grant snapshots
are verified against every referenced directory head. This read endpoint is
available to current organization members, including non-admin members.
`OrganizationPolicyHistoryEntry.groupChanges` describes group creation,
deletion, membership, grants, and key rotation; `null` means the additional
evidence is unavailable. The exported `OrganizationPolicyGroupChange` and
`OrganizationPolicyGrantChange` types describe those details. Nothing is
persisted: no database columns, decrypted name snapshots, or summaries. A memory
cache reuses verified details at the same head within the current
identity/database scope; access-generation changes invalidate cached entries.
The app resolves current group names and roster profile names through
local projections; missing or deleted names fall back to identifiers. Offline
history retains its verified policy entries and reports unavailable group
details explicitly. Authoritative access denial purges organization presentation
through the access-revocation path.

## Retained folder recovery

Container document queries expose `listRecoveryFolders` and
`discardRecoveryFolder`. The exported `RecoveryFolder` carries a revision token
covering the retained metadata and affected placement intents. Discard commits
only while the container remains absent and that revision is unchanged. Explorer
shows these copies alongside local folders whose parents disappeared; local
folder actions can move them to a surviving parent. Explicit container refresh
resets all discovery lanes, allowing fresh verified state to restore a folder
without waiting for a timestamp change or an access-restoration event.

`ContainerDocumentQueries.listRecoveryFolderMoveIds` lists queued folder moves
whose local destination parent is unavailable. Recovery uses it to distinguish
local work from shared folders with inaccessible parents.

## Durable principal-history recovery

Standalone document and container workflow constructors accept
`withPrincipalHistoryProtection: PrincipalHistoryProtectionLease`. This private
input supplies the built-in bounded recovery resolvers and survives derived
document/store adapters without appearing on their public runtime views. The
host owns key cleanup and must invalidate the lease when its authority or local
storage changes. Authority loaders take exact heads, including cached
citations. See [recovery](principal-history-recovery.md) for offline reads and
the key-custody contract.

`recoverProjectionPolicyHistory` resolves compact projection sources into verified
historical authorization selections. Standalone hosts provide private local
protection, the projection's manifest references, trusted identity resolution,
and a lifetime predicate. Attach it through the policy warmer's
`resolveProjectionHistory` capability and return the same lifetime predicate
with the selections. Projection verification rechecks that lifetime and the
latest local pins at final admission. Recovery never advances current-policy
checkpoints or creates current key material. Terminal purge verification uses
`historicalProof: true` to defer currency enforcement until all signed artifacts
have authenticated; this option alone is not permission to admit a selection.
Only the complete purge commit admits its public observations together with
local document teardown, under the original lifetime guard. Standalone
`purgeRemoteDocument` and deletion handlers accept
`warmReferencedPrincipalPolicies` and `stillCurrent` for that purpose.
For a newer local policy pin, purge also calls `resolveReference` with
`preferLocalHistory: true`: reuse authenticated local ancestry, then recover
through ordinary authorized pages if needed. This connection never advances
the recovered newer head or extends the purge grant. Standalone hosts should
honor that preference so retained evidence works after current access is lost.
Attachment detach, hydration, retained-wrap checks and relinking accept the same
private policy warmer and operation-lifetime guard; the document store supplies
both.

`retainAcknowledgedPrincipalCurrents` retains exact acknowledged current policies
and recovery progress atomically with their checkpoints. `initialGroup: true`
permits an actual version-one group genesis with a null predecessor, only when
the same transaction includes its exactly binding directory acknowledgement.
The runtime verifies the signature, artifacts and strict Admins authority before
publishing either policy; existing pins and prefix conflicts are preserved.
Its predecessor,
custody and receipt requirements are documented in [current mutations](principal-current-mutations.md).

`captureAcknowledgedPrincipalPredecessor` captures sealed evidence before sending
the mutation. Each acknowledgement requires this `AcknowledgedPrincipalPredecessor`
in `predecessor` (null only for a newly created group). A newer authenticated
prefix must prove the exact receipt belongs to its history; its progress and
checkpoint remain monotonic. Concurrent local publication retries retention
without resubmitting the request.

The public `AcknowledgedPrincipalCurrentInput` and
`AcknowledgedPrincipalCurrentRetirement` types describe batch inputs and
signed-grant retirements.

`client.organizations.loadGroupPresentationDetails(groupId, beforeVersion?)`
returns at most 32 group-history rows when private paged recovery is available.
Pass `policyHistory.nextBeforeVersion` to load the next older page; null marks
genesis. A separately authenticated predecessor makes the oldest displayed row's
membership diff accurate. Pages check private index roots, exact projected heads,
durable pins and runtime lifetime, including offline reads. A newer verified
local prefix can answer an older selected history view without a freshness read.
Older-page calls return `members: null` and do not reload the member list. Hosts
lacking paged recovery keep complete histories for cursor-free calls and reject
explicit cursors instead of silently ignoring them.

## API Request Counts

`tearleads.apiRequests` records HTTP attempts from client creation, grouped by
operation method/path template and the signing fingerprint at dispatch. Use
`getSnapshot(fingerprint)` and `subscribe(listener)` for current counts, or
`reset(fingerprint)` to start a new measurement. A null fingerprint counts
requests made without an identity. Each retry is a separate attempt; cached
reads and WebSocket messages are excluded. Success/failure describes HTTP and
connection outcomes, not later body parsing or cryptographic verification.
Response headers end the in-flight measurement; bodies are never consumed by
instrumentation. No request URLs, queries, bodies, or tokens are retained.

Rows also time attempts until headers, failure, or cancellation: `duration` has
p50/p95 over the latest 256 plus count, total, and max since reset.
`serverDuration` and `databaseDuration` summarize the API's `Server-Timing`
`total` and `db` (I/O wait on Workers), null until a response reports them.

Hosts can pass an `ApiRequestMetrics` instance as `apiRequestMetrics` to retain
counts across SDK disposal/recreation; the app keeps one per API/identity
namespace for the page's lifetime, shown in System Monitor's **API Requests**
tab. Reset discards earlier in-flight completions without affecting the
requests themselves. This telemetry never uses durable storage or a remote
diagnostics service.

## Explorer hydration and pending downloads

Explorer queries omit remote document shells until content is present, including
paginated counts. Explorer requests direct summaries with
`loadDocumentSummary(id, { requireHydrated: true })`; ordinary identity reads still
include shells. Orphan-route identity checks use the scoped
`loadOrphanedDocumentSummary` read before requesting `requireHydrated: true`
content. `ContainerNode.metadataReady` is false
for remote folders awaiting metadata; consumers can hide these nodes without
removing their sync registrations. `containerContents.documentQueries()` exposes
`listPendingDownloads()` and `PendingDownloadQueueItem` for known document and
folder metadata pulls (initial hydration or remaining pages), including durable
errors. The queue does not estimate undiscovered objects or on-demand blob reads.
