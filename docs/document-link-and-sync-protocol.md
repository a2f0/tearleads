# Document Link and Sync Protocol

[Documents](./glossary/content.md#document) do not own direct ACLs. A
[document link-set manifest](./glossary/access.md#document-link-set-manifest)
names the [containers](./glossary/access.md#container) that link to the
document. Document create and link-set mutation routes use signed document
[access events](./glossary/access.md#access-event):

- `POST /documents`
- `POST /documents/:documentId/link`
- `POST /documents/:documentId/unlink`

`DocumentCreateRequest` and `DocumentLinkSetMutationRequest` carry:

- signed `event` and typed `body`
- `expectedManifestHash`, never the manifest: the API derives the manifest
  (for a create, the initial link-set manifest from the signed event and the
  target path) and compares the hashes
- target and authorizing container path references (`{containerId,
  manifestHash}` citations of stored manifests; the API resolves the previous
  link-set manifest from its own store, and a create has none)
- optional `containerRekeys[]`
- a document [content-key bundle](./glossary/keys.md#content-key-bundle),
  which declares its epoch's
  [content-key commitment](./glossary/keys.md#content-key-commitment): a new
  epoch's commitment is stored, and a bundle at a stored epoch must repeat it

The API verifies the event, verifies
[container path](./glossary/access.md#authorizing-container-path)
[heads](./glossary/sync.md#head), loads referenced
[principal policies](./glossary/principals.md#principal-policy-state), derives
the document link-set manifest, stores the manifest head, and validates the submitted
content-key bundle against derived document
[KEK targets](./glossary/keys.md#key-target).

A create may also carry an `initialSync` seed: exactly one outgoing
[update](./glossary/content.md#loro-update), whose start is empty, and nothing
else. The API rebuilds the document sync the seed stands for from the create:
its content-key bundle, link-set and target hashes and epoch, its target path as
the authorizing path, and the update's end as the local version. The update's
signed write header names the same values, and that sync must parse and fit the
sync request limit. A seed that names any other sync field (such as a `minLsn`
precondition) is refused. It is the client's one queued update that holds the
new document's whole content. Content known at creation (a contact's names, an
imported file's fields and rows) is opened into that birth update rather than
written after it, so such a document qualifies. The API commits the seed in the
create transaction under the same
[write-header](./glossary/content.md#signed-write-header), target, and billing
checks as a standalone sync, so a seed a sync would refuse fails the create, and
nothing commits. The response's `initialSync` names the accepted update id and
the commit position, which the client records as its first sync's. The route
publishes the seed's [update hint](./developer/realtime-hints.md); the client
settles its queued row only when that acknowledgement names it. Settling the
seed answers only the update signal the client held before submitting the
create, so the pass [skips its
pull](./client-sync-ordering.md#remote-pull-eligibility). A peer can edit the
document before the response arrives, so the client matches update hints against
the id it submitted the create under until the response installs it, and any
such hint keeps the pull owed. A folder's metadata document takes the folder's
id, so a seeded folder create matches hints for it the same way.

A refused seed falls back once to the plain create, after which the row syncs
normally. A lost response is adopted through
`409 document_manifest_already_exists`. Adoption cannot tell whether the seed
committed, so the row stays queued and syncs as an ordinary update. That sync
encrypts the row again, so when the seed did commit, the reused id no longer
matches the stored ciphertext and the server answers
`409 document_sync_update_id_conflict`. Recovery pulls with the live version
lowered to the start of each conflicted row, because the server returns only
updates past the advertised version and the live version already covers every
queued row. It settles a row when that pull carries the stored update with the
same content, and otherwise re-keys the row, whose ops then commit again under
a fresh id; that duplicate is harmless because CRDT import is idempotent. A
lost response therefore costs the recovery round trips, not data.

Both link and unlink bodies require `blobRewraps`: one entry per
[blob](./glossary/content.md#blob) actively bound to the changed document, with
`blobId`, the immutable `contentKeyEpoch`, and complete wrapped `targets` for
every [active binding](./glossary/content.md#attachment-binding) and resulting linked
container. Document creation signs an empty array. The event signature covers
the envelopes inline. Clients authenticate the existing blob ciphertext before
[rewrapping](./glossary/keys.md#rewrap) its [content key](./glossary/keys.md#content-key)
for new destination KEKs; this streams bounded chunks, checks the complete
signed ciphertext hash, and does not retain whole attachments in memory between
bindings. Retaining or removing existing envelopes verifies signed binding scope
without fetching ciphertext. The API checks the active binding frontier under
the document-head lock, then takes sorted blob locks and commits links and
envelopes atomically. Another document sharing a blob retains its own envelopes.
Returning to a retired target reuses its retained wrap for the same key
identity; an active target cannot replace its stored key material. The signed
event records the proposed envelopes. The API validates their target identities
and substitutes retained envelopes where applicable, so event replay must apply
this retention rule rather than copying the proposal directly. Readers consume
the resulting verified bundle projection. Stale or incomplete rewraps conflict
without advancing the document head. Rewraps whose blobs are not exactly the
active bindings answer `409 document_link_attachments_changed`; other stale
rewraps (a re-cited content-key epoch that moved) stay uncoded.

A client normally lists the document's attachments before signing. It may
instead sign an empty `blobRewraps` without listing when its local view holds
the document and no attachment row for it (no held or downloaded copy, no
locally detached slot whose remote detach is queued, and no pending upload). A
move or Trash leg may likewise re-cite the envelopes the previous leg committed;
a leg that cannot re-cite them lists. Either view can be stale, so the server's
frontier check stays authoritative: on `document_link_attachments_changed` (or,
for re-cited envelopes, the uncoded epoch conflict) the client lists afresh,
bypassing any cached listing, and retries once, unless the operation is no
longer current. A refused retry is reported like any other link-set failure. A
stale view therefore costs at most one refused submission per attempt, plus the
reads its fresh attempt makes (the listing and the evicted writer projection),
and never a wrong commit.

An unlink [rotates](./glossary/keys.md#rotate) the document content key and must
carry a `rotationBaseline` — a signed `rotate_baseline` full-history snapshot
whose source [version vector](./glossary/content.md#version-vector) covers the
committed update frontier after the baseline's signed processed cursor
(`coversThroughUpdateId`, or every committed update when it signs none) — with
one exception: a document with **no committed
updates** may be unlinked without a baseline. A baseline may declare no
operations only when it signs a cursor: the author voided every update through
the cursor, so its snapshot is empty; the server refuses an empty baseline
without one with 400. The server proves that emptiness
inside the mutation transaction under the document manifest-head write lock.
Sync writers hold the corresponding exclusive lock, so no update can commit
between the emptiness proof and the unlink. A baseline-less unlink against a
non-empty committed frontier is rejected as a conflict. A link must not carry a
[rotation baseline](./glossary/keys.md#rotation-baseline), so it may advance the
[content-key epoch](./glossary/access.md#access-epoch) only under the same emptiness
proof; otherwise the link is rejected as a conflict. A stored rotation baseline
counts as a committed update. Honest clients link at the current epoch.

Encrypted [Loro sync](./loro-e2ee-sync-protocol.md) uses
`POST /documents/:documentId/sync`. `DocumentSyncRequest` carries:

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
- optional `maxPageUpdates`, from 1 to the server's page limit
- optional read-only `historyMode: "raw"`
- `inlineRekeyCommitId`, present exactly when `containerRekeys[]` is non-empty
- `outgoingUpdates[]`

The durable `inlineRekeyCommitId` marker makes the [rekey](./glossary/keys.md#rekey)
and its outgoing write replay-safe as one transaction; unmarked batches and
markers without a batch are rejected.

Document sync updates carry encrypted bytes, partial version vectors, and a
signed write header. A served update also carries `authorizationTargets`, the
container KEK target set its header's `targetHash` commits to, unless that hash
equals the request's `expectedTargetHash`: the client then refills the set from
the content-key bundle it planned against and re-hashes it against the signed
`targetHash`, so a set omitted under any other hash fails closed. The stored
write header keeps its target set. Checkpoint fields are either all absent or
the tuple `rotate_baseline`, `full_history_snapshot`, and a non-empty source
vector, with an optional `coversThroughUpdateId` UUID only beside them. Writes
require path refs; the API requires an active path. Reads may
omit refs and carry no rekeys or bundle. `expectedLinkSetManifestHash` pins the
server-resolved document head instead of echoing the full manifest.

For accepted writes, the API verifies:

- session user/fingerprint match the write header signer
- the document manifest and authorizing paths are active heads
- the caller has write access through at least one linked container path
- content-key targets match the active document KEK target hash
- the write header matches document id, organization id, manifest hash, target
  hash, content-key epoch, metadata hash, and ciphertext hash
- the encrypted envelope names the
  [content-key commitment](./glossary/keys.md#content-key-commitment) stored
  for its epoch
- duplicate update ids are idempotent only when the encrypted content and write
  header match the already accepted update

The sync response returns accepted outgoing ids, a `commitLsn` and its
`commitLsnMode`, a required array of the older epoch bundles that served
updates cite, encrypted updates missing from the client-supplied frontier, and
`pullPage`. `pullPage.hasMore` and `pullPage.nextCursor` are consistent: a
continuation is present exactly when more updates remain in the frozen pull
snapshot.

The response does not echo the active content-key bundle or the document KEK
targets. The server commits a sync only against the bundle the request carries
or, without one, the stored bundle whose epoch, link-set hash, and target hash
the request names, so the client keeps and persists the bundle and targets it
planned against. A read-only pull served against a stale stored bundle is
allowed only when that bundle is the latest one and matches the request's
expectations, so it is the bundle the client already holds. `contentKeyBundles`
holds each older epoch at most once and never the active epoch, so an empty
probe or a page whose updates are all at the active epoch carries an empty
array. The response validator rejects a repeated epoch, and the client's bundle
merge rejects a repeated epoch and an epoch newer than the one it synced
against, as a malformed response.

Every sync request must set `supportsPullPagination: true`, and every successful
response must carry `pullPage`; there is no unbounded response mode. The first
paginated pull proves `minLsn` before freezing its upper update bound. Update
inserts and watermark capture serialize on the document manifest head, so
PostgreSQL identity allocation cannot place a later-committing lower sequence
behind the cursor. The opaque cursor authenticates the document id, content-key
epoch, link-set hash, target hash, last returned update, and original upper
bound with a deployment HMAC key. It is not an authorization capability: each
request still reauthorizes the document, and both cursor ids must resolve within
it. Cursor tampering or deployment-key rotation rejects the continuation as
stale so the client restarts from a fresh bounded snapshot. A readable
authenticated rotation baseline may move the initial lower bound forward before
page selection only after its source frontier proves that it covers every update
the client is missing before that baseline, other than those at or before the
baseline's signed processed cursor, which its author imported or voided (see
[advisory op spans](./advisory-op-spans.md#rotations-and-unlinks)). An
explicit read-only `historyMode: "raw"` request bypasses that redirect and
returns every retained
update missing from the supplied frontier. Each page includes the content-key
bundle for every epoch represented by its updates. A request's
`maxPageUpdates` lowers the page's update count below the server's limit; a
client isolating updates a process death left unattributed sends 1 (see
[Loro read window](./glossary/sync.md#loro-read-window)).
[Raw mode](./raw-document-history-recovery.md) is for deliberate recovery or
diagnosis by clients that can still unwrap the historical keys; it cannot make
old ciphertext readable to a newly authorized reader who never possessed those
keys. The opaque continuation cursor binds the selected history mode, so callers
cannot change modes midway through a frozen pull snapshot. A continuation must
opt into pagination, carry that cursor, and be read-only: it has no outgoing
updates, rekeys, key bundle, or authorizing paths. Every page must retain the
first page's key identity and commit-LSN mode, and its tracked checkpoint must
satisfy the prior page's `commitLsn`.

One response page contains
[at most 64 updates and 48 MiB](./limits.md#document-sync) including its key
envelope. The SDK settles exactly one page per submission before requesting the
next. Built-in document and container-metadata stores persist a versioned
continuation in the shared local `documents` row; pulled document history is
durable before that row advances, while metadata content and its continuation
commit together. A process restart therefore replays, at worst, the prior page
and resumes the same frozen snapshot instead of restarting at page one. The
terminal page clears the continuation durably. Queued writes wait until that
snapshot drains, and local writes made meanwhile preserve its progress. A
document/key identity change or rejected cursor invalidates the progress and
restarts from a fresh bounded snapshot. Rotation recovery persists partial pages
but cannot rotate until the pull finishes. A cursor-only empty page still makes
bounded durable progress; a failed request advances nothing and relies on the
normal
[sync scheduler/backoff](./client-sync-ordering.md#failure-and-retry-semantics)
rather than creating a busy loop.

Tracked checkpoints are durable backend positions and must satisfy a requested
`minLsn`. Every response declares its `commitLsnMode`; the Postgres API always
reports `"tracked"`. A backend without a portable WAL position would return
`"untracked"` with the `0/0` reset sentinel, and the client replaces a
previously tracked checkpoint with that explicit mode and sentinel.

## Document Sync Conflict Codes

JSON `409` responses retain `error` for diagnostics and carry a normative code:

| Code                                         | Client action                                  |
| -------------------------------------------- | ---------------------------------------------- |
| `document_sync_checkpoint_coverage_conflict` | Regenerate the queued rotation checkpoint.     |
| `document_sync_dependency_uncommitted`       | Move unsent ops off the named peers, retry.    |
| `document_sync_descendant_rekeys_required`   | Commit the container rekeys standalone, retry. |
| `document_sync_peer_owned`                   | Move unsent ops off the named peers, retry.    |
| `document_sync_state_stale`                  | Refetch the writer projection and replan.      |
| `document_sync_update_id_conflict`           | Run pending-update ID recovery.                |
| `document_sync_conflict`                     | Report the terminal conflict without retrying. |

Retry and recovery decisions use status plus `code`, never `error` text. A
missing or unknown code [fails closed](./glossary/access.md#fail-closed) as a terminal
conflict.

A stable-id document-create retry adopts the committed remote document only on
`409 document_manifest_already_exists`. The same code and status are terminal
for other callers; diagnostic `error` text never selects the adoption path.

When an inline `containerRekeys[]` mutation encounters a stale principal-policy
projection, `document_sync_state_stale` may carry at most 16 advisory
`principalHeads[]`. Each head contains the principal identity, version, state
hash, key epoch and key fingerprint. The client recovers signed evidence through
the [paged history resolver](./principal-history-pages.md), restricted to
principals named by its submitted rekeys, before it refetches the
[writer projection](./glossary/sync.md#writer-projection) and replans. Error hints
alone never admit checkpoints. Exact scoped references and the original runtime
lifetime must remain valid throughout recovery, and the retry stays bounded by
the normal stale-state budget. Other conflict codes ignore repair heads.

A sync that extends a Loro peer past its committed frontier when another user
is that peer's [owner](./glossary/sync.md#peer-owner) is refused whole with
`document_sync_peer_owned`. Its `peerFrontiers[]` names at most 64 refused
peers in canonical order, each as a decimal `peerId` with the
`committedEndCounter` (exclusive) committed before the request; a request
refused on more peers is refused again for the rest after its retry. Counters
below that frontier may be re-asserted by any writer, so the client keeps
everything there, moves its unsent operations past it onto a fresh peer, and
resubmits. A sync with an update that depends on an operation past its peer's
committed frontier (a [dependency frontier](./glossary/sync.md#dependency-frontier)
neither committed nor carried by an earlier update of the request) is refused
whole with `document_sync_dependency_uncommitted` and the same
`peerFrontiers[]`, and the client recovers the same way. A request refused for
both carries `document_sync_peer_owned`. Other conflict codes ignore
`peerFrontiers`. The rules are in
[advisory op spans](./advisory-op-spans.md#what-the-server-checks).
