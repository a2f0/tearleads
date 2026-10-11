# Audit Slices

Read only the selected slice section when preparing an auditor prompt. Keep
the other slices in the coverage queue described in [batching.md](batching.md).

Client paths are under `packages/client-sdk/src` and API paths are under
`packages/api/src` unless a full path is shown.

| Slice | Client scope | API scope |
| --- | --- | --- |
| `documents` | `data/documents`, `workflows/documents`, `stores/documents`, `packages/loro` | `workflows/documents`, `documents`, `routes/documents`, `services/documents` |
| `containers` | `data/keyingProjectionVerification`, `data/containers`, `workflows/containers`, `workflows/container-contents/container-state` | `workflows/containers`, `routes/containers`, `services/containers`, `access` |
| `principals` | `data/principals`, `workflows/principals`, `workflows/organizations`, `client/organizations` | `workflows/principals`, `workflows/organizations`, matching routes and services |
| `blobs` | `data/blobs`, `data/documents/blob`, `workflows/blobs`, attachment hydration in `stores/documents` | `workflows/blobs`, `routes/blobs`, `services/blobs`, `adapters` |
| `sync-placement` | `workflows/container-contents` (except `container-state`), `stores/container-contents`, `stores/local-projection` | listing and feed routes, `access/read` |
| `sync-runtime` | `sync`, `data/sync`, `workflows/sync`, `data/persistence`, outbox and pending-write paths in `stores/documents` | `realtime` |
| `crypto` | `packages/crypto/src/keying` (except transparency), `packages/crypto/src/signing`, `packages/crypto/src/encapsulation`, `packages/encoding`, `packages/validators` | how both sides call the shared verifiers |
| `identity` | `data/trustedUserIdentity`, `client/session`, `client/root`, `client/localKeyring`, `workflows/registration`, `packages/api-client`, `packages/app/src/providers/db/*Backup*` | `routes/auth`, `workflows/auth`, `services/auth`, `middleware`, root routes and services |
| `api-writes` | none | every mutating route, `validators`, `packages/api-shared` schemas |

## `documents`

- Can the server get the client to merge, decrypt, or display an update that
  was not signed by an authorized writer at the path it was accepted under, or
  splice updates across documents, epochs, or containers?
- Can it make the client wrap a content key to an unauthorized recipient, or
  reuse a key or nonce?
- Can a coded error, empty listing, or 404 delete local data without a verified
  purge proof?
- Does the API validate every signed event and header with the same rules and
  options as the client verifier? Diff the two.
- Can a client write through a container it cannot write, link across
  organizations, or collide with another document's ids?
- Can a writer cite extra authorizing paths (another organization, unlinked
  leaves) that the API stores and readers must then resolve?
- For a document linked into several containers, can a writer holding only one
  link still heal a stale bundle and write after another link rotates?
- Can a purge proof without predecessors, or with an ancestor the device has
  since pinned newer, advance or block the local checkpoint?

## `containers`

- Can a served projection make the client wrap a KEK, or document keys under a
  KEK, for an unauthorized recipient, or accept a KEK whose epoch id does not
  commit to its material?
- Can a crafted or replayed acknowledgement advance a checkpoint to a head the
  client did not sign?
- Does the KEK-log rebuild verify every bridge and keyring before using it?
- Direction B: cross-organization or cyclic moves, non-admin share, revoke, or
  rekey, and a writer escalating grants or changing referenced heads.
- Parity: diff API and client container event verification for authority,
  citations, root paths, epoch transitions, grant roots, key target hashes,
  keyring lengths, recite limits, and the membership option.
- Does the API accept wrap labels or recipient ids the client derives itself?
- Compare every read-time bound (path depth, manifest history, carried caps)
  with its commit-time guard. Can honest use grow a container past what the
  API will later verify cold?
- Can every rotator comply with what the rotation owes, including one that
  revokes its own access?

## `principals`

- Can recipient resolution for member envelopes or KEKs use unverified rows,
  stale directories, or identity lookups not bound to signed fingerprints?
- Is `externalAuthority` bound to the right organization's Admins head, and
  are directory heads bound to organization and group ids?
- Does the client check an unwrapped member envelope against the signed
  principal key before re-wrapping it?
- Direction B: does the API verify every submitted principal state, including
  registration invariants, on the exact bytes it will later serve?
- Can a client delete a group or organization it does not administer, or can
  the server make a client drop organization state without proof?
- After a container or group is deleted, can grantee groups still advance,
  users still be offboarded, and fresh devices still fetch every policy the
  retained history cites?
- Does disabling a user remove them from every group, or only Admins and
  Members?

## `blobs`

- Are blob id, document, epoch, chunk index and count, and sizes bound so that
  substitution, truncation, and reordering fail?
- Can a listing bind a foreign blob, roll a slot back, or delete newer local
  bytes?
- Direction B: can a client bind a blob it did not stage, complete or abort
  another user's upload, overwrite a blob id, or trigger GC of a referenced
  blob?
- Are stale blob key bundles handled the way documents handle them after a
  rekey or link change?
- Does binding an existing blob into one document rewrite or replace the
  served envelopes of other documents bound to it?
- Are local byte stores keyed per slot, and does every delete check other
  references?

The `sync` surface is split in two because of its size (about 49k non-test lines
in September 2026). Keep both queued; split either into smaller work items
when necessary to fit a batch. Do not launch extra auditors to finish it now.

## `sync-placement`

- Which local mutations come from unverified listing rows (parent, slot,
  organization, `metadataDocumentId`, epochs, flags, cursors, tombstone
  timestamps, coded errors)? Can they delete, hide, move, or re-target writes?
  Follow every listing field into local persistence and into later reads that
  use it as a floor or selector.
- Do container tombstones cascade to local descendants, and can a fence block
  an honest later listing?
- Can adoption bind a pending create, move, or link to a server-chosen object?
- Direction B: listing children or feeds without an access path.
- Is there cross-identity or cross-organization contamination in discovery and
  placement caches?

## `sync-runtime`

- Does outbox replay re-verify current state before signing?
- Can any path advance or erase a checkpoint from unverified data or on the
  server's say-so, including remote reset and organization replacement?
- Direction B: realtime subscription authorization and revocation, ticket and
  session liveness, and hint scoping.
- Is there cross-identity or cross-organization contamination in shared
  executors and caches, and are they cleared on identity switch and reset?

## `crypto`

- Are canonical encodings injective and domain-separated (absent versus null,
  Unicode, numbers, locale)?
- Is every decision-relevant field inside the signed bytes of each signed
  object?
- Can served data choose a suite or format, and does AEAD associated data bind
  object id, epoch, and purpose everywhere the documentation claims?
- Set roots: duplicates, sort order, and count versus root.
- Authority algebra: access levels, the membership option, lineage, and epoch
  and version transitions.
- Parity: verifier options used differently by the API and the client, and
  verifiers the client uses that the API never calls on submission.

## `identity`

- Can a pin, trust domain, or login bind one identity's keys or artifacts to
  another user id?
- Which responses are not bound to their request (acknowledgements, bundles,
  KEK logs, purge proofs, listings)?
- Direction B: registration invariants, retry adoption, session and
  organization scoping, and origin spoofing.
- Do all security anchors survive backup restore and identity switch
  (checkpoints, purge checkpoints, pins, incidents)?
- Are verification failures swallowed into retries or fallbacks, or
  availability failures recorded as incidents?
- Organization replacement and purge recovery: what proves the adopted
  organization and root, and what local state does the reset delete or
  re-home?
- Does every signed challenge or login artifact name the API it is for?

## `api-writes`

- Start with earlier domain reports and their API/client verifier comparisons.
  Check cross-cutting gaps and uncovered routes; link existing evidence
  instead of repeating every domain's deep sweep. Queue missing coverage.
- Build a compact route table: actor binding, id binding to signed payloads,
  and check-versus-lock ordering.
- Replay a signed artifact into another container, organization, document,
  epoch, or context after it was superseded.
- Look for TOCTOU between authorization or head checks and the write, and for
  database constraints that enforce linear history.
- Look for rows deleted while their heads or links remain current.
- Look for input that passes API validation but breaks client parsing or
  verification.
- For each signed field, record its column type and whether the storing
  transaction re-reads and re-verifies it; create routes, whose ids come only
  from the signed body, deserve the closest look.
