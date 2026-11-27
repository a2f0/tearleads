# Sync Interruption Safety

Multi-request [document](./glossary/content.md#document),
[container](./glossary/access.md#container), and attachment sync must survive request
failures, lost acknowledgements, local persistence failures, and retries. This
document lines up those [client workflows](./client-sync-ordering.md) with the
server's commit boundaries and names the regression tests that enforce each
guarantee. It covers only the flows listed here; it does not prove every
application workflow interruption-safe.

## Guarantees

### Stage cleanup never deletes promoted attachment bytes

An [attachment bind](./glossary/content.md#attachment-binding) promotes a
[multipart stage](./glossary/content.md#blob-stage) into a
[blob](./glossary/content.md#blob) in a database transaction. Promotion locks
the stage before checking its expiry and holds that lock through commit. Expiry
cleanup first updates each candidate to a durable expired state, which
serializes with that lock and returns no stage if promotion already consumed it;
only then does cleanup touch object storage. Object-store I/O happens after the
cleanup update commits, and a failed cleanup leaves an expired row for a later
sweep. Without this ordering, a cleanup that read a stage mid-promotion could
delete bytes the bind then committed as a live attachment, and no retry could
reconstruct them from the committed metadata.

The PostgreSQL regressions pause a real promotion both after its active-stage
read and after its database writes, and verify that cleanup cannot delete the
promoted bytes.

### Upload identity is durable before it is used

The client saves a new upload identity or resolved stage first and publishes it
in memory only after persistence succeeds and the store generation is still
current. A failed save therefore cannot leave a matching in-memory value that
makes the next attempt skip persistence and upload without the durable identity
needed to recover after a restart. Regression tests inject failures into both
the initial identity save and the later stage save, then verify that retries
persist the required state.

### A lost bind acknowledgement cannot strand an upload

A bind consumes its stage and permanently reserves its blob id. Normal recovery
adopts the matching active binding. If another device detaches or replaces that
binding first, it no longer appears in the
[active-slot](./glossary/content.md#attachment-slot) listing, and the server
rejects the old blob id as already used, even after
[garbage collection](./loro-e2ee-sync-protocol.md#orphan-blob-detection).

After a definitive stage absence or expiry, the document owner therefore reads
bindings afresh, evicting the API client's cached listing. A matching active
slot retains the identity for normal adoption; an unavailable listing retains
all retry state. An absent or replaced slot causes a durable identity
replacement and a new pass with fresh encryption material and a fresh blob id;
the replacement is persisted before upload. Tests cover the additional lookup
failing, the original binding still being active, the binding being removed,
and resuming from the resulting persisted state.

### Staged rotation baselines resume from the acknowledged index across restarts

When a document's [rotation baseline](./glossary/keys.md#rotation-baseline) does
not fit one request, the client persists the upload's stage id, fresh content
key, wrapped target set, and signed link-set event in
`document_staged_baseline_uploads` before calling `POST /baseline-stages`, and
persists each staged segment's hash record before its `PUT /segments/{index}`
request. A failed durable write stops the upload before the server opens an
untracked stage.

After a process restart, the next heal or unlink hydrates the persisted row,
reads the server stage (`GET`), slices its records to the server-acknowledged
`nextSegmentIndex`, confirms every acknowledged segment's digest and plaintext
hash against the re-proven local history, and continues staging from
`nextSegmentIndex` without reopening or re-uploading earlier segments. The
persisted target set keeps the exact target-set key-reuse fence intact across
restarts. If the server expired or dropped the stage while the process was down,
or if the persisted row is corrupt, the row is deleted and a fresh stage opens.
Document deletion, rebind, and local-edit discard remove the persisted row in
the same transaction.

## Other recovery boundaries

| Flow | Recovery mechanism and practical limit |
| --- | --- |
| Document creation followed by content upload | Stable document ids allow adoption after a coded create conflict. The client verifies the expected organization and container before adoption; pending content remains available for later submission. |
| Document update submission and paginated pulls | Server updates are transactional and update ids are checked against accepted content. Client continuation checkpoints are validated; failed pages do not authorize discarding deferred writes. |
| Content-key rotation and sync | Inline rekeys and their outgoing updates commit together. Lost-response recovery refreshes the writer projection, and durable local history supplies rotation baselines. A baseline staged across requests persists its stage id, key, target set, and segment records in local SQLite (`document_staged_baseline_uploads`) before each server request: an interrupted, refused, or restarted attempt reads the stage, confirms every acknowledged segment against the re-proven history, and resumes from the server-acknowledged index, and nothing staged is served until the rotating request commits it. If the stage expired or vanished while the process was down, the next attempt deletes the local row and opens a new stage. Conflicting recovery has a bounded retry budget. |
| Document move via link then unlink | The destination is linked before source links are removed. The durable move intent survives partial success and retries unfinished legs. During an outage the document can remain linked in both places. This is recoverable, but the whole move is not atomic. |
| Attachment staging, part upload, completion, and binding | Upload ids and crypto material survive retry. Ambiguous status failures retain the existing stage. Server completion can recover an assembled object whose completion-row update failed, after revalidating its bytes. |
| Attachment detach | The durable local detach marker remains until remote detach succeeds or a successful listing shows no active binding. |
| Remote document deletion | A coded missing-document response is only a discovery signal. Verified purge proof and local teardown commit together; an unavailable proof leaves local data intact. |

Retries are event-driven: reconnect, startup, further changes, or manual sync.
Permission failures and exhausted conflict-recovery budgets can remain
[parked](./sync-edge-cases.md#queue-statuses) until their recovery signal or a
manual retry. Preserved work does not imply continuous automatic retries during
an outage.

## Regression tests

- [`packages/api/src/services/blobs/multipartStageCleanup.pg.test.ts`](../packages/api/src/services/blobs/multipartStageCleanup.pg.test.ts)
- [`packages/api-client/src/ApiClient.attachmentRefresh.test.ts`](../packages/api-client/src/ApiClient.attachmentRefresh.test.ts)
- [`packages/client-sdk/src/stores/documents/documentStore/attachmentUpload/attachmentUploadResume.test.ts`](../packages/client-sdk/src/stores/documents/documentStore/attachmentUpload/attachmentUploadResume.test.ts)
- [`packages/client-sdk/src/stores/documents/documentStore/attachmentUpload/attachmentUploadStageRecovery.test.ts`](../packages/client-sdk/src/stores/documents/documentStore/attachmentUpload/attachmentUploadStageRecovery.test.ts)
- [`packages/client-sdk/src/workflows/documents/sync/syncStagedBaselineResume.test.ts`](../packages/client-sdk/src/workflows/documents/sync/syncStagedBaselineResume.test.ts)
- [`packages/client-sdk/src/workflows/blobs/upload/multipartUpload.failureCodes.test.ts`](../packages/client-sdk/src/workflows/blobs/upload/multipartUpload.failureCodes.test.ts)

The PostgreSQL cleanup tests run in `bun run test:postgres-concurrency`.
