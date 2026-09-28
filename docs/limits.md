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
| Container path length | 100 containers, including root and leaf (`MAX_CONTAINER_PATH_LENGTH`); depths zero through 99 | API: create and subtree-move checks in `workflows/containers/mutations/shared/containerDepth.ts`, under the organization lock; the CTE in `access/shared/internal/containerKekTargets.ts` and writer/stored path loaders. SDK: create/move destination prechecks and `data/keyingProjectionVerification/documentDependencyPaths.ts`. | Refusal (409) before creating an unreadable path. A subtree move checks the deepest descendant, including descendants the caller cannot discover. |

Create and move preserve the reader's structural bound. Policy rotations and
revocations do not change structure and do not run these depth guards. The
bounded [container depth model](../formal/container-keying/ContainerDepth.md)
checks the create and move guards. Readers also refuse
malformed paths; the ancestor CTE accepts at most 100 containers and rejects
an unclosed parent at the boundary rather than silently truncating it.

## Container keying

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Carried descendant rekeys per rotation | 64 (`MAX_ROTATION_CONTAINER_REKEYS`, `validators/src/util/containerKekKeyringWire.ts`) | API: `workflows/containers/mutations/shared/grantedPathCurrency.ts` computes the stranded closure and owes only its parent-first prefix; the request schema rejects more. SDK: the proactive carry refuses before signing what the server would refuse. | Lazy remainder. The rotation commits; levels past the prefix stay stale and repair on their next capable write. A writer granted only below one parks with `document_ancestor_repair_inaccessible`. |
| Inline container rekeys per document or blob write | 16 (`MAX_INLINE_CONTAINER_REKEYS`) | Validators: `request/document.ts`, `request/blob.ts`. | Pagination. The sync pass commits the surplus as standalone rekeys before the write, within the per-pass budget below. |
| Ancestor repairs committed per sync pass | 100 (reuses `MAX_CONTAINER_PATH_LENGTH`) | SDK: `workflows/documents/syncContainerRekeyPreparation.ts`. | The pass abandons with the `depth-budget` trace reason; writes stay queued and the next pass continues. |
| Rekeys attempted per pending update row | 5 (`MAX_PENDING_UPDATE_REKEYS`) | SDK: `data/sqlite/documentPendingUpdatePersistence.ts`, persisted so it survives restarts. | The row is left untouched and reported as no progress, so a poisoned update cannot re-key forever. |
| Consecutive rekey-only sync passes | 3 (`MAX_CONSECUTIVE_REKEY_ONLY_PASSES`) | SDK: `data/sync/outgoingUpdateSettlement.ts`. | The lane goes idle; a later mutation or sync signal retries the pending work. Guards against a server that under-settles without conflicting. |
| Container key epoch | 65,536 (`MAX_CONTAINER_KEY_EPOCH`) | API at rotation time; response guards on every layer before cryptographic work. | Refusal of the rotation only. Never applied to existing data, so retained ciphertext stays readable. A runaway-rotation backstop, not a use case. |
| Container recitation epoch | 512 (`MAX_CONTAINER_RECITATION_EPOCH`, `crypto/src/keying/containerAccessReciteBody.ts`) | Crypto: `containerAccess.ts`; the SDK skips signing at the boundary and the API rejects independently. | Refusal. The ceiling is absolute and does not reset on rekey, reserving the history budgets below for ordinary mutations. |
| Same-epoch manifest history per container | 1,024 (`MAX_SAME_EPOCH_MANIFEST_HISTORY`, `api/src/access/shared/internal/containerKekTargets.ts`) | API: the SQL walk that validates key bindings on document and blob writes, with one overflow sentinel. | Refusal (409). Fails closed and requires a rekey, which starts a new same-epoch chain. |
| Manifest history per container | 4,096 (`MAX_CONTAINER_HISTORY_DEPTH`, `api/src/workflows/containers/writerProjection/storedManifestVerification.ts`) | API: stored manifest verification. | Refusal as an integrity error. |
| KEK-log page | 256 epochs (`CONTAINER_KEK_LOG_PAGE_LIMIT`) | API: `workflows/containers/kekLog.ts`. | Pagination. Recovery walks from the newest page backward, so page size, not lifetime rotation count, bounds a response. |

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
| Sync request body | 16 MiB (`MAX_DOCUMENT_SYNC_REQUEST_BYTES`, `validators/src/util/documentSyncLimits.ts`) | SDK applies the exact serialized-byte ceiling after encryption and trims the batch; API rejects. | Pagination for a batch. A single update that cannot fit abandons with `document_sync_request_too_large`. |
| Outgoing updates per request | 64 (`MAX_DOCUMENT_SYNC_OUTGOING_UPDATES`) | SDK: `data/sync/documentSyncOutgoingBatch.ts`. | Pagination. |
| Authorization paths per request | 64 (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS`), each at most 100 deep, so 6,400 path refs (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS`) | Validators; derived from the structural limits so every valid link set stays syncable after later moves deepen its paths. | Refusal. |
| Content-key targets per document | 64 (`MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS`) | API create and link validation; SDK link preflight in `workflows/documents/linkSet.ts`. | Refusal at link time, so no document can be created that does not fit the sync contract. |
| Response page | 128 MiB (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES`), of which 16 MiB is envelope (`MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES`) | API. Sized to carry the largest accepted atomic rotation baseline plus its signed metadata. | Pagination. |
| Updates per response page | 64 (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES`) | API. | Pagination via the pull cursor. |
| Pull cursor length | 512 (`MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH`) | Validators. | Refusal. |

## Blobs

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Request body and multipart part | 100 MiB (`MAX_MULTIPART_BLOB_PART_BYTES`, `MAX_UPLOAD_PART_BYTES`) | API `index.ts` sets it as the server-wide `maxRequestBodySize`; the object store enforces it again. | Refusal. This is the route ceiling every other request-size limit sits under. |
| Chunk size | 5 MiB, fixed (`BLOB_CHUNK_SIZE_BYTES`, `crypto/src/blobEnvelopeV2.ts`) | Crypto envelope format. | Not a tunable. |
| Chunks per blob | 10,000 (`MAX_BLOB_CHUNK_COUNT`), so a blob is at most about 48.8 GiB | Crypto envelope parser; SDK `workflows/blobs/multipartUpload.ts` refuses before uploading. | Refusal. |
| Envelope header | 64 KiB (`MAX_BLOB_ENVELOPE_HEADER_BYTES`, `crypto/src/blobEnvelopeReader.ts`) | Crypto reader, before parsing. | Refusal. |

## Realtime

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| WebSocket client message | 1,000,000 bytes (`MAX_WS_CLIENT_MESSAGE_BYTES`, `validators/src/realtime/wsClientDeclarations.ts`) | Transport payload bound and a pre-parse length check. | Refusal before JSON parsing. |
| Interest container ids per declaration | 10,000 (`MAX_WS_INTEREST_CONTAINER_IDS`) | Validators. | Refusal. Interest is an invalidation subscription, not an authorization grant. |

## Principals

| Limit | Value | Where enforced | Past the limit |
| --- | --- | --- | --- |
| Principal state version | 16,384 (`MAX_PRINCIPAL_STATE_VERSION`, `validators/src/util/principalStateWire.ts`) | Validators: `request/principal.ts`; crypto `principalState.ts`. | Refusal. |

## Limits that trade write liveness

The no-bricked-device invariant says no device may be unable to read or write
because another device must write first. Reads are never affected by any limit
above: a reader resolves a retired parent pin through retained history. The carried-rekey
limit can leave a writer waiting on another device's write so that a
revocation is never refused because of a tree's size:

- **Carried descendant rekeys past 64.** Levels beyond the parent-first prefix
  stay stale after the rotation commits. A writer granted only below such a
  level cannot re-key it and must not be handed its key, so it parks under
  `document_ancestor_repair_inaccessible` until a member with access at that
  level writes there.

Within the carried-rekey bound, the model in
[InaccessibleIntermediateRepair.md](../formal/container-keying/InaccessibleIntermediateRepair.md)
proves the writer is eventually unblocked with fairness only on its own step.
Outside it, that model's `rotation-without-descendant-repairs-bricks-leaf-writer`
control is the exact behaviour, and it violates the liveness property by
design. Nothing schedules the lazy repair; whichever capable member writes
beneath the stale level first performs it. See
[NoBrickedDevice.md](../formal/container-keying/NoBrickedDevice.md) for the
invariant and [client-sdk.md](./developer/client-sdk.md#public-api-entry-points)
for how the SDK reports the parked state.
