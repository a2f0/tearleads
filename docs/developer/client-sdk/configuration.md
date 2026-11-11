# Client SDK: Configuration

Part of the [client SDK guide](../client-sdk.md).

## Advanced Configuration

The [SQLite setup guide](../sqlite-setup.md) shows explicit durable storage,
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
| `tearleads.subscribeApiNetworkFailures` | every API request that got no response (plain cancellations excluded), with its secret-free `ApiNetworkFailureDetails`, for diagnostics (see [API network failures](../api-network-failures.md#reporting-to-sentry)) |
| `tearleads.apiRequests` | per-identity HTTP attempt counts and timings (see [API Request Counts](./runtime-behavior.md#api-request-counts)) |
| `tearleads.events` | remote event list passed into sync workflows |
| `tearleads.runtime` | workflow runtime input snapshots for host stores and providers |
| `tearleads.syncBillingGate` | organizations whose sync writes the API refused with HTTP 402, for billing prompts |
| `tearleads.documents` | document editing, lists, deletion, subscriptions, and runtime composition |
| `tearleads.containerContents` | container tree, document queries/links, discovery, diagnostics, and runtime composition |
| `tearleads.deviceFirst` | shared locally durable container mutation store, instant container/document projection, and background reconciler |
| `tearleads.organizations` | strict local-first organization and durable data-usage projections, exact-head history from verified policy storage, server-authoritative billing eligibility, and the user's own memberships with per-organization sync pauses (`memberships`; see [organization memberships](../../organization-memberships.md)) |
| `tearleads.root` | platform-operator identity and organization lookups (paged directories and rosters, sessions, billing with the latest 50 billing events, data usage), the ops-health report, RevenueCat webhook deliveries, the root audit trail, and identity suspension, offered only when the session is root |
| `tearleads.userIdentities` | identity-link `createLink` / `verifyLink`; `resolveVerified` and `createLinkFor` (link- or self-established pins only); independent anchors for direct or Members-chain admission |
| `tearleads.securityIncidents` | durable local records of terminal trust-boundary verification failures |

Prefer instance services so document and container stores share the active
database, identity, sync, and subscription scope. Product code should use the
namespaces above; import internals only for
[SDK development](../client-sdk-seams.md) or
[custom persistence](../custom-document-persistence.md).

`tearleads.network` defaults to automatic mode: browser events and API request
results set `online`. Hosts can force diagnostics with `setMode("offline")` or
`setMode("online")`, then resume detection with `setMode("automatic")`.

### Organizations and groups

[Organization](../../glossary/principals.md#organization) and custom group names
are encrypted. Every organization requires an independent metadata root with
[Admins](../../glossary/principals.md#organization-admins-group)/admin and
[Members](../../glossary/principals.md#organization-members-group)/read
[grants](../../glossary/access.md#grant), isolated from personal-root shares and
rotations. The SDK verifies signed directories and decrypts group names for all
members. Built-in labels follow signed roles; operator organization listings
expose IDs, never names. Organization profile documents are optional.

Group membership add/remove inputs require `expectedGroupName`, captured from
the label the user selected. The SDK verifies the signed policy name before
recipient resolution or key use. A mismatch raises
`GroupMembershipNameMismatchError` and is reported as a
[security incident](../../security-guarantees/properties.md#local-security-incident-detection).

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

[Document](../../glossary/content.md#document) stores initialize automatically before
mutating operations such as `setText(...)`, `setStructuredFields(...)`,
`attachFiles(...)`, `replaceAttachment(...)`, and `relink(...)`. Use
`ensureInitialized()` only for an explicit readiness probe before reading a
ready snapshot. Use `tearleads.runtime.input(containerId)` for host runtime
input; SDK facades retain API access and incident reporting. Orphan-recovery
queries accept a null container plus the active organization; use the indexed
`hasOrphanedDocuments(...)` probe.

Attachment methods persist required `contentSha256` digests in encrypted
document content and pending-upload rows. Recovery restores
[slots](../../glossary/content.md#attachment-slot) without reading bytes. Hydration
replaces a held copy only with bytes matching the document intent; a valid
served [binding](../../glossary/content.md#attachment-binding) the document has
not recorded fills only an empty slot. Removal queues local bytes for
reference-aware reclamation, including copies shared by pending uploads after
reset. Custom `DocumentsPersistence` adapters provide the required `orphanBlobs`
queue and reference methods described in
[custom persistence](../custom-document-persistence.md).

A host that attaches a file right after creating its document can open it with
`documentLinks().openDocument({ ..., deferInitialUpdate: true })`. The birth
commits without its own pending update and scheduled sync waits, so the first
`attachFiles` delta carries it and the import costs one
[Loro update](../../glossary/content.md#loro-update); if that attach does not
land, the store enqueues the birth on its own. A caller that gives up before attaching
must call `attachFiles([])` to release the wait. The `createDocumentStore`,
`getOrCreateDocumentStore`, and `openDocumentStore` factories take the option,
with `remoteSyncMode`, in a trailing `DocumentStoreOpenOptions` object.

`initialStructuredFields` and `initialRows`, on the same options and on the
`tearleads.documents.open(...)` and `documentLinks().openDocument(...)` inputs,
put content known at creation into the birth update beside the kind and text,
so the first sync can send it inside the create. An existing record ignores
them; fields need a non-note kind.

The `.env` file kind is SDK-owned so every host writes the same shape:
`ENV_FILE_DOCUMENT_KIND`, the `ENV_FILE_NAME_FIELD` structured field, one row
per variable keyed by `ENV_FILE_VARIABLE_KEY_FIELD` and
`ENV_FILE_VARIABLE_VALUE_FIELD`, and `parseEnvFileText` with
`isValidEnvFileVariableName` for importing `.env` text.

For bounded UI hydration, resolve `localId` with
`tearleads.documents.findLocalIdByDocumentId(documentId)`, open with
`remoteSyncMode: "on-demand"`, and await `requestRemoteSyncAndWait(signal)`.
It returns `false` unless a pass completes. Abort on unmount; cancellation
releases only waiter-owned work. See the
[on-demand lifecycle](../custom-document-persistence.md#on-demand-document-lifecycle).

### Sync and container recitation

Loop `syncRemoteDocument(...)`; resume with `readPullContinuation(...)` and
validate via `validateDocumentSyncUpdateImports(...)`. Inline callbacks pass
`verification` to `buildMaterializedContainerRekeyPlan(...)`, including
chains; sync derives successor targets and coded retries. Preserve
`KeyingVerificationError`; missing [raw-history](../../raw-document-history-recovery.md)
epochs throw `DocumentRawHistoryUnavailableError`.

Custom [sync lanes](../../glossary/sync.md#sync-lane) may provide
`SyncLaneConfig.priority()`: lower finite numbers start first within a
[phase](../../client-sync-ordering.md), with fair rotation among ties. Missing,
throwing, or nonfinite priority values use zero. Structural work remains a phase
barrier; priority never interrupts a running callback.

Custom container mutation APIs must implement `ContainerReciteApi` (including
`reciteContainer`); the built-in API client supplies it. Container mutations
and atomic group-policy rematerializations schedule non-blocking
[re-cites](../../security-guarantees/properties.md#held-descendant-re-citation)
for already-held verified descendants, retaining up to 256
[heads](../../glossary/sync.md#head) and sending at most eight re-cites per
pass, spaced 250 ms apart. No subtree fetch or retry occurs, and keys and grants
stay unchanged. It is not a descendant-rekey or freshness guarantee. These mutation
facades require `reportSecurityIncident`; the built-in runtime wires its durable
incident service. Re-citation stops at
[container epoch 512](../../limits.md#container-keying) to reserve the remaining
verifier history budget for ordinary mutations. Organization grant revocation
requires a live `stillCurrent` guard. The client facade binds it, and group
rematerialization cascades, to the captured session, organization, signing
identity, and database lifetime.

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
original `Error` for the host's [private diagnostics](../sentry.md), and never
change an outcome. Hosts filter their own catches with the exported
`isDatabaseUnavailableError` and `isProjectionVerificationCancelledError`.

`auth.defaultOrganizationId` moves after local reset and finalization in
[billing-purge recovery](../billing-purge-recovery.md).
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
purge requires one link and verifies its
[signed proof](../../document-purge-verification.md). A container store's
`purgeContainer` and `emptyTrash` first wait for moves queued inside their
scope, reporting the wait through `PurgeOptions.onMoveSettlement`
(`PurgeMoveSettlement`). See [device-first.md](../device-first.md).

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

All options are optional: defaults are same-origin API paths, anonymous memory
blob storage (OPFS after identity setup), manual identity provisioning, ignored
`log` messages, `console.error` errors, and an idle database.

`documentProjectors` takes a prebuilt `DocumentProjectorRegistry` or a readonly
array of `DocumentProjectorDefinition` values; prefer definitions for an
app-owned document type list, and the SDK normalizes and caches the registry.
`peerScope` gives each pane distinct Loro peer ids; omit it for a single pane.
`provisionedSystemContainers` names app-owned system containers, such as a
trash bin, that every new organization is created with.
`principalHistoryKeyProvider` is covered in
[history recovery](../principal-history-recovery.md), and
`principalMutationTimeoutMs` (default 60 seconds) in
[policy outcomes](../principal-policy-outcomes.md).

HTTP uses `apiBaseUrl`; see [SDK hosting](../sdk-hosting.md).
`identityTrustDomain` overrides the canonical API base URL for identity pins,
links, and signed member bundle commitments. It must match the API's configured
domain, including base paths; see
[identity trust configuration](../trusted-user-identity.md#trust-domain-configuration).
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
[trust domain](../../glossary/principals.md#identity-trust-domain) when known; equivalent
repeats coalesce, the newest 1,000 rows per trust domain are kept, and no error
text or content is stored. `list()` is `null` while the database is unavailable;
startup detections wait in a bounded, redacted buffer. Transport errors add
none.

For SQLite initialization, runtime lifecycle methods, identity generation, and
blob storage selection, see [SDK initialization](../sdk-initialization.md).
