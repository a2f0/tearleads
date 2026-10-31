# Limits

Every bound the protocol enforces, what enforces it, and what happens on the
far side of it. A limit here is one of three kinds:

- **Refusal.** The request is rejected and the client must change what it
  sends. These are wire-contract bounds against hostile or runaway input.
- **Pagination.** The work continues on the next request or the next sync
  pass; nothing is refused.
- **Lazy remainder.** The bound is deliberately not a refusal, because
  refusing would block a revocation or brick a device. The remainder is left
  for a later writer, and a client that meets it parks rather than fails.

The third kind is the only one that trades write liveness for something else,
and [the last section](#limits-that-trade-write-liveness) names each such
trade. For shared terminology, see [glossary.md](./glossary.md).

Values are quoted from the constants named in each table; the constant is the
source of truth and the tables are a map to it.

## Container hierarchy

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Container path length | 100 containers, including root and leaf (`MAX_CONTAINER_PATH_LENGTH`); depths zero through 99 | API: create and subtree-move checks in `workflows/containers/mutations/shared/containerDepth.ts`, under the organization lock; the CTE in `access/shared/internal/containerKekTargets.ts` and writer/stored path loaders; container mutation and recitation request schemas bound every cited path (`*ContainerPathRefs`) to the same 100 references. SDK: local create/move refused before queuing (`workflows/container-contents/container-state/localPathDepth.ts`), plan-time destination prechecks, and `data/keyingProjectionVerification/document/documentDependencyPaths.ts`. | Final refusal (409 `container_path_too_deep`) before creating an unreadable path. A subtree move checks the deepest descendant, including descendants the caller cannot discover; a queued move refused for that reason is abandoned and its previous placement restored in the same local transaction. |
| Cited manifest history per container mutation | 4,096 references (`MAX_CONTAINER_MANIFEST_HISTORY_REFS`, `validators/src/util/containerLimits.ts`) | Validators: `request/containerManifestRef.ts` bounds `containerManifestHistoryRefs`. API: `workflows/containers/mutations/shared/storedManifestArtifacts.ts` refuses a repeated citation or one naming another container before any read, then loads the container's lineage in one bulk query. | Refusal (400). Inline bundles of 8-14 KiB fit about this many under the 32 MiB request ceiling, so the reference form keeps that capacity rather than letting a small body cite ~50x more. |
| Cited principal policy heads per container mutation | 4,096 references (`MAX_CONTAINER_PRINCIPAL_POLICY_REFS`, `validators/src/util/containerLimits.ts`) | Validators: `request/principalPolicyRef.ts` bounds `principalPolicyRefs`. API: `workflows/containers/mutations/shared/principalPolicies.ts` collapses exact repeats, then loads every cited principal's current head in one query per principal type. | Refusal (400). Each head makes the API verify that principal's stored policy. Inline signed policies (about 9.8 KiB each) fit about this many under the 32 MiB request ceiling, so a ~170-byte reference keeps that capacity rather than multiplying it. |

Each cited reference is a stored manifest the API re-verifies, so the history
bound is also a CPU bound. A verification marker
(`access_manifests.verification_mac`) reduces a marked manifest to one HMAC
over its stored bytes. On PGlite a reference costs about 90 µs with a marker
and 2 ms without: at the bound, roughly 0.4 s, or 8 s after a rotated secret or
rule revision drops the markers. That pass records markers for later requests.

Create and move preserve the reader's structural bound. Policy rotations and
revocations do not change structure and do not run these depth guards. The
bounded [container depth model](../formal/container-keying/ContainerDepth.md)
checks the create and move guards. Readers also refuse
malformed paths; the ancestor CTE accepts at most 100 containers and rejects
an unclosed parent at the boundary rather than silently truncating it.
A queued create whose local path is already too deep waits without a request
until a local move re-arms it; one a stale local view lets through keeps
retrying like other permanent server refusals.

## Container keying

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Carried descendant rekeys per rotation | 64 (`MAX_ROTATION_CONTAINER_REKEYS`, `validators/src/util/containerKekKeyringWire.ts`) | API: `workflows/containers/mutations/shared/grantedPathCurrency.ts` computes the stranded closure and owes only its parent-first prefix; the request schema rejects more. SDK: the proactive carry refuses before signing what the server would refuse. | Lazy remainder. The rotation commits; levels past the prefix stay stale and repair on their next capable write. A writer granted only below one parks with `document_ancestor_repair_inaccessible`. |
| Inline container rekeys per document or blob write | 16 (`MAX_INLINE_CONTAINER_REKEYS`) | Validators: `request/document.ts`, `request/blob.ts`. | Pagination. The sync pass commits the surplus as standalone rekeys before the write, within the per-pass budget below. |
| Ancestor repairs committed per sync pass | 100 (reuses `MAX_CONTAINER_PATH_LENGTH`) | SDK: `workflows/documents/syncRekeys/syncContainerRekeyPreparation.ts`. | The pass abandons with the `depth-budget` trace reason; writes stay queued and the next pass continues. |
| Rekeys attempted per queued update row | 5 (`MAX_PENDING_UPDATE_REKEYS`) | SDK: `data/persistence/documents/records/documentPendingUpdatePersistence.ts`, persisted in the queued `document_history_updates` row so it survives restarts. | The row is left untouched and reported as no progress, so a poisoned update cannot re-key forever. |
| Consecutive rekey-only sync passes | 3 (`MAX_CONSECUTIVE_REKEY_ONLY_PASSES`) | SDK: `data/sync/outgoingUpdateSettlement.ts`. | The lane goes idle; a later mutation or sync signal retries the pending work. Guards against a server that under-settles without conflicting. |
| Container key epoch | 65,536 (`MAX_CONTAINER_KEY_EPOCH`) | API at rotation time; response guards on every layer before cryptographic work. | Refusal of the rotation only. Never applied to existing data, so retained ciphertext stays readable. A runaway-rotation backstop, not a use case. |
| Container recitation epoch | 512 (`MAX_CONTAINER_RECITATION_EPOCH`, `crypto/src/keying/containerAccessReciteBody.ts`) | Crypto: `containerAccess.ts`; the SDK skips signing at the boundary and the API rejects independently. | Refusal. The ceiling is absolute and does not reset on rekey, reserving half of the same-epoch history budget below for ordinary mutations. |
| Same-epoch manifest history per container | 1,024 (`MAX_SAME_EPOCH_MANIFEST_HISTORY`, `api/src/access/shared/internal/containerKekTargets.ts`) | API: the SQL walk that validates key bindings on document and blob writes, with one overflow sentinel. | Refusal (409). Fails closed and requires a rekey, which starts a new same-epoch chain. |
| KEK-log page | 256 epochs (`CONTAINER_KEK_LOG_PAGE_LIMIT`) | API: `workflows/containers/kekLog.ts`. | Pagination. Recovery walks from the newest page backward, so page size, not lifetime rotation count, bounds a response. |

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
writer projection still loads every retained manifest its key history cites,
in a few batched queries, and carries each distinct manifest bundle once however
many paths and histories cite it. A request may cite at most 48 manifest
bundles and container KEK levels the device holds verified
(`x-known-manifests`); their bytes are then omitted, and the device keeps at
most 1,024 such rows, one level per container. Neither bound limits
the history a reader receives; see
[the incremental evidence contract](./projection-policy-evidence.md#cost-and-retained-history-tradeoff).
For N ancestor
manifests, the request-local lineage index uses O(N log N) work and space, with
O(log N) per lineage query; see
[the availability model](../formal/container-keying/ManifestHistory.md).

The sealed keyring is 64 bytes per retained epoch and is never truncated, so
at the epoch cap it is about 4 MB; that is why the KEK log serves at most one
historical keyring per request. See
[keying-design.md](./keying-design.md#additive-versus-subtractive-changes)
for the cost model and
[protocol-specification.md](./protocol-specification.md#container-access-and-kek-protocol)
for the exact-length rule.

## Document sync

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Sync request body | 16 MiB (`MAX_DOCUMENT_SYNC_REQUEST_BYTES`, `validators/src/util/documentSyncLimits.ts`) | SDK applies the exact serialized-byte ceiling after encryption and trims the batch; the Worker entry bounds the stream at this ceiling before the route buffers it; API rejects. | Pagination for a batch. A single update that cannot fit abandons with `document_sync_request_too_large`. |
| Outgoing updates per request | 64 (`MAX_DOCUMENT_SYNC_OUTGOING_UPDATES`) | SDK: `data/documents/shared/sync/documentSyncOutgoingBatch.ts`. | Pagination. |
| Authorization paths per request | 64 (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS`), each at most 100 deep, so 6,400 path refs (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS`) | Validators; derived from the structural limits so every valid link set stays syncable after later moves deepen its paths. | Refusal. |
| Content-key targets per document | 64 (`MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS`) | API create and link validation; SDK link preflight in `workflows/documents/linkSet/`. | Refusal at link time, so no document can be created that does not fit the sync contract. |
| Response page | 48 MiB (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES`), of which 16 MiB is envelope (`MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES`) | API. Sized to carry the largest accepted atomic rotation baseline plus its signed metadata, while the page and its serialized copy both fit the 128 MB Workers isolate. A page is sized from stored byte lengths before it loads, so it holds at most the 32 MiB update share plus 64 entries' fixed-size fields. | Pagination. |
| Updates per response page | 64 (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES`) | API. | Pagination via the pull cursor. |
| Pull cursor length | 512 (`MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH`) | Validators. | Refusal. |

## Database connections

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Worker request Postgres pool | 4 connections, 30 s idle timeout | [`packages/api/wrangler.jsonc`](../packages/api/wrangler.jsonc) and `api-shared/src/adapters/postgresConfig.ts`; the pool closes when the request finishes. Connections use the Hyperdrive binding. | Wait for a free client; connection acquisition times out after 5 s. |
| Hyperdrive origin connections | Soft limit of 20 per tier | `terraform/stacks/<tier>/postgres/hyperdrive.tf`; TLS connections use the runtime login through PlanetScale PgBouncer on port 6432. | Hyperdrive queues connection acquisition within its service limits. |
| Hyperdrive query cache | Disabled | Terraform `caching.disabled = true`. Sync cursors, access epochs, and session revocation require fresh reads after writes. | Every query reaches the database. |

Hyperdrive holds origin connections across requests; Worker sockets remain
request-scoped. `POSTGRES_POOL_MAX_USES=1` only retires clients in the fallback
pool used by Durable Object timers. Request pools reuse clients until the
request ends. The migration login connects directly from the deploy host and
is never bound to the Worker. The Worker carries an `aws:us-east-1` placement
hint.

## Blobs

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Request body on the unauthenticated surface (`/`, `/auth/*`, `/billing/*`) | 2 MiB (`MAX_UNAUTHENTICATED_REQUEST_BYTES`, [`packages/api/src/worker/requestBody.ts`](../packages/api/src/worker/requestBody.ts)) | The Worker entry, before any route runs; every session route keeps the ceiling below, since container rotations and document payloads legitimately carry megabytes of keyrings and baselines. | Refusal. Bounds what a client without a session can make the isolate buffer or parse. |
| Request memory per isolate | 96 MiB across concurrent requests (`BODY_ADMISSION_BYTES`, [`packages/api/src/worker/bodyAdmission.ts`](../packages/api/src/worker/bodyAdmission.ts)) | Before reading a body or opening a database pool, the Worker reserves the declared length (or route ceiling when undeclared), plus a 48 MiB response page only for document sync POSTs. Syncs run one at a time per isolate. Reservations last through route/response cleanup; preflights reserve no sync page. | Wait in a queue of at most 32 requests for up to 30 seconds, then return 503 (`Server busy, please retry`) with `Retry-After: 1`. Requests of at most 2 MiB can use spare capacity ahead of queued syncs. |
| Request body and multipart part | 32 MiB (`MAX_MULTIPART_BLOB_PART_BYTES`, `MAX_UPLOAD_PART_BYTES`) | Signed upload authorization and the client enforce the part ceiling. S3/R2 receive parts directly; the bound keeps client hashing and native bridges bounded. The Worker and Bun listener also cap API request bodies; non-signing stores buffer parts there. | Refusal. This is the route ceiling every other request-size limit sits under. |
| Chunk size | 5 MiB, fixed (`BLOB_CHUNK_SIZE_BYTES`, `crypto/src/blobEnvelopeV2.ts`) | Crypto envelope format. | Not a tunable. |
| Chunks per blob | 10,000 (`MAX_BLOB_CHUNK_COUNT`), so a blob is at most about 48.8 GiB | Crypto envelope parser; SDK `workflows/blobs/upload/multipartUpload.ts` refuses before uploading. | Refusal. |
| Envelope header | 64 KiB (`MAX_BLOB_ENVELOPE_HEADER_BYTES`, `crypto/src/blobEnvelopeReader.ts`) | Crypto reader, before parsing. | Refusal. |

## Realtime

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| WebSocket client message | 1,000,000 bytes (`MAX_WS_CLIENT_MESSAGE_BYTES`, `validators/src/realtime/wsClientDeclarations.ts`) | Transport payload bound and a pre-parse length check. | Refusal before JSON parsing. |
| Pending frames per socket | 32 frames or 4,000,000 bytes (`DEFAULT_SOCKET_QUEUE_LIMITS`, [`packages/api/src/worker/socketQueue.ts`](../packages/api/src/worker/socketQueue.ts)) | The realtime hub queues each socket's frames behind its authorization. | The socket closes with 1013 and its queue is discarded. |
| Pending bytes per hub | 32 MiB across every socket (`HUB_QUEUE_BUDGET_BYTES`, [`packages/api/src/worker/hubConnections.ts`](../packages/api/src/worker/hubConnections.ts)) | The hub's shared queue budget, so many flooding sockets cannot exhaust its isolate. | The socket that would overrun the budget closes with 1013; the others continue. |
| Sockets per session | 8 (`MAX_SOCKETS_PER_SESSION`) | The hub counts open sockets per session at upgrade. | Refusal with 429 until one closes. |
| Interest container ids per declaration | 10,000 (`MAX_WS_INTEREST_CONTAINER_IDS`) | Validators. | Refusal. Interest is an invalidation subscription, not an authorization grant. |

## Principals

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Principal state version | Positive exact JavaScript integer, through `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991) | Request/response validators; crypto `principalState.ts`; PostgreSQL `bigint` and SQLite `INTEGER`, with range checks on state/head projection columns. | Representation/overflow refusal only; there is no lifetime history budget. Cold verification walks the complete chain. |
| Principal key epoch | Positive exact JavaScript integer through `Number.MAX_SAFE_INTEGER`; genesis 1, rotation advances exactly one | Crypto, wire schemas, SDK records, and range-checked PostgreSQL `bigint` / SQLite `INTEGER` columns for states, epoch keys, member envelopes, verified progress and manifest heads. | Invalid epochs and jumps are refused before commit; unchanged keys retain their epoch. |
| Principal crypto history page | 128 entries, 128 signer keys, 129 external-authority states; 128 retained reference requests per verifier (`PRINCIPAL_HISTORY_PAGE_ENTRY_LIMIT`, `crypto/src/keying/principalPolicyHistoryTypes.ts`) | `principalPolicyHistoryPage.ts`, `principalPolicyHistoryChecks.ts` | Split work across pages/verifiers. This component does not bound individual projection bytes; see [the verifier contract](principal-history-pages.md). |
| Principal GET history page | 32 historical entries (`PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT`) plus the pinned head's current artifacts | Response validators and API `principalPolicyPage.ts`. | Continue with the same head hash and returned cursor. This bounds history depth per response, not projection bytes or total SDK memory; see [the transport contract](principal-history-transport.md). |

Cold verification still grows with total signed history, across resumable
requests. Preparation runs outside the final mutation transaction; each final
commit rechecks current authorization and exact heads. The
[HTTP acceptance evidence](principal-history-acceptance.md) exercises revocation
and cold historical decryption through version 16,385 with a 15-second deadline
per response, on SQLite and networked PostgreSQL. Those fixed-cardinality tests
do not bound arbitrary policy size or aggregate load across API replicas.

## Limits that trade write liveness

The no-bricked-device invariant says no device may be unable to read or write
because another device must write first. Reads are never affected by any limit
above: a reader resolves a retired parent pin through retained history. The
following exceptions can leave a writer waiting on another authorized member:

- **Carried descendant rekeys past 64.** Levels beyond the parent-first prefix
  stay stale after the rotation commits. A writer granted only below such a
  level cannot re-key it and must not be handed its key, so it parks under
  `document_ancestor_repair_inaccessible` until a member with access at that
  level writes there.
- **Documents linked across access boundaries.** A writer through one link
  cannot always repair a stale content-key bundle after another link rotates.
  Repair needs every target's current wrapping key and may require write access
  at a stale level. The writer waits under
  `document_ancestor_repair_inaccessible` for an authorized member to repair
  it; if no remaining member spans the required targets, writes stay blocked.
  The trade avoids exposing inaccessible folders' grant lists.
  Ordinary writes need only one writable link while the bundle is current.

For the single-path case within the carried-rekey bound, the model in
[InaccessibleIntermediateRepair.md](../formal/container-keying/InaccessibleIntermediateRepair.md)
proves the writer is eventually unblocked with fairness only on its own step.
Outside it, that model's `rotation-without-descendant-repairs-bricks-leaf-writer`
control is the exact behaviour, and it violates the liveness property by
design. Nothing schedules the lazy repair; whichever capable member writes
beneath the stale level first performs it. See
[NoBrickedDevice.md](../formal/container-keying/NoBrickedDevice.md) for the
invariant and [client-sdk.md](./developer/client-sdk.md#public-api-entry-points)
for how the SDK reports the parked state.
