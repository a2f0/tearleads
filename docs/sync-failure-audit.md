# Sync interruption audit

This review follows multi-request document, container, and attachment sync
through request failures, lost acknowledgements, local persistence failures,
and retries. It checks the client workflow against the corresponding server
commit boundaries. It is a bounded review of these flows, not a proof that
every workflow in the application is interruption-safe.

## Findings repaired

### Attachment cleanup could delete successfully committed bytes

An attachment bind promotes a multipart stage into a blob in a database
transaction. Expiry cleanup previously read stage candidates, deleted their
objects, then deleted their stage rows. Its candidate read could still see a
stage being promoted by an uncommitted transaction. Cleanup could therefore
delete the bytes while the bind subsequently committed a live attachment.
Retries could not reconstruct the server object from the committed metadata.

Promotion now locks the stage before checking its expiry and holds that lock
through commit. Cleanup first updates the candidate to a durable expired state,
which serializes with that lock and returns no stage if promotion already
consumed it. Only then may cleanup touch object storage. Network I/O occurs
after the cleanup update commits, and a failed cleanup leaves an expired row
available for another sweep.

The PostgreSQL regressions pause actual stage promotion both after its active
stage read and after its database writes. They verify that cleanup cannot
delete the promoted bytes. The original implementation failed the latter test
by deleting the object before the promotion transaction committed.

### Failed local saves could disable upload identity persistence on retry

The client published a new upload identity or resolved stage in memory before
saving it. If that save failed, the next attempt saw the matching in-memory
value and skipped persistence. An upload could then proceed without the durable
identity needed to recover after a restart.

The client now saves a candidate first and publishes it only after persistence
succeeds and the store generation is still current. Regression tests inject
failures into both the initial identity save and the later stage save, then
verify that retries actually persist the required state.

### A lost bind acknowledgement could permanently strand an upload

A bind consumes its stage and reserves its blob id. Normal recovery adopts the
matching active binding. However, if another device detaches or replaces that
binding before recovery, it no longer appears in the active-slot listing.
Replacing only the missing stage kept the old blob id, which the server rejects
as already used even after garbage collection.

The document owner now freshly reads bindings after a definitive stage absence
or expiry, explicitly evicting the API client's cached list. A matching active
slot retains the identity for normal adoption; an unavailable listing retains
all retry state. An absent or replaced slot causes
a durable identity replacement and a new pass with fresh encryption material
and a fresh blob id. The replacement is persisted before upload. Tests cover the
additional lookup failing, the original binding still being active, the binding
being removed, and resuming from the resulting persisted state.

## Other recovery boundaries reviewed

| Flow | Recovery mechanism and practical limit |
| --- | --- |
| Document creation followed by content upload | Stable document ids allow adoption after a coded create conflict. The client verifies the expected organization and container before adoption; pending content remains available for later submission. |
| Document update submission and paginated pulls | Server updates are transactional and update ids are checked against accepted content. Client continuation checkpoints are validated; failed pages do not authorize discarding deferred writes. |
| Content-key rotation and sync | Inline rekeys and their outgoing updates commit together. Lost-response recovery refreshes the writer projection, and durable local history supplies rotation baselines. Conflicting recovery has a bounded retry budget. |
| Document move via link then unlink | The destination is linked before source links are removed. The durable move intent survives partial success and retries unfinished legs. During an outage the document can remain linked in both places. This is recoverable, but the whole move is not atomic. |
| Attachment staging, part upload, completion, and binding | Upload ids and crypto material survive retry. Ambiguous status failures retain the existing stage. Server completion can recover an assembled object whose completion-row update failed, after revalidating its bytes. |
| Attachment detach | The durable local detach marker remains until remote detach succeeds or a successful listing shows no active binding. |
| Remote document deletion | A coded missing-document response is only a discovery signal. Verified purge proof and local teardown commit together; an unavailable proof leaves local data intact. |

Retries are generally event-driven: reconnect, startup, further changes, or
manual sync. Permission failures and exhausted conflict-recovery budgets can
remain parked until their recovery signal or a manual retry. Preserved work
does not imply continuous automatic retries during an outage.

The implementation changes remain within the API, API Client, and Client SDK
ownership lanes and introduce no dependency between server and client implementation
code. No wire schema or public facade exports changed.

## Validation

The added regression tests live in:

- `packages/api/src/services/blobs/multipartStageCleanup.pg.test.ts`
- `packages/api-client/src/ApiClient.attachmentRefresh.test.ts`
- `packages/client-sdk/src/stores/documents/documentStore/attachmentUploadResume.test.ts`
- `packages/client-sdk/src/stores/documents/documentStore/attachmentUploadStageRecovery.test.ts`
- `packages/client-sdk/src/workflows/blobs/multipartUpload.failureCodes.test.ts`

The PostgreSQL cleanup tests are registered in `test:postgres-concurrency`.
Run `bun run check:affected` for repository preflight and affected suites.
