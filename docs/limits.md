# Limits

Every bound the protocol enforces, what enforces it, and what happens on the
far side of it. Most limits are of three kinds:

- **Refusal.** The request is rejected and the client must change what it
  sends. These are wire-contract bounds against hostile or runaway input.
- **Pagination.** The work continues on the next request or the next sync
  pass; nothing is refused.
- **Lazy remainder.** The bound is deliberately not a refusal, because
  refusing would block a revocation or brick a device. The remainder is left
  for a later writer, and a client that meets it
  [parks](./sync-edge-cases.md) rather than fails.

The [Loro runtime](#loro-runtime) bounds are counts and waits inside the SDK,
not wire bounds. Lazy remainders, the rotation-death limits, and one known
defect trade away write liveness;
[the last section](#limits-that-trade-write-liveness) names each such trade.
For shared terminology, see [glossary.md](./glossary.md).

Values are quoted from the constants named in each table; the constants, not
the tables, are the source of truth.

## Container hierarchy

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Container path length | 100 containers, including root and leaf (`MAX_CONTAINER_PATH_LENGTH`); depths zero through 99 | API: create and subtree-move checks in [`workflows/containers/mutations/shared/containerDepth.ts`](../packages/api/src/workflows/containers/mutations/shared/containerDepth.ts), under the organization lock; the CTE in [`access/shared/internal/containerKekTargetClosure.ts`](../packages/api/src/access/shared/internal/containerKekTargetClosure.ts) and writer/stored path loaders; container mutation and recitation request schemas bound every cited path (`*ContainerPathRefs`) to the same 100 references. SDK: local create/move refused before queuing ([`workflows/container-contents/container-state/localPathDepth.ts`](../packages/client-sdk/src/workflows/container-contents/container-state/localPathDepth.ts)), plan-time destination prechecks, and [`data/keyingProjectionVerification/document/documentDependencyPaths.ts`](../packages/client-sdk/src/data/keyingProjectionVerification/document/documentDependencyPaths.ts). | Final refusal (409 `container_path_too_deep`) before creating an unreadable path. A subtree move checks the deepest descendant, including descendants the caller cannot discover; a queued move refused for that reason is abandoned and its previous placement restored in the same local transaction. |
| Cited manifest history per container mutation | 4,096 references (`MAX_CONTAINER_MANIFEST_HISTORY_REFS`, [`validators/src/util/containerLimits.ts`](../packages/validators/src/util/containerLimits.ts)) | Validators: [`request/containerManifestRef.ts`](../packages/validators/src/request/containerManifestRef.ts) bounds `containerManifestHistoryRefs`. API: [`workflows/containers/mutations/shared/storedManifestArtifacts.ts`](../packages/api/src/workflows/containers/mutations/shared/storedManifestArtifacts.ts) refuses a repeated citation or one naming another container before any read, then loads the container's lineage in one bulk query. | Refusal (400). Inline bundles of 8-14 KiB fit about this many under the 32 MiB request ceiling, so the reference form keeps that capacity rather than letting a small body cite ~50x more. |
| Cited principal policy heads per container mutation | 4,096 references (`MAX_CONTAINER_PRINCIPAL_POLICY_REFS`, [`validators/src/util/containerLimits.ts`](../packages/validators/src/util/containerLimits.ts)) | Validators: [`request/principalPolicyRef.ts`](../packages/validators/src/request/principalPolicyRef.ts) bounds `principalPolicyRefs`. API: [`workflows/containers/mutations/shared/principalPolicies.ts`](../packages/api/src/workflows/containers/mutations/shared/principalPolicies.ts) collapses exact repeats, then loads every cited principal's current head in one query per principal type. | Refusal (400). Each head makes the API verify that principal's stored policy. Inline signed policies (about 9.8 KiB each) fit about this many under the 32 MiB request ceiling, so a ~170-byte reference keeps that capacity rather than multiplying it. |

Each cited reference is a stored
[manifest](./glossary/access.md#access-manifest) the API re-verifies, so the
history bound is also a CPU bound. A verification marker
(`access_manifests.verification_mac`) reduces a marked manifest to one HMAC over
its stored bytes. On PGlite a reference costs about 90 µs with a marker and 2 ms
without: at the bound, roughly 0.4 s, or 8 s after a rotated secret or rule
revision drops the markers. That pass records markers for later requests.

Create and move preserve the reader's structural bound. Policy
[rotations](./glossary/keys.md#rotate) and revocations do not change structure and
do not run these depth guards. The
bounded [container depth model](../formal/container-keying/ContainerDepth.md)
checks the create and move guards. Readers also refuse
malformed paths; the ancestor CTE accepts at most 100
[containers](./glossary/access.md#container) and rejects an unclosed parent at the
boundary rather than silently truncating it.
A queued create whose local path is already too deep waits without a request
until a local move re-arms it; one a stale local view lets through keeps
retrying like other permanent server refusals.

## Container keying

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Carried descendant rekeys per rotation | 64 (`MAX_ROTATION_CONTAINER_REKEYS`, [`validators/src/util/containerKekKeyringWire.ts`](../packages/validators/src/util/containerKekKeyringWire.ts)) | API: [`workflows/containers/mutations/shared/grantedPathCurrency.ts`](../packages/api/src/workflows/containers/mutations/shared/grantedPathCurrency.ts) computes the stranded closure and owes only its parent-first prefix; the request schema rejects more. SDK: the proactive carry refuses before signing what the server would refuse. | Lazy remainder. The rotation commits; levels past the prefix stay stale and repair on their next capable write. A writer granted only below one parks with `document_ancestor_repair_inaccessible`. |
| Inline container rekeys per document or blob write | 16 (`MAX_INLINE_CONTAINER_REKEYS`) | Validators: [`request/document.ts`](../packages/validators/src/request/document.ts), [`request/blob.ts`](../packages/validators/src/request/blob.ts). | Pagination. The sync pass commits the surplus as standalone rekeys before the write, within the per-pass budget below. |
| Ancestor repairs committed per sync pass | 100 (reuses `MAX_CONTAINER_PATH_LENGTH`) | SDK: [`workflows/documents/syncRekeys/syncContainerRekeyPreparation.ts`](../packages/client-sdk/src/workflows/documents/syncRekeys/syncContainerRekeyPreparation.ts). | The pass abandons with the `depth-budget` trace reason; writes stay queued and the next pass continues. |
| Rekeys attempted per queued update row | 5 (`MAX_PENDING_UPDATE_REKEYS`) | SDK: [`data/persistence/documents/records/documentPendingUpdatePersistence.ts`](../packages/client-sdk/src/data/persistence/documents/records/documentPendingUpdatePersistence.ts), persisted in the queued `document_history_updates` row so it survives restarts. A merged row takes the largest count among the rows it replaces. | The row is left untouched and reported as no progress, so a poisoned update cannot re-key forever. |
| Consecutive rekey-only sync passes | 3 (`MAX_CONSECUTIVE_REKEY_ONLY_PASSES`) | SDK: [`data/sync/outgoingUpdateSettlement.ts`](../packages/client-sdk/src/data/sync/outgoingUpdateSettlement.ts). | The lane goes idle; a later mutation or sync signal retries the pending work. Guards against a server that under-settles without conflicting. |
| Container key epoch | 65,536 (`MAX_CONTAINER_KEY_EPOCH`) | API at rotation time; response guards on every layer before cryptographic work. | Refusal of the rotation only. Never applied to existing data, so retained ciphertext stays readable. A runaway-rotation backstop, not a use case. |
| Container recitation epoch | 512 (`MAX_CONTAINER_RECITATION_EPOCH`, [`crypto/src/keying/containerAccess/containerAccessReciteBody.ts`](../packages/crypto/src/keying/containerAccess/containerAccessReciteBody.ts)) | Crypto: [`containerAccess.ts`](../packages/crypto/src/keying/containerAccess/containerAccess.ts); the SDK skips signing at the boundary and the API rejects independently. | Refusal. The ceiling is absolute and does not reset on rekey, reserving half of the same-epoch history budget below for ordinary mutations. |
| Same-epoch manifest history per container | 1,024 (`MAX_SAME_EPOCH_MANIFEST_HISTORY`, [`api/src/access/shared/internal/containerManifestBindingHistory.ts`](../packages/api/src/access/shared/internal/containerManifestBindingHistory.ts)) | API: the SQL walk that validates key bindings on document and blob writes, with one overflow sentinel. | Refusal (409). Fails closed and requires a rekey, which starts a new same-epoch chain. |
| KEK-log page | 256 epochs (`CONTAINER_KEK_LOG_PAGE_LIMIT`) | API: [`workflows/containers/kekLog.ts`](../packages/api/src/workflows/containers/kekLog.ts). | Pagination. Recovery walks from the newest page backward, so page size, not lifetime rotation count, bounds a response. |

Lifetime container and document manifest history has no depth refusal. The API
verifies retained dependencies iteratively, including ancestor lineage, and
marks each accepted manifest in its row's `access_manifests.verification_mac`,
which loads with the row, so checking a marker costs no query of its own. A
container mutation marks the manifest it stores, with any unmarked history it
depends on, under its organization lock; a document mutation marks only its
document's history. A container or document projection read that verified
unmarked history writes those markers back after its transaction commits, one
autocommit update per marker; every read path also keeps the markers it
computed in a bounded per-process cache, so no path re-verifies a history on
each request. A marker's MAC, keyed from the server-held
`DOCUMENT_SYNC_CURSOR_HMAC_KEY` (or a per-process key when none is configured),
binds the manifest hash, a digest of that manifest's complete stored bundle,
its signer's stored public key, and the crypto and API rule revisions.
Verification stops at the first valid marker, so each manifest is
signature-checked about once in its lifetime. A row whose bytes changed, a
changed signer key or a forged marker makes that manifest verify in full
wherever the server verifies it; a rotated secret or new rule revision
re-verifies each object's history once, on its next projection read or
mutation. Serving a
[writer projection](./glossary/sync.md#writer-projection) still loads every retained
manifest its key history cites, in a few batched queries, and carries each
distinct manifest bundle once however many paths and histories cite it. A
request may cite at most 48 manifest bundles and
[container KEK](./glossary/keys.md#container-kek) levels the device holds verified
(`x-known-manifests`), plus at most 8 organization directory payloads it holds
in verified policy bundles (`KNOWN_DIRECTORY_HINT_LIMIT`); their bytes are then
omitted, and the device keeps at most 1,024 manifest and level rows, one level
per container. Neither bound limits
the history a reader receives; see
[the incremental evidence contract](./projection-policy-evidence.md#cost-and-retained-history-tradeoff).
For N ancestor
manifests, the request-local lineage index uses O(N log N) work and space, with
O(log N) per lineage query; see
[the availability model](../formal/container-keying/ManifestHistory.md).

The sealed [keyring](./glossary/keys.md#container-kek-keyring) is 64 bytes per
retained epoch and is never truncated, so at the epoch cap it is about 4 MB;
that is why the KEK log serves at most one historical keyring per request. See
[keying-design.md](./keying-design/container-keks.md#additive-versus-subtractive-changes)
for the cost model and
[protocol-specification.md](./protocol-specification/container-access.md#container-access-and-kek-protocol)
for the exact-length rule.

## Document sync

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Sync request body | 16 MiB (`MAX_DOCUMENT_SYNC_REQUEST_BYTES`, [`validators/src/util/documentSyncLimits.ts`](../packages/validators/src/util/documentSyncLimits.ts)) | SDK applies the exact serialized-byte ceiling after encryption and trims the batch; the Worker entry bounds the stream at this ceiling before the route buffers it; API rejects. | Pagination for a batch. A single update that cannot fit abandons with `document_sync_request_too_large`. |
| Outgoing updates per request | 64 (`MAX_DOCUMENT_SYNC_OUTGOING_UPDATES`) | SDK: [`data/documents/shared/sync/documentSyncOutgoingBatch.ts`](../packages/client-sdk/src/data/documents/shared/sync/documentSyncOutgoingBatch.ts). | Pagination. |
| Merged queued update size | 8 MiB of base64 `updateData` (`QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS`, half of `MAX_DOCUMENT_SYNC_REQUEST_BYTES`) | SDK: [`stores/documents/documentStore/sync/syncQueueMergePlan.ts`](../packages/client-sdk/src/stores/documents/documentStore/sync/syncQueueMergePlan.ts) plans within it and [`syncQueueMerge.ts`](../packages/client-sdk/src/stores/documents/documentStore/sync/syncQueueMerge.ts) rechecks the exported blob. | The run is cut there; rows past the cap start a new merge or go out unmerged. A merged update always fits a request. |
| Queued rows inspected for merging per sync pass | 256 (`QUEUED_UPDATE_MERGE_MAX_ROWS_PER_PASS`) | SDK: [`stores/documents/documentStore/sync/syncQueueMergePlan.ts`](../packages/client-sdk/src/stores/documents/documentStore/sync/syncQueueMergePlan.ts) proves and plans only the first 256 queued rows (the front of the queue, sent first), whether or not they merge, so this bounds the proofs and export done while the SQL lock is held. | Rows past the bound are sent unmerged; a later pass inspects whatever is still queued. |
| Authorization paths per request | 64 (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS`), each at most 100 deep, so 6,400 path refs (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS`) | Validators; derived from the structural limits so every valid link set stays syncable after later moves deepen its paths. | Refusal. |
| Content-key targets per document | 64 (`MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS`) | API create and link validation; SDK link preflight in [`workflows/documents/linkSet/`](../packages/client-sdk/src/workflows/documents/linkSet/). | Refusal at link time, so no document can be created that does not fit the sync contract. |
| Response page | 48 MiB (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES`), of which 16 MiB is envelope (`MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES`) | API. Sized to carry the largest accepted atomic rotation baseline plus its signed metadata, while the page and its serialized copy both fit the 128 MB Workers isolate. A page is sized from stored byte lengths before it loads, so it holds at most the 32 MiB update share plus 64 entries' fixed-size fields. | Pagination. |
| Updates per response page | 64 (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES`); a request's `maxPageUpdates`, 1 to 64, lowers it but never raises it | Validators bound `maxPageUpdates`; API: [`workflows/documents/mutations/syncResponseUpdates.ts`](../packages/api/src/workflows/documents/mutations/syncResponseUpdates.ts) serves the smaller. The SDK asks for 1 while it [isolates](#loro-runtime) updates a death left unattributed. | Pagination via the pull cursor. |
| Pull cursor length | 512 (`MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH`) | Validators. | Refusal. |
| Refused peers named per refusal | 64 (`MAX_DOCUMENT_PEER_FRONTIERS`, [`validators/src/response/documentSyncError.ts`](../packages/validators/src/response/documentSyncError.ts)) in the `peerFrontiers` of a 409 `document_sync_peer_owned` or `document_sync_dependency_uncommitted` | API: [`documents/documentPeerOwners.ts`](../packages/api/src/documents/documentPeerOwners.ts) names the first 64 refused peers in canonical order, each with the frontier committed before the request; the response schema bounds the list. | Pagination. The client [rebases](./advisory-op-spans.md#rebasing-onto-a-fresh-peer) the named peers onto a fresh peer, and its retry draws a refusal naming the rest. |
| Span and peer-owner rows per insert statement | 8,192 (`DOCUMENT_PEER_ROWS_PER_INSERT`, [`api/src/documents/documentPeerRowChunks.ts`](../packages/api/src/documents/documentPeerRowChunks.ts)) | API: [`documents/documentUpdateSpans.ts`](../packages/api/src/documents/documentUpdateSpans.ts) inserts one span row per peer of each new update's declared span, and [`documents/documentPeerOwners.ts`](../packages/api/src/documents/documentPeerOwners.ts) one owner row per peer the write claims, in statements of at most this many rows inside the write's transaction. Document sync and a link-set mutation's rotation baseline both write through them. Postgres binds at most 65,535 parameters to one statement, and a span row binds five. | More statements in the same transaction; nothing is refused, so a write's rows are bounded only by its request body. A rotation baseline has one span row per peer in the document's history, and nothing caps that history: see [the known defect](#known-defect-unbounded-document-history). |

## Loro runtime

These bounds are the SDK's own. They decide what a WebAssembly trap or a
process death while reading served updates with Loro counts toward, and how
long the [read windows](./glossary/sync.md#loro-read-window) that tell one
from the other wait.
[Loro runtime failures](./advisory-op-spans.md#loro-runtime-failures)
describes the windows, and [rotation deaths](./rotation-deaths.md) the count a
key rotation keeps.

A window's kind (`LoroWindowKind` in
[`loroWindowMachine.ts`](../packages/client-sdk/src/data/documents/shared/sync/loroWindowMachine.ts))
decides what a death inside it is charged to:

| Kind | Opened by | A death inside it | A window the process outlives |
| --- | --- | --- | --- |
| `read` | A sync pass, a container metadata pull, a founding view, and a rotation page reading an update the device has not accepted. | Counts one attempt toward the update, when the window held it alone and was its lifetime's only open one. Otherwise it isolates the page's updates. | Clears the attempts earlier deaths counted toward the updates it read. |
| `rotation` | A rotation's raw-history page whose updates the live document covers. | Counts toward the device's rotation of the document, never an update, and isolates the page's updates. | Clears those attempts too. |
| `history` | Each page of a [history verification](./developer/client-sdk/document-history.md#verifying-history). | Counts toward nothing: no attempt, no isolation, no rotation death. The next claim on the scope deletes the row. Its row never replaces the row another window of the lifetime holds on the scope, so a death beside a sync pass's window still isolates that page's updates. | Clears no attempt. Verification writes nothing but its window rows. |

A verification rebuilds a whole history for a viewer, so its death is
likeliest the rebuild's size, and a viewer must cost neither an update nor
the device's rotation. Its window still follows the one rule every window
shares: while it is open, no other window of the lifetime counts a death. A
scope already isolating suspects is not read at all, and the verification
ends `unsettled`.

No limit here bounds the time a reader spends importing one served update. The
sync request ceiling bounds the update's size, and the exactly pinned Loro
version imports one large text insert in bounded time: 512 KiB in under a
second, which the
[runtime contract](../packages/loro/src/runtimeContract.test.ts) checks. Loro
1.16.4 took time quadratic in the insert's size, about a minute for 2 MiB
([#3196](https://github.com/a2f0/tearleads/issues/3196)). Moving the pin
follows [dependency maintenance](./dependency-upgrades.md#current-constraints).

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Runtime attempts that void an update | 3 process lifetimes (`MAX_LORO_RUNTIME_ATTEMPTS`, [`data/documents/shared/sync/loroRuntimeFailureLedger.ts`](../packages/client-sdk/src/data/documents/shared/sync/loroRuntimeFailureLedger.ts)) | SDK: a process's first runtime failure while sync judges the update counts one attempt toward it, and so does a death in a read window that held the update alone, which the next lifetime claims ([`workflows/documents/sync/loroWindows.ts`](../packages/client-sdk/src/workflows/documents/sync/loroWindows.ts)). Attempts persist at stage `loro_runtime` in `document_void_updates`. | The update is a final void under that judge, reported, and never read again; a new judge (a decoder or void-rules change) judges it from zero. Below the limit it is unsettled: it holds every later update of its page, and in the same process it waits out a retry delay of one minute, doubling to an hour. |
| Updates per pull while isolating | 1 (`maxPageUpdates: 1`, from `loroIsolationPageLimit` in [`data/documents/shared/sync/loroWindowMachine.ts`](../packages/client-sdk/src/data/documents/shared/sync/loroWindowMachine.ts)) | SDK: after a death that names no single update, the document's sync and container-metadata pulls ask for one update a page (`claimThenReadDocumentSyncPageLimit`), and a rotation's raw-history pulls do while deaths stand against it (`claimThenReadDocumentRotationPageLimit`), so a later death names one update. | Pagination. Sync keeps to one update a page until its pages have passed every suspect or a pull completes; a rotation, until a rebuild completes. |
| Window gate wait | 30 s (`GATE_WAIT_MS`, [`data/documents/shared/sync/loroLifetime.ts`](../packages/client-sdk/src/data/documents/shared/sync/loroLifetime.ts)) | SDK: a window isolating suspects waits to be its lifetime's only open one, and other windows wait while it reads ([`loroWindowGate.ts`](../packages/client-sdk/src/data/documents/shared/sync/loroWindowGate.ts)). | The window opens outside the gate. Opening beside another window stops every window of the lifetime counting a death, so the wait costs isolation progress, never accuracy. |
| Lifetime lock wait | 10 s (`LOCK_WAIT_MS`, `loroLifetime.ts`) | SDK: each lifetime holds a Web Lock named after it, so the next lifetime can tell a dead lifetime's windows from a live tab's. | The lifetime opens no read window for the rest of its life, as on a host without Web Locks, so its deaths count toward nothing. Sync still reads. |
| Restart drain wait | 10 s (`DRAIN_WAIT_MS`, [`loroRuntimeHealth.ts`](../packages/client-sdk/src/data/documents/shared/sync/loroRuntimeHealth.ts)) | SDK: `prepareRuntimeRestart()` admits no new read window until the open ones close. | It resolves anyway. A window still open at the reload ends with the page hidden, so the next lifetime counts nothing for it. |
| Restart hold | 5 s (`RESTART_HOLD_MS`, [`loroWindowDrain.ts`](../packages/client-sdk/src/data/documents/shared/sync/loroWindowDrain.ts)) | SDK: after the drain the page still admits no window, so a reload that follows at once finds none open. A window asked for meanwhile waits, at most the gate's 30 s. | In a page its host kept, held windows open again and the runtime health returns to `restartRequired` ([runtime restart](./developer/client-sdk/runtime-behavior.md#runtime-restart)). |
| Rotation deaths per document | 3 under one judge with no completed rebuild between them (`MAX_ROTATION_DEATHS`, [`data/documents/shared/sync/rotationAvailabilityMachine.ts`](../packages/client-sdk/src/data/documents/shared/sync/rotationAvailabilityMachine.ts)), held equal to `MAX_LORO_RUNTIME_ATTEMPTS` | SDK: a death alone in a rotation's raw-history window, on a page the live document already covers, counts toward the device's rotation of the document, never toward an update (`loroWindows.ts`); the count persists in `document_rotation_availability`. | If the third death read one update alone, the next rebuild [leaves it out](./rotation-deaths.md#leaving-an-update-out); otherwise the device's rotation of the document is [unavailable](./rotation-deaths.md#unavailable-rotation). A rotation, unlink, or purge-unlink it starts is then refused with `DocumentRotationUnavailableError` and a queued move parks, leaving those writes to other members until a new judge starts the count over. Below the limit, a completed rebuild starts it over. |
| Updates left out of one document's rebuilds | 8 (`MAX_ROTATION_LEFT_OUT`) | SDK: `rotationAvailabilityMachine.ts`. | The next death that would leave one more out makes the device's rotation of the document unavailable instead, as above. Each update left out cost the device the deaths that found it, so a writer must spend eight crashing updates on a device before one more stops its rotations. |
| Updates in a history one device verifies | 20,000 (`MAX_VERIFIED_HISTORY_UPDATES`, [`workflows/documents/history/documentHistoryRawPull.ts`](../packages/client-sdk/src/workflows/documents/history/documentHistoryRawPull.ts)), held equal to the attribution reader's `MAX_RANGES` | SDK: `verifyDocumentHistory` reads the count the first raw page reports (`pullPage.throughUpdateCount`), and counts the updates it is served, so a server that understates the count is bounded too. | The verification ends `unavailable` with reason `too_large`, before it imports anything of that page. Nothing is recorded, and sync, editing, and rotation are unaffected. The number is not measured: it bounds the pages a viewer asks for, not the memory a rebuild needs. |

## Edit attribution

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Compact attribution segments | 2,000 (`MAX_COMPACT_ATTRIBUTION_SEGMENTS`, [`api/src/workflows/documents/documentEditAttribution.ts`](../packages/api/src/workflows/documents/documentEditAttribution.ts)) | API: `GET /documents/{documentId}/attribution` merges adjacent ranges under one authority up to the limit. SDK: a device holding a void update of the document builds the list itself from the ranges without the void ones, to the same limit (`MAX_COMPACT_SEGMENTS`, [`workflows/container-contents/attribution/attributionVoids.ts`](../packages/client-sdk/src/workflows/container-contents/attribution/attributionVoids.ts)). | The list stops at the limit with `truncated: true`. Info then reports attribution as `truncated` and computes no blame, and row writers use no segments. |
| Attribution range page | 500 ranges; 100 when the request names no limit (`MAX_ATTRIBUTION_RANGE_LIMIT`, [`api/src/workflows/documents/documentEditAttributionPagination.ts`](../packages/api/src/workflows/documents/documentEditAttributionPagination.ts)) | Validators and API, for `GET /documents/{documentId}/attribution/ranges`. The SDK and the app page at 500 (`RANGE_PAGE_LIMIT`). | Refusal (400). |
| Ranges one reader pages through | 20,000 (`MAX_RANGES`, `attributionVoids.ts`) | SDK: building compact segments without void updates. App: the History panel's upload times read to the same bound ([`stores/documents/useDocumentAttributionRanges.ts`](../packages/app/src/stores/documents/useDocumentAttributionRanges.ts)). | The SDK stops paging and returns the segments built so far with `truncated: true`. The app reads the document as having no ranges, since part of the list would date a change from whichever uploads were on the pages read. |

## Database connections

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Worker request Postgres pool | 4 connections, 30 s idle timeout | [`packages/api/wrangler.jsonc`](../packages/api/wrangler.jsonc) and [`api-shared/src/adapters/postgresConfig.ts`](../packages/api-shared/src/adapters/postgresConfig.ts); the pool closes when the request finishes. Connections use the Hyperdrive binding. | Wait for a free client; connection acquisition times out after 5 s. |
| Hyperdrive origin connections | Soft limit of 20 per tier | `terraform/stacks/<tier>/postgres/hyperdrive.tf`; TLS connections use the runtime login through PlanetScale PgBouncer on port 6432. | Hyperdrive queues connection acquisition within its service limits. |
| Hyperdrive query cache | Disabled | Terraform `caching.disabled = true`. Sync cursors, access epochs, and session revocation require fresh reads after writes. | Every query reaches the database. |

[Hyperdrive](./developer/infrastructure.md#infrastructure-lifecycle) holds
origin connections across requests; Worker sockets remain request-scoped.
`POSTGRES_POOL_MAX_USES=1` only retires clients in the fallback pool used by
Durable Object timers; request pools reuse clients until the request ends. The
migration login connects directly from the deploy host and is never bound to
the Worker. The Worker carries an `aws:us-east-1` placement hint.

## Blobs

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Request body on the unauthenticated surface (`/`, `/auth/*`, `/billing/*`) | 2 MiB (`MAX_UNAUTHENTICATED_REQUEST_BYTES`, [`packages/api/src/worker/requestBody.ts`](../packages/api/src/worker/requestBody.ts)) | The Worker entry, before any route runs; every session route keeps the ceiling below, since container rotations and document payloads legitimately carry megabytes of keyrings and baselines. | Refusal. Bounds what a client without a session can make the isolate buffer or parse. |
| Request memory per isolate | 96 MiB across concurrent requests (`BODY_ADMISSION_BYTES`, [`packages/api/src/worker/bodyAdmission.ts`](../packages/api/src/worker/bodyAdmission.ts)) | Before reading a body or opening a database pool, the Worker reserves the declared length (or route ceiling when undeclared), plus a 48 MiB response page only for document sync POSTs. Syncs run one at a time per isolate. Reservations last through route/response cleanup; preflights reserve no sync page. | Wait in a queue of at most 32 requests for up to 30 seconds, then return 503 (`Server busy, please retry`) with `Retry-After: 1`. Requests of at most 2 MiB can use spare capacity ahead of queued syncs. |
| Request body and multipart part | 32 MiB (`MAX_MULTIPART_BLOB_PART_BYTES`, `MAX_UPLOAD_PART_BYTES`) | Signed upload authorization and the client enforce the part ceiling. S3/R2 receive parts directly; the bound keeps client hashing and native bridges bounded. The Worker and Bun listener also cap API request bodies; non-signing stores buffer parts there. | Refusal. This is the route ceiling every other request-size limit sits under. |
| Chunk size | 5 MiB, fixed (`BLOB_CHUNK_SIZE_BYTES`, [`crypto/src/envelopes/blobEnvelopeV2.ts`](../packages/crypto/src/envelopes/blobEnvelopeV2.ts)) | Crypto envelope format. | Not a tunable. |
| Chunks per blob | 10,000 (`MAX_BLOB_CHUNK_COUNT`), so a blob is at most about 48.8 GiB | Crypto envelope parser; SDK [`workflows/blobs/upload/multipartUpload.ts`](../packages/client-sdk/src/workflows/blobs/upload/multipartUpload.ts) refuses before uploading. | Refusal. |
| Envelope header | 64 KiB (`MAX_BLOB_ENVELOPE_HEADER_BYTES`, [`crypto/src/envelopes/blobEnvelopeReader.ts`](../packages/crypto/src/envelopes/blobEnvelopeReader.ts)) | Crypto reader, before parsing. | Refusal. |

## Realtime

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| WebSocket client message | 1,000,000 bytes (`MAX_WS_CLIENT_MESSAGE_BYTES`, [`validators/src/realtime/wsClientDeclarations.ts`](../packages/validators/src/realtime/wsClientDeclarations.ts)) | Transport payload bound and a pre-parse length check. | Refusal before JSON parsing. |
| Pending frames per socket | 32 frames or 4,000,000 bytes (`DEFAULT_SOCKET_QUEUE_LIMITS`, [`packages/api/src/worker/socketQueue.ts`](../packages/api/src/worker/socketQueue.ts)) | The realtime hub queues each socket's frames behind its authorization. | The socket closes with 1013 and its queue is discarded. |
| Pending bytes per hub | 32 MiB across every socket (`HUB_QUEUE_BUDGET_BYTES`, [`packages/api/src/worker/hubConnections.ts`](../packages/api/src/worker/hubConnections.ts)) | The hub's shared queue budget, so many flooding sockets cannot exhaust its isolate. | The socket that would overrun the budget closes with 1013; the others continue. |
| Sockets per session | 8 (`MAX_SOCKETS_PER_SESSION`) | The hub counts open sockets per session at upgrade. | Refusal with 429 until one closes. |
| Interest container ids per declaration | 10,000 (`MAX_WS_INTEREST_CONTAINER_IDS`) | Validators. | Refusal. Interest is an invalidation subscription, not an authorization grant. |

## Principals

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Principal state version | Positive exact JavaScript integer, through `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) | Request/response validators; crypto [`principalState.ts`](../packages/crypto/src/principalState/principalState.ts); PostgreSQL `bigint` and SQLite `INTEGER`, with range checks on state/head projection columns. | Representation/overflow refusal only; there is no lifetime history budget. Cold verification walks the complete chain. |
| Principal key epoch | Positive exact JavaScript integer through `Number.MAX_SAFE_INTEGER`; genesis 1, rotation advances exactly one | Crypto, wire schemas, SDK records, and range-checked PostgreSQL `bigint` / SQLite `INTEGER` columns for states, member envelopes, verified progress and manifest heads. | Invalid epochs and jumps are refused before commit; unchanged keys retain their epoch. |
| Principal crypto history page | 128 entries, 128 signer keys, 129 external-authority states; 128 retained reference requests per verifier (`PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT`, [`crypto/src/keying/principalPolicyHistory/principalPolicyHistoryTypes.ts`](../packages/crypto/src/keying/principalPolicyHistory/principalPolicyHistoryTypes.ts)) | [`principalPolicyHistoryPage.ts`](../packages/crypto/src/keying/principalPolicyHistory/principalPolicyHistoryPage.ts), [`principalPolicyHistoryChecks.ts`](../packages/crypto/src/keying/principalPolicyHistory/principalPolicyHistoryChecks.ts) | Split work across pages/verifiers. This component does not bound individual projection bytes; see [the verifier contract](principal-history-pages.md). |
| Principal GET history page | 32 historical entries (`PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT`) plus the pinned head's current artifacts | Response validators and API [`principalPolicyPage.ts`](../packages/api/src/workflows/principals/principalPolicyPage.ts). | Continue with the same head hash and returned cursor. This bounds history depth per response, not projection bytes or total SDK memory; see [the transport contract](principal-history-transport.md). |

Cold verification still grows with total signed history, across resumable
requests. Preparation runs outside the final mutation transaction; each final
commit rechecks current authorization and exact
[heads](./glossary/sync.md#head). The
[HTTP acceptance evidence](principal-history-acceptance.md) exercises revocation
and cold historical decryption through version 16,385 with a 15-second deadline
per response, on SQLite and networked PostgreSQL. Those fixed-cardinality tests
do not bound arbitrary [policy](./glossary/principals.md#principal-policy-state)
size or aggregate load across API replicas.

## Limits that trade write liveness

The no-bricked-device invariant says no device may be unable to read or write
because another device must write first. No limit above makes a reader wait on
another device: a reader resolves a retired parent pin through retained
history, and an update the reader's own Loro runtime cannot read holds back
later updates only until the reader's own retries and restarts settle it
([runtime attempts](#loro-runtime)). The following exceptions can leave a
writer waiting on another authorized member:

- **Carried descendant rekeys past 64.** Levels beyond the parent-first prefix
  stay stale after the rotation commits. A writer granted only below such a
  level cannot [re-key](./glossary/keys.md#rekey) it and must not be handed its
  key, so it parks under `document_ancestor_repair_inaccessible` until a member
  with access at that level writes there.
- **Documents linked across access boundaries.** A writer through one link
  cannot always repair a stale
  [content-key bundle](./glossary/keys.md#content-key-bundle) after another link
  rotates. Repair needs every target's current wrapping key and may require
  write access at a stale level. The writer waits under
  `document_ancestor_repair_inaccessible` for an authorized member to repair
  it; if no remaining member spans the required targets, writes stay blocked.
  The trade avoids exposing inaccessible folders'
  [grant](./glossary/access.md#grant) lists.
  Ordinary writes need only one writable link while the bundle is current.
- **Rotation deaths past either limit.** A device whose rotation of a
  document is [unavailable](./rotation-deaths.md#unavailable-rotation) leaves
  that document's rotations, unlinks, moves, and purge-unlinks to other
  members: one it starts is refused, and a queued move it cannot prove parks,
  until a new judge (a decoder or void-rules change) starts the count over. It
  still opens, edits, and syncs the document, and no other device waits on it.

For the single-path case within the carried-rekey bound, the model in
[InaccessibleIntermediateRepair.md](../formal/container-keying/InaccessibleIntermediateRepair.md)
proves the writer is eventually unblocked with fairness only on its own step.
Outside it, that model's `rotation-without-descendant-repairs-bricks-leaf-writer`
control is the exact behaviour, and it violates the liveness property by
design. Nothing schedules the lazy repair; whichever capable member writes
beneath the stale level first performs it. See
[NoBrickedDevice.md](../formal/container-keying/NoBrickedDevice.md) for the
invariant and [client-sdk.md](./developer/client-sdk/public-api.md#public-api-entry-points)
for how the SDK reports the parked state.

### Known defect: unbounded document history

This defect stops writes outright rather than making a writer wait. Nothing
caps a document's history: its peers, or its content, which deleting text
does not shrink. A [rotation baseline](./glossary/keys.md#rotation-baseline),
a full-history snapshot, carries all of it in one request. Once the history
outgrows that request, a sync abandons the baseline past 16 MiB with
`document_sync_request_too_large`, and a link-set mutation is refused past
the 32 MiB route ceiling. No member can then rotate the document's content
key, unlink, move, or purge-unlink it, and unlink can no longer remove a
link's access to it ([#3238](https://github.com/a2f0/tearleads/issues/3238)).
A member can cause this with many peers or with content alone, and a large
honest document reaches it too. Writes other than rotation baselines stay far
below both bounds. Span and owner rows are written in chunks, so a
baseline's peer count alone no longer fails at the database
([#3230](https://github.com/a2f0/tearleads/issues/3230), item 3).
