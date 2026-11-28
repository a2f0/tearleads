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
| Sync request body | 16 MiB (`MAX_DOCUMENT_SYNC_REQUEST_BYTES`, [`validators/src/util/documentSyncLimits.ts`](../packages/validators/src/util/documentSyncLimits.ts)) | SDK applies the exact serialized-byte ceiling after encryption and trims the batch; the Worker entry bounds the stream at this ceiling before the route buffers it; API rejects. | Pagination for a batch. A single update that cannot fit is never sent: one edit of more than about 12 MiB of plaintext (16 MiB once base64) stays queued with `document_sync_request_too_large` until its user discards it, and a document whose first write is that large is created empty. A heal's rotation baseline that cannot fit is [staged](./rotation-baseline-writer.md) and never abandons for its size. |
| Outgoing updates per request | 64 (`MAX_DOCUMENT_SYNC_OUTGOING_UPDATES`) | SDK: [`data/documents/shared/sync/documentSyncOutgoingBatch.ts`](../packages/client-sdk/src/data/documents/shared/sync/documentSyncOutgoingBatch.ts). | Pagination. |
| Rotation baseline segments in one request | 64 (`MAX_DOCUMENT_BASELINE_SEGMENTS`), and payloads of 16 MiB in all for the SDK to send a group whole | Validators; SDK: `writeRotationBaseline`. | The SDK [stages](./rotation-baseline-writer.md) the baseline: every segment but the final one is uploaded ahead, and the rotating request carries the final one. The API refuses a longer group sent whole. |
| One update, on any route that accepts one | 16 MiB serialized (`MAX_DOCUMENT_SYNC_REQUEST_BYTES`): a sync's whole request, a staged segment's whole request, and each inline segment of an unlink's `rotationBaseline`, weighed whole | Validators: `DocumentSyncOutgoingUpdateSchema` bounds each string of an update, and the link-set request weighs each inline segment ([`request/document.ts`](../packages/validators/src/request/document.ts)), since an unlink's own route takes 32 MiB. | Refusal (400). A response page's 32 MiB share for updates then holds any accepted update with its header and the fields it is served with. Without the bound an unlink could carry a segment near its route's 32 MiB, which with its header is over that share: it would be accepted and then refused on every pull (`Document update exceeds the pull page byte ceiling`). An update between the two sizes can be pulled; the bound keeps every update well inside a page. The SDK never sends one: it cuts a segment at 11 MiB of plaintext at most (`DEFAULT_HISTORY_SEGMENT_MAX_BYTES`, [`loro/src/historySegments.ts`](../packages/loro/src/historySegments.ts)), which is 14.67 MiB once base64 and leaves about 1.3 MiB for the segment's vectors and header, and it refuses a segment that is still over the bound once signed (`DocumentRotationBaselineLimitError`, [the writer's cap](./rotation-baseline-writer.md#cutting)). |
| Segments of a staged rotation baseline | 4,096, the final one included (`MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS`) | Validators bound a segment's index and count and the stage route's `segmentIndex`, so index 4,094 is the last one staged. A commit inserts one small update row per staged segment under the document head lock, which this bounds. SDK: the writer stops at the last index. | Refusal (400) from the API. The SDK deletes its stage and fails with `DocumentRotationBaselineLimitError`: a sync's heal ends in `document_sync_request_too_large`, and an unlink throws it. |
| Staged baseline segment request | 16 MiB (`MAX_DOCUMENT_BASELINE_SEGMENT_REQUEST_BYTES`, the sync request ceiling) | The Worker entry bounds the stream before the route buffers it; the stage route rejects. One staged segment is one update, so every committed segment fits a response page. | Refusal (413). The SDK cuts segments of about 4 MiB of plaintext and at most 11 MiB (`DEFAULT_HISTORY_SEGMENT_MAX_BYTES`), which fits once base64, sent whole or staged, whatever sizes its caller passes. One operation larger than that cannot be carried: `document_sync_request_too_large`. A segment over 16 MiB once signed is not sent, and its stage is deleted. |
| Re-signed staged write header request | 512 KiB (`MAX_DOCUMENT_BASELINE_SEGMENT_HEADER_REQUEST_BYTES`) | The Worker entry bounds the stream before the route buffers it; the route rejects. The largest header the parser admits is about 430 KiB. | Refusal (413). |
| Write header size | A document header cites at most 6,400 container manifests (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS`); any header names its device in at most 128 characters (`MAX_WRITE_HEADER_WRITER_DEVICE_ID_LENGTH`), well-formed Unicode with no control character, and carries its signature in canonical base64 | Crypto: [`crypto/src/keying/writeHeader/writeHeaderCitations.ts`](../packages/crypto/src/keying/writeHeader/writeHeaderCitations.ts), [`crypto/src/keying/core/signedName.ts`](../packages/crypto/src/keying/core/signedName.ts), and the verifier, wherever a header is signed or verified: an ordinary write, a staged segment, a re-signed header. Its other fields are fixed-size or must match the document. Control characters and lone surrogates are refused because a header is stored as it was signed and Postgres takes neither U+0000 nor lone surrogates in `jsonb`. A blob header's citations are bounded by its own request. | Refusal (400; 403 for the signature). A committed header is then at most about 430 KiB, so a staged segment with its header, re-signed or not, serializes to under 17 MiB and fits a response page's 32 MiB update share. |
| Access event names | An event's `eventId` and `signerDeviceId` are each at most 128 characters (`MAX_ACCESS_EVENT_NAME_LENGTH`), well-formed Unicode with no control character | Crypto: [`crypto/src/keying/core/signedName.ts`](../packages/crypto/src/keying/core/signedName.ts), wherever an access event is signed or verified. They are the two strings of an event header its signer chooses freely; an event is stored as it was signed, and Postgres takes neither U+0000 nor lone surrogates in `text`. An event's body is not bounded here. | Refusal (400). |
| Bytes one baseline stage stores | 1 GiB (`MAX_DOCUMENT_BASELINE_STAGE_BYTES`), counting each staged segment's ciphertext, signed vectors, plaintext hash, and write header | API: `assertSegmentFitsStage` in [`stagedSegmentRows.ts`](../packages/api/src/workflows/documents/baselineStages/stagedSegmentRows.ts), before a segment is stored, against the stage row's running count (`stagedBytes` in its status). A re-signed header moves the count by the difference between the two headers, under the same check ([`resignSegmentHeader.ts`](../packages/api/src/workflows/documents/baselineStages/resignSegmentHeader.ts)). | 409 `document_baseline_stage_too_large`; the stage is unchanged. A history past it cannot be staged whole: the SDK deletes its stage and fails with `DocumentRotationBaselineLimitError`, as for the segment count. At the SDK's 4 MiB segments this bound, about 190 segments of history, is reached long before 4,096 segments. |
| Span rows one baseline stage stores | 1,048,576 (`MAX_DOCUMENT_BASELINE_STAGE_SPANS`), one for each peer a segment carries | API: the same check. A commit copies a stage's span rows, and writes at most as many peer-owner rows, under the document head lock, so this bounds them whatever the ciphertext's size. Committing a stage of 1,000,002 spans held that lock for 9.0 s on the in-memory test database (PGlite), about a second per 100,000 spans; it is not measured on Postgres. A baseline sent whole in one 16 MiB request can declare about 3.3 million spans under the same lock, so the staged bound is not the larger exposure, and it is not lowered: every peer of a history costs at least one span, so a bound of 100,000, which would hold the lock near a second here, would refuse any history of more peers. | 409 `document_baseline_stage_too_large`; the stage is unchanged. |
| What a commit of a stage reads before it writes | None of the stage's rows written; the stage's spans aggregated per peer and joined with the document's peer owners | API: every check that can refuse runs before the promotion's writes. The request's own write headers are stored first, as each update is verified, and roll back with a refusal. `assertStagedBaselinePromotable` ([`stagedBaselinePromotion.ts`](../packages/api/src/workflows/documents/mutations/stagedBaselinePromotion.ts)) reads nothing for a stage with no span. Otherwise it aggregates the stage's spans to one row per peer in a materialized CTE, joins that with the document's peer owners less the peers a committed span already reaches in a second materialized CTE, and then applies `order by ... limit 64`; `claimDocumentPeers` then judges the request's own updates against the frontier and owners the stage will leave. A segment that extends another user's peer is also refused when it is staged (`document_baseline_stage_segment_invalid`); that read holds no document lock, so the commit's decides. A refused commit keeps its stage and can be sent again until the stage expires, and the same reads run ahead of every accepted commit, under the document head lock: this is what a writer can make the server repeat. | The cost grows with the stage's spans, with the staged peers other users own, and with the peers refused before the limit — never with spans times peers. On Postgres 17 with fresh table statistics, a refused commit took 29–37 ms with 400,000 foreign-owned peers and a small stage (132–310 ms without `ANALYZE`), 110–190 ms with 400,000 staged spans across 100 foreign-owned peers (511–717 ms without `ANALYZE`), 228–241 ms with 400,000 own/unowned staged peers, 357–417 ms re-asserting 400,000 distinct foreign-owned peers (3.5 s warm or 6.7–10.4 s cold without `ANALYZE`), 396–478 ms on 400,000 disjoint unowned × 400,000 foreign peers, and 1.3–1.8 s when the stage extends all 400,000 foreign peers. Earlier forms cost more: an unaggregated join took 2.1–2.8 s on 100 foreign peers × 4,000 spans each, a per-foreign-peer lookup took about 2 s even for an empty stage, and refusing a final segment or trailing update after the promotion's writes took 7–10 s to roll back. A coverage refusal reads the peers of the committed frontier and keeps the stage for a tail segment. Refusals later in the request's transaction than the insert of its updates are not measured. |
| Open baseline stages per user and document | 1 (the unique index `document_baseline_stages_owner_idx`) | API: [`documents/baselineStages/`](../packages/api/src/workflows/documents/baselineStages/) deletes the caller's earlier stage, and what it staged, when another opens. Replacing a live stage on this document happens in the same transaction as storing the new one, under the document's lifecycle lock, so a refused open keeps the stage it would have replaced; a purge of this document or another user's open here waits for that delete. | Replacement, never a refusal. Two devices of one user that stage the same document replace each other's stage: the one replaced finds its stage gone and uploads again. |
| Open baseline stages per user | 4 across documents (`MAX_OPEN_DOCUMENT_BASELINE_STAGES_PER_USER`) | API: `openDocumentBaselineStage` ([`openStage.ts`](../packages/api/src/workflows/documents/baselineStages/openStage.ts)) runs as two transactions. The first refuses a caller who cannot write the document and deletes the caller's expired stages on this document and every other, skipping any another request holds; it waits for nothing and commits before any lock is asked for, so an expired stage of a gigabyte is not deleted under a lifecycle lock. The second takes a per-user lock, which only that user's opens take, then the document's lifecycle lock, and checks access again, so the access check runs twice an open. Under those it counts the caller's stage rows on other documents without locking them. Every row counts, an expired one a request held and one that a commit, an abandon, or the sweep is deleting included, so an open at the cap may be refused a moment early and is never admitted late; only an open adds a stage, so the count is exact. An open holds no stage row while it waits and waits for no lock under the lifecycle lock, so it closes no cycle of waits and holds up no other document's writers. The first access check does not wait for a create: an open on a document whose create has not committed is answered 409 `Document not found` at once. | 409 `document_baseline_stage_limit_reached`, naming the still-open stages as `openStages` (an expired one held by another request still counts toward the cap and is omitted from the list); the writer abandons one or waits for one to commit or expire. The SDK abandons the one listed stage it is not uploading itself that has been idle longest, if that is ten minutes or more (`ORPHANED_STAGE_IDLE_MS`, read from its expiry; a stage a restarted process left), opens again once, and otherwise fails with `DocumentRotationBaselineStageLimitError` and does not retry ([orphaned stages](./rotation-baseline-writer.md#orphaned-stages)). An open whose own stage on the document another of its requests holds is not made to wait: 503 with `Retry-After: 1` (`DOCUMENT_BASELINE_STAGE_BUSY_RETRY_AFTER_SECONDS`), nothing changed. Only the open's busy refusal carries `Retry-After`; a 503 for an aborted transaction carries none. It takes no place in a queue for the row, so an open sent again while the writer keeps staging to that stage can be refused every time (80 of 80 against one re-sign loop): a writer ends its own requests to the stage before it opens again. |
| Reads of a stage in one run of its upload | 3 (`MAX_STAGE_READS_PER_RUN`, [`stagedBaselineState.ts`](../packages/client-sdk/src/workflows/documents/baselineStage/stagedBaselineState.ts)) | SDK: the upload machine counts each read a run makes: one when it resumes, and one each time the API refuses a segment as not the stage's next. | The run gives the upload up (`stage_unsettled`), deletes the stage, and fails; a sync records the failure. A stage that is never where its own answers put it would otherwise keep one run reading, confirming, and sending without end. |
| Baseline stage lifetime | One hour after its last staged segment or re-signed header (`DOCUMENT_BASELINE_STAGE_IDLE_SECONDS`), and 24 hours after it opened at most (`DOCUMENT_BASELINE_STAGE_MAX_SECONDS`) | API: `judgeDocumentBaselineStage` on every stage request and commit; the hourly maintenance run deletes expired stages. Only a request that passes the access and billing checks of a document write moves the expiry. | 409 `document_baseline_stage_expired`, or that code beside `document_sync_baseline_group_invalid` on a commit; the writer opens a new stage. |
| Expired stages deleted per maintenance run | Every one, in batches of 100, until 10,000 stages (`MAX_EXPIRED_STAGES_PER_SWEEP`) or five minutes (`EXPIRED_STAGE_SWEEP_BUDGET_MS`, [`cleanupExpiredStages.ts`](../packages/api/src/workflows/documents/baselineStages/cleanupExpiredStages.ts)) | API: `cleanupExpiredDocumentBaselineStages`, oldest expiry first, one transaction per stage, after the hour's blob garbage collection. The clock is read before every stage, so a run overruns its time by one stage's delete at most, and a stage whose delete fails is counted once and stepped past. | The run stops, reports the expired stages it left as `remaining`, and logs a warning; the next hourly run continues. An expired stage holds its bytes until a run reaches it and can do nothing else. |
| Sealed baselines searched for a whole one | 4 (`MAX_LATEST_BASELINE_GROUP_CANDIDATES`, [`api/src/documents/documentStoredBaselineGroup.ts`](../packages/api/src/documents/documentStoredBaselineGroup.ts)) | API: the baseline redirect looks at the newest sealed groups at the current epoch for one whose rows are still whole. | No redirect: the pull serves every missing update. Only a group that lost a row after it committed is passed over. |
| Unapplied spans a pull carries for one rotation baseline | 8,192, one a peer (`MAX_UNAPPLIED_BASELINE_SPANS`, [`baselineGroupUnapplied.ts`](../packages/client-sdk/src/data/documents/shared/sync/baselineGroupUnapplied.ts)) | SDK: `settleBaselineGroupVerdicts` when a page adds to the run, and `deserializeDocumentSyncPullContinuation` when a stored run is read. The run is held in memory and stored with the pull's continuation. | The run stops listing spans and carries every operation of the group as unapplied (`EVERY_OPERATION_UNAPPLIED`): the pass goes on, and a later segment of that group that cannot join the reader's history is void. It does not fail the pass. The API bounds a segment's spans only by its stage's total, so a writing member can commit a group whose void segments name more peers than this, and a failure would stop every reader of the document for good. Only void segments are unapplied, so a group its writer did not break never reaches it. A stored run of more spans than the bound is not read, and its pull starts over. |
| Spans read to weigh a stored baseline | Every span of the latest whole group: up to 1,048,576 for a staged one, plus its final segment's | API: `readStoredBaselineGroupCoverage` ([`api/src/documents/documentStoredBaselineGroup.ts`](../packages/api/src/documents/documentStoredBaselineGroup.ts)), one aggregate a peer with no sort, on a cold first page that starts before the group and on a pull that holds an update of an older epoch. It took 0.43 s for 1,050,000 spans of 50,000 peers on the in-memory test database (1.08 s with the window sort it replaced), and returns one row a peer. | None: the cost follows the group's spans, which the stage bound caps. The coverage is not stored. |
| Merged queued update size | 8 MiB of base64 `updateData` (`QUEUED_UPDATE_MERGE_MAX_DATA_CHARACTERS`, half of `MAX_DOCUMENT_SYNC_REQUEST_BYTES`) | SDK: [`stores/documents/documentStore/sync/syncQueueMergePlan.ts`](../packages/client-sdk/src/stores/documents/documentStore/sync/syncQueueMergePlan.ts) plans within it and [`syncQueueMerge.ts`](../packages/client-sdk/src/stores/documents/documentStore/sync/syncQueueMerge.ts) rechecks the exported blob. | The run is cut there; rows past the cap start a new merge or go out unmerged. A merged update always fits a request. |
| Queued rows inspected for merging per sync pass | 256 (`QUEUED_UPDATE_MERGE_MAX_ROWS_PER_PASS`) | SDK: [`stores/documents/documentStore/sync/syncQueueMergePlan.ts`](../packages/client-sdk/src/stores/documents/documentStore/sync/syncQueueMergePlan.ts) proves and plans only the first 256 queued rows (the front of the queue, sent first), whether or not they merge, so this bounds the proofs and export done while the SQL lock is held. | Rows past the bound are sent unmerged; a later pass inspects whatever is still queued. |
| Authorization paths per request | 64 (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS`), each at most 100 deep, so 6,400 path refs (`MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS`) | Validators; derived from the structural limits so every valid link set stays syncable after later moves deepen its paths. | Refusal. |
| Content-key targets per document | 64 (`MAX_DOCUMENT_SYNC_CONTENT_KEY_TARGETS`) | API create and link validation; SDK link preflight in [`workflows/documents/linkSet/`](../packages/client-sdk/src/workflows/documents/linkSet/). | Refusal at link time, so no document can be created that does not fit the sync contract. |
| Response page | 48 MiB (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_BYTES`), of which 16 MiB is envelope (`MAX_DOCUMENT_SYNC_RESPONSE_ENVELOPE_BYTES`) | API. Sized so the page and its serialized copy both fit the 128 MB Workers isolate. A page is sized from stored byte lengths before it loads, so it holds at most the 32 MiB update share plus 64 entries' fixed-size fields. | Pagination. |
| Updates per response page | 64 (`MAX_DOCUMENT_SYNC_RESPONSE_PAGE_UPDATES`); a request's `maxPageUpdates`, 1 to 64, lowers it but never raises it | Validators bound `maxPageUpdates`; API: [`workflows/documents/mutations/syncResponseUpdates.ts`](../packages/api/src/workflows/documents/mutations/syncResponseUpdates.ts) serves the smaller. The SDK asks for 1 while it [isolates](#loro-runtime) updates a death left unattributed. | Pagination via the pull cursor. |
| Pull cursor length | 512 (`MAX_DOCUMENT_SYNC_PULL_CURSOR_LENGTH`) | Validators. | Refusal. |
| Refused peers named per refusal | 64 (`MAX_DOCUMENT_PEER_FRONTIERS`, [`validators/src/response/documentSyncError.ts`](../packages/validators/src/response/documentSyncError.ts)) in the `peerFrontiers` of a 409 `document_sync_peer_owned` or `document_sync_dependency_uncommitted` | API: `judgeDocumentPeerSpans` in [`validators/src/documentPeerSpans.ts`](../packages/validators/src/documentPeerSpans.ts), called from [`documents/documentPeerOwners.ts`](../packages/api/src/documents/documentPeerOwners.ts), names the first 64 refused peers in canonical order, each with the frontier committed before the request; the response schema bounds the list. | Pagination. The client [recovers](./peer-ownership.md#rebasing-onto-a-fresh-peer) on the named peers, by a rebase onto a fresh peer or a relay, and its retry draws a refusal naming the rest. |
| Span and peer-owner rows per insert statement | 8,192 (`DOCUMENT_PEER_ROWS_PER_INSERT`, [`api/src/documents/documentPeerRowChunks.ts`](../packages/api/src/documents/documentPeerRowChunks.ts)) | API: [`documents/documentUpdateSpans.ts`](../packages/api/src/documents/documentUpdateSpans.ts) inserts one span row per peer of each new update's declared span, and [`documents/documentPeerOwners.ts`](../packages/api/src/documents/documentPeerOwners.ts) one owner row per peer the write claims, in statements of at most this many rows inside the write's transaction. Document sync and a link-set mutation's rotation baseline both write through them. Postgres binds at most 65,535 parameters to one statement, and a span row binds five. | More statements in the same transaction; nothing is refused, so a write's rows are bounded only by its request body. A rotation baseline has span rows for every peer in the document's history; a staged one inserts each segment's rows with its own stage request, and a commit moves them ([history bounds](#document-history-bounds)). |

**What a member can hold staged.** No storage quota counts staged bytes: the
organization data-usage report sums committed updates and blobs, and a
staged segment is neither until its stage commits. The bounds above are the
whole limit. A member who can write a document and holds a sync seat can
keep four stages open, so at most 4 GiB of staged rows and 4,194,304 staged
span rows at once, and an organization of *n* such members at most *n*
times that. Holding it costs the upload: a stage lives 24 hours at most, and
only while its writer stages or re-signs in it every hour, which the API
allows only while the member can still write the document and its
organization can sync. A member who loses either holds what it staged until
that stage's expiry, an hour at most, and then until the hourly sweep
reaches it. The sweep deletes every expired stage it finds, so the bytes
are held again only by uploading them again.

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
| Text write diff | 100 ms for the character diff, then 100 ms for the line diff (`TEXT_DIFF_BUDGET_MS`, [`loro/src/textUpdate.ts`](../packages/loro/src/textUpdate.ts)) | SDK: `updateText`, which the document store's text write calls. Both diffs run in one synchronous WebAssembly call and take time quadratic in how much of the text differs: unbounded, replacing a 64 KB note with unrelated text took 8 s. | Never a refusal. The write is expressed more coarsely: by the lines that differ, then by replacing the whole text. A concurrent edit then merges with less of its surroundings ([text writes](../packages/loro/README.md#text-writes)). |
| Rotation deaths per document | 3 under one judge with no completed rebuild between them (`MAX_ROTATION_DEATHS`, [`data/documents/shared/sync/rotationAvailabilityMachine.ts`](../packages/client-sdk/src/data/documents/shared/sync/rotationAvailabilityMachine.ts)), held equal to `MAX_LORO_RUNTIME_ATTEMPTS` | SDK: a death alone in a rotation's raw-history window, on a page the live document already covers, counts toward the device's rotation of the document, never toward an update (`loroWindows.ts`); the count persists in `document_rotation_availability`. | If the third death read one update alone, the next rebuild [leaves it out](./rotation-deaths.md#leaving-an-update-out); otherwise the device's rotation of the document is [unavailable](./rotation-deaths.md#unavailable-rotation). A rotation, unlink, or purge-unlink it starts is then refused with `DocumentRotationUnavailableError` and a queued move parks, leaving those writes to other members until a new judge starts the count over. Below the limit, a completed rebuild starts it over. |
| Updates left out of one document's rebuilds | 8 (`MAX_ROTATION_LEFT_OUT`) | SDK: `rotationAvailabilityMachine.ts`. | The next death that would leave one more out makes the device's rotation of the document unavailable instead, as above. Each update left out cost the device the deaths that found it, so a writer must spend eight crashing updates on a device before one more stops its rotations. |
| Updates in a history one device verifies | 20,000 (`MAX_VERIFIED_HISTORY_UPDATES`, [`workflows/documents/history/documentHistoryRawPull.ts`](../packages/client-sdk/src/workflows/documents/history/documentHistoryRawPull.ts)), held equal to the attribution reader's `MAX_RANGES` | SDK: `verifyDocumentHistory` reads the count the first raw page reports (`pullPage.throughUpdateCount`), and counts the updates it is served, so a server that understates the count is bounded too. | The verification ends `unavailable` with reason `too_large`, before it imports anything of that page. Nothing is recorded, and sync, editing, and rotation are unaffected. The number is not measured: it bounds the pages a viewer asks for, not the memory a rebuild needs. |
| Scratch rebuild budget per sync page | 32 MiB (`MAX_SCRATCH_REBUILD_BYTES`, [`data/documents/shared/sync/documentSyncImportVerdicts.ts`](../packages/client-sdk/src/data/documents/shared/sync/documentSyncImportVerdicts.ts)) | SDK: caps scratch-document rebuild bytes after a void import mutates the scratch doc on an ordinary sync page (rotations override with `Number.POSITIVE_INFINITY` in [`rotationRawHistoryJudge.ts`](../packages/client-sdk/src/stores/documents/documentStore/rotation/rotationRawHistoryJudge.ts)). | Remaining updates on the page are deferred to a later pull rather than rebuilt in the same pass. |

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
| Client SQLite transaction lease wait | 5 s | `TRANSACTION_LEASE_WAIT_MS` in [`transactionLeaseMachine.ts`](../packages/sqlite-worker/src/transactionLeaseMachine.ts); a statement waits while another tab's connection holds a transaction on the same database. | The statement is refused unrun with `DATABASE_TRANSACTION_BUSY_MESSAGE`; callers retry it. |
| Client SQLite transaction lease idle | 3 s | `TRANSACTION_LEASE_IDLE_MS` in the same file; counted from the later of the holder's last statement arriving and settling, and enforced once another connection's statement waits. | The holder's transaction is rolled back, at once if it was already idle that long, and its connection retired; its client fails as lost and the host reopens it. |

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
| Interest container ids per declaration | 256 (`MAX_WS_INTEREST_CONTAINER_IDS`) | Validators. | Refusal. Clients declare subtree roots only; interest is an invalidation subscription, not an authorization grant. |
| Installed interest roots per socket | 256 (`MAX_INSTALLED_CONTAINER_IDS`, [`packages/api/src/realtime/containerInterestAuthorization.ts`](../packages/api/src/realtime/containerInterestAuthorization.ts)) | Gateway authorizer across `replace` and `add` frames. | Excess roots are refused and omitted from `known_containers_ack`. |
| Pending container ids per socket | 512 (`MAX_PENDING_CONTAINER_IDS`, [`packages/api/src/realtime/containerInterestAuthorization.ts`](../packages/api/src/realtime/containerInterestAuthorization.ts)) | Gateway authorizer queue. | The socket closes with 1013 and pending work is discarded. |
| Path containers per authorization pass | 1,024 (`MAX_PATH_CONTAINERS_PER_AUTHORIZATION`, [`packages/api/src/realtime/containerInterestAccess.ts`](../packages/api/src/realtime/containerInterestAccess.ts)) | Gateway access pre-check on `SUM(depth + 1)` in declaration order, within a flat 10 s authorization deadline. | Excess roots are refused without loading their manifests. |

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
- **A heal from behind.** A device with queued writes and a stale
  [content-key bundle](./glossary/keys.md#content-key-bundle) heals by
  rotating, and its [rotation baseline](./glossary/keys.md#rotation-baseline)
  must cover the committed frontier. A device whose history is behind is
  refused with `document_sync_checkpoint_coverage_conflict` on every pass:
  the refused request serves nothing, and each pass plans the same heal.
  Its writes wait until another member rotates, or it discards local edits
  and pulls.
- **A baseline the server serves in part.** A reader fails the pass on a
  served rotation baseline that breaks a
  [group rule](./document-rotation-baselines.md#reader-checks), instead
  of voiding segments for good. A server or API fault that withholds or
  reorders a segment then blocks that device's pulls of the document until
  the server serves the group whole, and its queued writes with them. A
  pass that fails on its first page has already sent its writes: the server
  commits them and other members receive them, but the device settles
  nothing from a failed page and keeps them queued. Each later pass encrypts
  them again, so the API refuses the reused update ids with
  `document_sync_update_id_conflict`, and the pass's read-only
  [recovery pull](./sync-edge-cases.md#edge-cases) fails on the same page:
  two requests a pass, no second commit, and no spend of the recovery
  budget. Once the page is whole, that pull settles each write by its
  content. Past the first page a pull's continuation stands, and the device
  sends no writes while it does. No other member can clear either.
- **Rotation deaths past either limit.** A device whose rotation of a
  document is [unavailable](./rotation-deaths.md#unavailable-rotation) leaves
  that document's rotations, unlinks, moves, and purge-unlinks to other
  members: one it starts is refused, and a queued move it cannot prove parks,
  until a new judge (a decoder or void-rules change) starts the count over. It
  still opens, edits, and syncs the document, and no other device waits on it.
- **A peer a stale recreation claimed.** After a billing purge, the owner's
  recovery from a stale copy can leave the server with less of a
  [peer](./glossary/sync.md#peer-owner) than another device saw committed,
  and claim that peer for the owner. A device whose queue depends on the lost
  operations may not send them, because another user owns the peer, and must
  not write them again under a fresh peer: every device that still holds the
  originals would then hold both copies. It parks under
  `document_peer_restore_awaits_owner` until a device of the peer's owner
  republishes the peer, keeps the document readable and editable, and submits
  its queue again on every pass. Each of those requests is refused whole, so
  the device also receives no remote edits to the document while parked. If no
  such device holds the lost operations it stays parked until its user
  discards the local edits
  ([after a stale recreation](./peer-ownership.md#after-a-stale-recreation)).

For the single-path case within the carried-rekey bound, the model in
[InaccessibleIntermediateRepair.md](../formal/container-keying/InaccessibleIntermediateRepair.md)
proves the writer is eventually unblocked with fairness only on its own step.
Outside it, that model's `rotation-without-descendant-repairs-bricks-leaf-writer`
control is the exact behaviour, and it violates the liveness property by
design. Nothing schedules the lazy repair; whichever capable member writes
beneath the stale level first performs it. The stale-recreation park is
modeled in [PeerOwnership.md](../formal/document-sync/PeerOwnership.md), whose
liveness property excuses a device only while it awaits the owner of a peer
whose history fell. See
[NoBrickedDevice.md](../formal/container-keying/NoBrickedDevice.md) for the
invariant and [client-sdk.md](./developer/client-sdk/public-api.md#public-api-entry-points)
for how the SDK reports the parked state.

### Document history bounds

Nothing caps a document's history: its peers, or its content, which deleting
text does not shrink. A [rotation baseline](./glossary/keys.md#rotation-baseline)
carries all of it. One that fits a request is sent whole, and any other is
[staged](./rotation-baseline-writer.md) a segment a
request and committed by its final segment, so a history larger than one
request still rotates, unlinks, moves, and purge-unlinks
([#3238](https://github.com/a2f0/tearleads/issues/3238)). These bounds
remain:

- **1 GiB a stage, and 4,096 segments.** A stage stores at most 1 GiB,
  counting ciphertext, vectors, and headers, and 1,048,576 span rows. At the
  SDK's 4 MiB a segment that is about 750 MiB of history, far short of the
  4,096 segments a baseline may have, so bytes are the ceiling in practice.
  Past either the writer deletes its stage and fails with a named limit
  (`DocumentRotationBaselineLimitError`, `document_sync_request_too_large`
  on a heal), and the document cannot rotate, unlink, move, or purge-unlink
  until its history is smaller, which no operation makes it
  ([#3238](https://github.com/a2f0/tearleads/issues/3238)).
- **Four open stages a user.** A fifth document's upload is refused with
  `document_baseline_stage_limit_reached` until one commits, is abandoned,
  or expires. The SDK deletes every stage it gives up on, the one whose
  final segment's request cannot be made among them. It keeps a stage whose
  commit was sent and got no answer, or whose request met an outage, a
  throttle, or a timeout: the next run reads it. A stage a restarted
  process left behind holds its place until it expires, or until an upload
  that is refused for the limit finds it the longest idle, for ten minutes
  or more, and abandons it
  ([orphaned stages](./rotation-baseline-writer.md#orphaned-stages)). With
  four uploads under way the SDK reports the refusal and does not retry.
- **One operation.** A segment is cut between operations and holds at most
  11 MiB. One operation larger than that, a single map value or list
  element, cannot be carried, and ends in the same failure.
- **The final segment** shares the rotating request with what else that
  request carries. The writer cuts it to about 1 MiB; a request already
  near its ceiling still refuses it.
- **Stage lifetime.** A stage expires an hour after its last upload and 24
  hours after it opened. An upload slower than that starts over.
- **Memory.** The writer holds the full-history snapshot and one request's
  worth of segments, so a device must still hold the history once to rotate
  it.
- **A restart** drops the upload, which lives in memory: the next attempt
  uploads every segment again.
- **A writer faster than the rotator.** An unlink's baseline must cover
  every update committed when it commits. One committed while the last
  segment is in flight refuses the unlink; the rotator proves its history
  again, stages a tail behind what is uploaded, and commits again. Each
  round costs a pull and a request, not the upload, so a member who keeps
  writing in that window delays an unlink and cannot undo its upload. A
  heal cannot be raced this way: no ordinary write commits while the bundle
  is stale, and another member's heal ends the stage
  (`document_baseline_stage_epoch_stale`).
- **One stage a user and document.** Two devices of one user that rotate
  the same large document replace each other's stage and upload again.

A member can reach these with many peers or with content alone. Span and
owner rows are written in chunks, so a baseline's peer count alone does not
fail at the database
([#3230](https://github.com/a2f0/tearleads/issues/3230), item 3).
