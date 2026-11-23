# Content-Key Commitment

[`ContentKeyCommitment.tla`](./ContentKeyCommitment.tla) models the readers of
one document across its content-key epochs, and why every reader that judges an
update reaches the same verdict whatever key it holds (#3194).

Each epoch opens with a commitment to its content key: an HKDF output of the
key in its own domain, which the API stores with the epoch and never changes.
Every update's encrypted envelope names the commitment of the key it was
encrypted under. The envelope is signed through its write header's ciphertext
hash, and the API refuses an update whose commitment is not its epoch's. The
API cannot see what a wrap holds, so an authorized key creator can still wrap
another key to some target (wrap equivocation), and a cache or a dishonest
server can hand a reader a stale key.

AES-GCM does not commit to its key: a crafted ciphertext can open under two
keys (`opens`). The plaintext hash is keyed by a key derived from the content
key, so it matches under at most one (`hashOk`). A reader judges each served
update in server order, and only under the committed key. Holding another key
it can say nothing about the update, which is unavailable: the pass fails and
the cursor stays where it is. Under the committed key, an AES-GCM failure or a
plaintext-hash mismatch is a void, and anything else is accepted. So a verdict
depends only on the update and its commitment (`Canonical`), and two readers
that judged an update agree on it.

Writers, rotations, and stale keys have no fairness. Only server delivery of a
reader's own wraps (`Fetch`) and its own judging (`Judge`) are fair, so no
reader waits on another device.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `Init` / `Rotate` | `buildMaterializedDocumentCreatePlan`, `buildMaterializedDocumentLinkSetMutationPlan` for an unlink, and `buildRotatedDocumentContentKeyBundle` for a stale-bundle heal, each declaring `deriveDocumentContentKeyCommitment` of its fresh key; the API stores it once per epoch (`insertEpochRow`) |
| `WrapChoices` | the per-target wraps from `wrapDocumentContentKeyForCreate` and `wrapDocumentContentKeyForTargets`, which the API stores without reading, so an authorized key creator can wrap another key |
| `Commit` | `encryptDocumentPendingUpdate` writing `contentKeyCommitment` from `openDocumentContentKey`; the API's `assertOutgoingEnvelopeCommitsToEpochKey` against the epoch's stored commitment, after `assertOutgoingEnvelopeMatchesHeader` |
| `ServerChecksCommitment` | `assertOutgoingEnvelopeCommitsToEpochKey` for appends, and `assertStoredCommitmentMatches` for a bundle submitted at a stored epoch |
| `Fetch` / `held` | `unwrapDocumentContentKeyFromBundle` over the writer projection's bundle and each historical bundle from `syncResponseContentKeyBundlesByEpoch`, checked by `assertDocumentContentKeyCommitment` |
| `StaleKey` | a bundle or wrap that is not the epoch's canonical one, which `assertDocumentContentKeyCommitment` refuses as `DocumentContentKeyCommitmentError` |
| `Judge` / `Outcome` | `judgeDocumentSyncUpdateDecryption`: `assertEnvelopeCommitsToHeldKey` after `assertDocumentEncryptedUpdateMatchesHeader`, then AES-GCM, where `isAesGcmAuthenticationFailure` decides `decrypt` over `decrypt_runtime`, then the plaintext hash |
| `VoidOnAeadFailure` | `decrypt` in `VOID_STAGES` |
| `cursor` / `Record` | `recordDocumentSyncVerdictsInTransaction` and `processedCursorTransition`, which record a cursor only for a pass that judged its whole page |

The checked configuration sets every switch to its safe value and lets a later
epoch's opener equivocate (`AllowEquivocation`). Its invariants require that:

- every verdict behind any reader's cursor is the one the committed key gives
  (`VerdictsAreCanonical`), so verdicts do not depend on keys;
- two readers agree on every update both have judged (`ReadersAgree`);
- every stored update commits to its epoch's key (`EpochCommitmentUniform`).

Its liveness property `DeviceEventuallyJudges` requires that a reader whose
stored wraps all hold the committed keys eventually judges the whole log,
however other readers' wraps or the updates look.

Four negative controls each relax one rule, and the negative-control check
asserts the named violation on every run:

- `ReaderChecksCommitment = FALSE` judges under whatever key the reader holds.
  A reader handed a stale key voids an honest update that the committed key
  accepts: `VerdictsAreCanonical` fails.
- `VoidOnAeadFailure = FALSE` is the rule before #3194: an AES-GCM failure
  fails the pass. One undecryptable update under the committed key then holds
  every reader for good: `DeviceEventuallyJudges` fails.
- `ServerChecksCommitment = FALSE` stores an update that commits to another
  key: `EpochCommitmentUniform` fails. Without that invariant the update holds
  every reader whose key is the epoch's.
- `CursorPastUnavailable = TRUE` moves the cursor past an update the reader
  could not judge, recording it as void: `VerdictsAreCanonical` fails.

Outside the model: the key derivations and AES-GCM itself, which the model
treats as ideal (a commitment names one key, `hashOk` holds at most one);
an update whose envelope does not match its signed header, which the API
refuses and a reader fails as non-void `encrypted_record` before comparing
commitments, so a server that edits the commitment causes no void; a failure
of the reader's own runtime while deriving keys or decrypting, which is the
non-void stage `decrypt_runtime`; the import judge and its voids, which
[`VoidUpdateProgress`](./VoidUpdateProgress.md) checks; and the server's
choice of pages. A reader with an equivocated wrap cannot read that epoch
until some member holding the committed key rotates, which is the accepted
residual of an authorized writer attacking availability.

The configuration bounds two readers, two keys, two epochs, two updates, and
one stale key. TLC explores 1,344,180 generated and 293,707 distinct states at
depth 12 in about 32 seconds with one worker. This is exhaustive bounded model
checking, not an unbounded proof.
