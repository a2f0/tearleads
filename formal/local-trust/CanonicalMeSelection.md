# Canonical personal Me selection

[`CanonicalMeSelection.tla`](./CanonicalMeSelection.tla) models the current
self-contact selection contract, separately from ordinary roster and
organization profiles. The signing fingerprint determines one creation-local
ID and one canonical remote stream. A different contact with matching user,
keys, or self fields is not that stream.

## Bound and production mapping

The bound has one signing identity, its canonical local ID, one same-stream
alias, and one unrelated contact. Initial scenarios cover missing content,
field-matching unrelated content, canonical and alias records, current-format
recovery, current identity outranking a conflicting recovery field, an occupied
canonical ID with or without a valid alias, and unavailable, read-only, or
unsettled-placement targets. One scope change may interrupt the asynchronous
selection, ensure, or acknowledgement.

The selector lives in
[`contactStoreSelfSelection.ts`](../../packages/app/src/stores/contacts/contactStoreSelfSelection.ts);
bootstrap and identity-only writes live in
[`contactStoreSelfContact.ts`](../../packages/app/src/stores/contacts/contactStoreSelfContact.ts).
Candidate metadata comes from
[`documentIdentityCandidates.ts`](../../packages/app/src/stores/documents/documentIdentityCandidates.ts).
Unrelated contact records need not be loaded or hashed. Selected candidates
still undergo the same full-record placement, access, readiness, and authority
checks at each selection boundary. This model does not prove query cost or
index coverage.

| Model action or predicate | Production seam |
| --- | --- |
| `Planned`, `ActualIdentity`, `ResolvedIdentity` | `getSelfContactLocalId`, `deriveStableDocumentId`, and `loadSelfContactSelection`; persisted `documentId` precedes `recoveryDocumentId` and planned derivation |
| `FinishSelection`, `Candidates` | `loadSelfContactSelection`, `loadSelfContactKnownIds`, `collectSelfContactCandidateIds`, and `advanceSelfContactSelection` selecting only the canonical remote stream, not matching profile fields |
| `Eligible`, `EnsureSelected` | `inspectSelfContactRecord`, `advanceSelfContactSelection`, and `ensureSelfContactFromRuntime` refusing unavailable, read-only, wrong-placement, or unhydrated targets |
| `Acknowledge` | `writeSelectedSelfContactIdentity` and the final `loadSelfContactSelection` in `ensureSelfContactFromRuntime` acknowledging the same eligible contact |
| `ExpireScope`, `AbortStale` | `captureContactsScope` and the caller guard carried through `ensureSelfContactFromRuntime` |

The content token represents existing names, addresses, and unknown rows.
Writing self identity fields is intentionally outside that token: updating
those fields is allowed, reseeding unrelated existing content is not. A new
canonical record may receive initial content. No transition merges, purges, or
redirects ordinary edits on another contact.

Creation retains the SDK's current-remote-alias birth refusal. Recovery-only
identity is selected by the app rather than that transaction's remote-binding
probe; ignoring recovery metadata can therefore hide a canonical stream.

## Checks and controls

Safety requires a successful acknowledgement to name only the canonical
stream, retain writable/materialized/settled eligibility, preserve existing
content, and never follow stale scope work. There may be only one modeled
local birth for the canonical stream. `ValidCanonicalTargetCompletes` requires
completion with stable scope and weakly fair successful local work for the
valid scenarios; unavailable or occupied-without-alias cases may refuse.

| Disabled rule | Required violation |
| --- | --- |
| `RequireCanonicalStream` | `AcknowledgedOnlyCanonical` |
| `RespectPersistedIdentity` | `CanonicalBirthUnique` |
| `RequireWritableTarget` | `AcknowledgedOnlyWritable` |
| `CheckCurrentScope` | `NoStaleEffects` |
| `PreserveExistingContent` | `ExistingContentSurvives` |

This is a selection/admission model, not a model of the complete Contacts
store. Candidate enumeration and repeated queue-time revalidation are
collapsed; records do not move, disappear, or lose access during a run. The
bound does not enumerate multiple preexisting aliases, test identity hashing,
prove signer trust, model address CRDT semantics, or cover the separate
retained remove/move/purge action-authority machine. Notification filtering and
stable UI identity views are also outside this model; see the
[identity source](../../packages/app/src/stores/contacts/createSelfContactIdentitySource.ts)
and its runtime regressions. No compatibility lookup, migration, or reset is
modeled or introduced. Current-format same-document recovery remains part of
the valid selection paths.
