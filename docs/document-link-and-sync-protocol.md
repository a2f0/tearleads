# Document Link and Sync Protocol

Documents do not own direct ACLs. A document link-set manifest names the
containers that link to the document. Document create and link-set mutation
routes use signed document access events:

- `POST /documents`
- `POST /documents/:documentId/link`
- `POST /documents/:documentId/unlink`

`DocumentCreateRequest` and `DocumentLinkSetMutationRequest` carry:

- signed `event` and typed `body`
- `expectedManifestHash`
- derived document manifest state
- previous document manifest when applicable
- target and authorizing container path bundles
- optional `containerRekeys[]`
- a document content-key bundle

The API verifies the event, verifies container path heads, loads referenced
principal policies, derives the document link-set manifest, stores the manifest
head, and validates the submitted content-key bundle against derived document
KEK targets.

An unlink rotates the document content key and must carry a `rotationBaseline`
— a signed `rotate_baseline` full-history snapshot whose source version vector
covers the complete committed update frontier — with one exception: a document
with **no committed updates** may be unlinked without a baseline. The server
proves that emptiness inside the mutation transaction under the document
manifest-head write lock. Sync writers hold the corresponding exclusive lock,
so no update can commit between the emptiness proof and the unlink. A baseline-
less unlink against a non-empty committed frontier is rejected as a conflict.
A link must not carry a rotation baseline.

Encrypted Loro sync uses `POST /documents/{documentId}/sync`.
`DocumentSyncRequest` carries:

- `contentKeyEpoch`
- `expectedLinkSetManifestHash`
- `expectedTargetHash`
- optional `contentKeyBundle`
- optional `containerRekeys[]`
- optional `authorizingContainerPathRefs`, containing paths of
  `{containerId, manifestHash}` references that the server resolves from its own
  committed manifest store
- `localVersionVector`
- optional `minLsn`
- `supportsPullPagination: true`
- optional opaque `pullCursor`
- `outgoingUpdates[]`

Document sync updates carry encrypted bytes, partial version vectors, and a
signed write header. Checkpoint fields are either all absent or the tuple
`rotate_baseline`, `full_history_snapshot`, and a non-empty source vector.
Writes require path refs; the API requires an active path. Reads may omit refs
and carry no rekeys or bundle.
`expectedLinkSetManifestHash` pins the server-resolved document head instead of
echoing the full manifest.

For accepted writes, the API verifies:

- session user/fingerprint match the write header signer
- the document manifest and authorizing paths are active heads
- the caller has write access through at least one linked container path
- content-key targets match the active document KEK target hash
- the write header matches document id, organization id, manifest hash, target
  hash, content-key epoch, metadata hash, and ciphertext hash
- duplicate update ids are idempotent only when the encrypted content and write
  header match the already accepted update

The sync response returns accepted outgoing ids, a `commitLsn`, an optional
`commitLsnMode`, the active content-key bundle, a required array of any
additional returned epoch bundles, document KEK targets, encrypted updates
missing from the client-supplied frontier, and `pullPage`. `pullPage.hasMore`
and `pullPage.nextCursor` are consistent: a continuation is present exactly
when more updates remain in the frozen pull snapshot.

Every sync request must set `supportsPullPagination: true`, and every successful
response must carry `pullPage`; there is no legacy unbounded response mode. The
first paginated pull proves `minLsn` before freezing its upper update bound.
Update inserts and watermark capture serialize on the document manifest head,
so PostgreSQL identity allocation cannot place a later-committing lower sequence
behind the cursor. The opaque cursor binds the document id, content-key epoch,
link-set hash, target hash, last returned update, and the original upper bound.
A readable authenticated rotation baseline may move the initial lower bound
forward before page selection only after its source frontier proves that it
covers every update the client is missing before that baseline.
A continuation must opt into pagination, carry that cursor, and be read-only:
it has no outgoing updates, rekeys, key bundle, or authorizing paths. Every page
must retain the first page's key identity and commit-LSN mode, and its tracked
checkpoint must satisfy the prior page's `commitLsn`.

One response page contains at most 64 updates and 128 MiB including its key
envelope. Until durable cursor resumption is available, the SDK aggregates at
most two pages (and at most 64 updates) per submission, persists any verified
progress, retains the next cursor in the live document or metadata state, and
schedules another bounded pull when more remain. This live cursor prevents an
oversized local version vector from restarting at page one; PR3 persists it
across process restarts. Queued writes wait until the frozen read snapshot is
drained. A key-identity conflict invalidates the cursor and retries from a fresh
snapshot. Rotation recovery persists verified partial pages but cannot rotate
until the pull finishes. An incomplete pull with no accepted write or returned
update is a failure, not success-path progress, so an unavailable continuation
cannot create a busy loop.

Tracked checkpoints are durable backend positions and must satisfy a requested
`minLsn`. A client advertises `supportsUntrackedCommitLsn: true` to accept an
untracked backend's `0/0` reset sentinel; clients without that capability receive
their `minLsn` echoed as a compatibility token, which is not a durability claim.

## Document Sync Conflict Codes

JSON `409` responses retain `error` for diagnostics and carry a normative code:

| Code                               | Client action                                  |
| ---------------------------------- | ---------------------------------------------- |
| `document_sync_state_stale`        | Refetch the writer projection and replan.      |
| `document_sync_update_id_conflict` | Run pending-update ID recovery.                |
| `document_sync_conflict`           | Report the terminal conflict without retrying. |

Retry and recovery decisions use status plus `code`, never `error` text. A
missing or unknown code fails closed as a terminal conflict.
