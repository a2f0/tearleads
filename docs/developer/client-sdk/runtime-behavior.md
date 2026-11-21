# Client SDK: Runtime Behavior

Part of the [client SDK guide](../client-sdk.md).

## Sign-in lifetime

A successful explicit login and a host restore through
`session.setContext({ authToken, isAuthenticated: true, ... })` begin a sign-in.
Logout or removing the bearer with `session.setAuthToken(null)` retires it.
A non-null token-only update keeps the established sign-in. Verified token
renewal keeps existing work current, including pending principal write receipts.
The first sign-in adopts unclaimed device work. Later sign-ins receive fresh
workflow scopes over the identity's saved database and attachments.

A host can call `session.captureSignIn()` before asynchronous work and check
the returned predicate before applying its result. Passive restores pass
`"restore"` so an explicit login takes precedence. For confirmed logout,
`session.logoutRemote(onLocalLogout)` runs the optional callback after it clears
the session that initiated the request. The callback receives a predicate for
checking ownership again after each asynchronous cleanup step.

Host implementations of `BlobStore` check the optional `assertCurrent` callback
at the commit point for writes and deletes. Adapters pass it through to their
backing store. The SDK's OPFS store checks before closing the staged file and
aborts the write if its owning sign-in has ended.

## Request scope

A workflow can pass its `stillCurrent` predicate with a request. Once the
predicate returns false, for example after an organization switch, a new
sign-in, or a store generation change, the request is retired:

- It does not renew the session or replay.
- Its response, even a success, and its reachability diagnostics are dropped.
- A blob download stream delivers no more bytes.

These requests pass it:

- the writer-projection reads of document creates and attachment uploads
- the parent reads of container-contents folder creates
- attachment uploads and downloads
- signed container creates, recitations, moves, revokes, rekeys, and user
  shares

These do not pass it yet:

- group shares
- the projection reads before a move, revoke, rekey, or share
- the parent reads inside a container create, including its stale-path repair

Concurrent writer-projection reads still share one fetch and its cached result.
The shared fetch stays current while any of its callers is current.

An attachment upload checks its organization's sync pause before each stage or
part request. A pause stops the upload and returns `null`. A stage created
before the pause can be resumed.

## Document persistence notifications

`PersistedDocumentListener` supplies a summary and `placementChanged` flag.
Creates, identity changes, and structural relinks set it, including
[document links](../document-links.md) that retain the preferred container.
Placement changes invalidate in-flight device-first reads; ordinary content saves
allow an initial read before the trailing refresh.

## Organization policy history

Organization policy history details are derived in memory from the signed
records of `GET /organizations/:organizationId/policy-history`, bound
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
input binds the view's `principalPolicies` service, which derived document and
store adapters share; the lease never appears on runtime views. The
host owns key cleanup and must invalidate the lease when its authority or local
storage changes. Authority loaders take exact heads, including cached
citations. See [recovery](../principal-history-recovery.md) for offline reads and
the key-custody contract.

`recoverProjectionPolicyHistory` resolves compact projection sources into verified
historical authorization selections. Standalone hosts provide private local
protection, the projection's manifest references, trusted identity resolution,
and a lifetime predicate. Attach it through the policy warmer's
`resolveProjectionHistory` capability and return the same lifetime predicate
with the selections. Projection verification rechecks that lifetime and the
latest local pins at final admission. Recovery never advances current-policy
checkpoints or creates current key material. Terminal
[purge verification](../../document-purge-verification.md) uses
`historicalProof: true` to defer currency enforcement until all signed artifacts
have authenticated; this option alone is not permission to admit a selection.
Only the complete purge commit admits its public observations together with
local document teardown, under the original lifetime guard. Requests to
`RemoteDocumentService.purgeRemoteDocument` and deletion handlers accept
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
custody and receipt requirements are documented in [current mutations](../principal-current-mutations.md).

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
`serverDuration` and `databaseDuration` summarize the API's
[`Server-Timing`](../api-request-cost.md) `total` and `db` (I/O wait on Workers),
null until a response reports them.

Hosts can pass an `ApiRequestMetrics` instance as `apiRequestMetrics` to keep
counts across SDK disposal/recreation; the app keeps one per API/identity
namespace for the page's lifetime, shown in System Monitor's **API Requests**
tab, whose toolbar **Reset request counts** calls `reset`. Reset discards
earlier in-flight completions without affecting the requests themselves. This
telemetry never uses durable storage or a remote diagnostics service.

**Copy report for support** includes these counts and client/server/database
timings even when another System Monitor tab is active. Its **Environment**
section also includes every workspace package's version from the client
build; these are not live backend package versions. **API Version**
separately identifies the backend response most recently received.

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
`listCompletedDownloads(refs)` takes `DownloadQueueItemRef`s and returns, as
`CompletedDownloadItem`s, the rows whose content is now fully stored (for a
file, an attached local copy of its slot), so a host can tell a finished pull
from a row that left the queue because it was deleted, detached, or reset.
