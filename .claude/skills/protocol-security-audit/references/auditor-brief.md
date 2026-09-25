# Auditor Brief

Send each slice auditor the shared brief with its placeholders filled, then the
bug-class list, then exactly one slice section.

## Shared brief

```text
You are one of several parallel security auditors on the Tearleads monorepo
(<REPO_ROOT>, revision <SHA>). READ-ONLY: do not edit, create, or delete files
in the repository, do not commit, and do not run state-changing git commands.
Write scratch notes and probes only under <SCRATCH_DIR>. You may run existing
tests. Audit the existing TLA+ models relevant to your slice, including their
assumptions, properties, configurations, and production mappings. Do not
implement model changes, negative controls, trace fixtures, or documentation
updates; recommend fixes or additions in your report for a separate task.

Mission: find data-synchronization and security bugs at the client-sdk <-> API
integration against two invariants.
- A. An honest client detects a dishonest API. Server data that drives
  decryption, recipient wrapping, signing, local deletion or overwrite,
  checkpoint advancement, or authorization must be verified against signed
  artifacts, pinned identities, and local checkpoints, never trusted as
  projection rows.
- B. An honest API detects a dishonest or misconfigured client. The API must
  reject unauthorized or malformed submissions. Verifier parity matters most:
  if the API accepts an artifact that honest client verifiers reject, one
  client can poison shared state and brick every device. If the API rejects
  what honest clients produce, that is a lower-priority availability bug.

Out of scope, do not report: <EXCLUSIONS>

No-brick rule: a client must never refuse data an honest server can produce,
and no device's ability to read or write may depend on another device's cache
or write. If a fix needs such a refusal, say so and propose a server-side or
non-bricking alternative.

Already fixed or tracked; report only a regression or a bypass:
<KNOWN_ISSUES>

Security changes since the last audit are the least-reviewed code at this
revision; scrutinize them first (read their diffs with `git show <sha>`):
<RECENT_SECURITY_PRS>

Read docs/security-guarantees.md first. Claims there that the code does not
implement are findings. Also read formal/README.md and the model docs for your
slice.

Quality bar: report only issues traced through real code paths with file:line
evidence, ideally with a probe. Prefer three real bugs over fifteen
speculative ones. Try to refute each candidate: is there a check elsewhere, is
the path reachable in production, does a signature already cover the field?
Confirm option defaults at the production call site, not only in the helper.
Decide honest reachability from the honest client's own flow (for example,
whether the SDK revokes grants before a delete). List plausible but untraced
items separately.

Probes: import repository modules by absolute path and run
`bun test <absolute path>` from the owning package directory. API probes use
`API_DATABASE=memory` (PGlite, Postgres semantics); the sqlite backend hides
uuid lowercasing and text-column normalization. The strongest parity evidence
is a differential probe run from packages/api that commits through real routes
and feeds the served projection to the real SDK verifier. The coordinator has
rebuilt packages/client-sdk/dist at this revision: do not rebuild it or run
bun install, because a rebuild mid-run breaks other auditors' probes. Existing
TLC results are in <SCRATCH_DIR>/formal/; do not re-run the whole suite.

Output, under about 2,000 words. For each finding give: a title; direction (A,
B, or Parity); severity (High, Medium, Low) and confidence (Probed,
Confirmed-by-trace, Plausible); file:line evidence; the attacker precondition;
a concrete step-by-step scenario; the impact; a suggested fix with a no-brick
check; and whether it is model-shaped (a refusal rule, commit guard, lock,
ordering, or recovery rule that a TLA+ model could express). For model-shaped
findings, identify existing coverage, recommended model fixes or additions,
and validation still needed. Report defects or coverage gaps in the existing
models even when no production bug is confirmed; distinguish model evidence
from production evidence. Then give a short "checked and looked sound" list.
```

Default `<EXCLUSIONS>`: equivocation and split view; cold-start rollback on a
device with no checkpoint; first-contact identity TOFU; key transparency,
witnesses, and semantic currentness (#2186 or its successor); pure availability
or withholding; DoS and rate limits; residuals documented as accepted in
`docs/security-guarantees.md`; plus any exclusions the user added.

Fill `<KNOWN_ISSUES>` from the audit issues, their closing comments, and the
"Not in scope" or follow-up sections of each fix PR; carried-forward items
live there, not in the issue bodies. Name withdrawn designs explicitly (such as
the #2173/#2174 client currency rule) so auditors do not re-propose them. Fill
`<RECENT_SECURITY_PRS>` with each security PR since the last audit and one line
on what it changed.

The brief is long. The coordinator may write it, filled in, to
`<SCRATCH_DIR>/brief-shared.md` and require each auditor to read that file in
full before anything else, with the slice section inline in the prompt.

## Bug classes to sweep

Append this list to every brief. Each class produced real findings in an
earlier audit.

- **Signed bytes that do not survive storage.** A signed or hashed field stored
  in a typed column (timestamp, numeric, normalized text) and served back
  re-serialized. Compare submitted bytes with served bytes, not just parse
  validity. Try an uppercase UUID in a `uuid` column and a lone surrogate
  (`"\ud800"`) in a `text` column, on every signed id and free-text field.
- **Derived-field parity.** A label, id, or target key the client derives from
  pinned identity or signed state (recipient key epoch ids, target keys) that
  the API accepts free-form, or rebuilds from what was stored so its own check
  always agrees.
- **Skip instead of refuse.** Shared verifier loops that `continue` past
  out-of-scope elements (foreign-organization or unlinked citations, extra
  targets). The API stores the extras and serves them; readers must resolve
  every one and cannot.
- **Commit bounds versus read bounds.** Depth, history length, and carried or
  inline caps enforced when a path or chain is read or verified but not when
  it is committed, so the API commits what it later refuses to serve. Compare
  every read-time constant with the commit-time guard and its twin constant.
- **Dependency read authorization.** Everything a verifier must fetch
  (principal policies, cited manifests) must be readable by every device that
  must verify it, including heads cited only by history, siblings of a
  multi-container link, and principals since deleted.
- **Other objects' guards after a delete.** Beyond heads and links, check
  whether a delete leaves rows that other objects' commit guards (group
  successors, roster removal, group deletion) still count as current.
- **Diverging verifier options.** One shared verifier called with different
  defaults on each side, such as membership at `current` versus `referenced`,
  checkpoint enforcement, or legacy allowances.
- **Leaf-only commitments.** An artifact commits a leaf target but is later
  re-authorized through a path rebuilt from pins or current state instead of
  the path it was accepted under.
- **Rows deleted, heads retained.** A delete removes a row but keeps the head
  or link that write paths still treat as current.
- **Unsigned selectors.** Listing fields (slots, parent ids, names, flags) that
  choose where a signed write goes, even when the write itself verifies.
- **Head regression.** A mutation that can cite an older principal or ancestor
  head than its predecessor without an admin-only or currency check at commit.
- **Runtime-dependent canonical encodings.** `localeCompare`, `Intl`, default
  time zones, or platform JSON feeding a hash or signature.
- **Twin paths.** A stale flag, lock, or check present for documents but
  missing for blobs, or the reverse.
- **Security anchors lost.** Checkpoint, purge-proof, pin, or incident tables
  dropped by backup restore, identity switch, or remote reset.
- **Error mislabeling.** Availability failures recorded as tampering, or typed
  verification failures swallowed into retries or null fallbacks.
- **Unauthorized interest.** Realtime subscriptions or feeds accepted for
  objects the actor cannot read.
- **Adoption without scope.** Lost-response or discovery adoption that binds a
  local pending write to a server-chosen object without checking the signer,
  container, and organization.
- **Unsigned triggers.** Unsigned status fields (billing `purged`, listing
  flags, coded errors) that start destructive or re-homing workflows: remote
  reset, organization replacement, checkpoint deletion, re-parenting.
- **Inherited removals.** A server-asserted removal that cascades to local
  descendants or siblings, or a fence keyed by an unsigned timestamp that
  later honest listings cannot pass.
- **Multi-link liveness.** A heal or repair that needs keys or authority over
  every linked container, so a writer on one link waits on a member who spans
  them all.
- **Shared local resources.** Local storage keys or caches keyed by an id
  several slots, documents, or identities share, deleted or overwritten
  without a reference check.

## Slices

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

### `documents`

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

### `containers`

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

### `principals`

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

### `blobs`

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

The `sync` surface is split in two by default because it is the largest (about
49k non-test lines in September 2026). Merge them only if a re-count shows the
combined slice is balanced with the others.

### `sync-placement`

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

### `sync-runtime`

- Does outbox replay re-verify current state before signing?
- Can any path advance or erase a checkpoint from unverified data or on the
  server's say-so, including remote reset and organization replacement?
- Direction B: realtime subscription authorization and revocation, ticket and
  session liveness, and hint scoping.
- Is there cross-identity or cross-organization contamination in shared
  executors and caches, and are they cleared on identity switch and reset?

### `crypto`

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

### `identity`

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

### `api-writes`

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
