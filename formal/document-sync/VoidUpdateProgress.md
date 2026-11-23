# Void Update Progress

[`VoidUpdateProgress.tla`](./VoidUpdateProgress.tla) models readers of one
document whose server log can hold an update with a false op span (#3135).
Each update declares, under its writer's signature, the operations it carries.
The server cannot read the payload, so it filters a pull by the reader's
frontier against declared spans. An overclaim names an operation nobody ever
carries, so that filter serves it forever. An underclaim hides an operation
behind a span a reader may already cover, so some readers are never served it.

A reader judges each served update in server order. It accepts an update whose
payload is exactly its declared span, which its decoder can read, and whose
dependencies the operations it already holds satisfy. Otherwise it voids the
update and goes on. A completed pull records a processed cursor, the pull's
upper bound, with the judge and the frontier it was reached with. A later pull
sends the cursor only while the device runs the same judge and its frontier
still covers the recorded one. The server then starts the pull after the
cursor.

A reader's Loro runtime can also fail on an update: a WebAssembly trap or
exhausted memory says nothing about the update, and may leave the module
unusable for the rest of the process. Such an update is unsettled
(`RuntimeFailure`). The pull applies what came before it, records no cursor,
and a later pull judges it again. Only the first runtime failure in a process
lifetime counts as an attempt (`failedInLife`, `Restart`); once `MaxAttempts`
lifetimes have each failed the update, it is a final void on that device
(`finalVoid`) until its decoder changes. An honest update that fails that many
lifetimes on one device is void there and nowhere else, which is the accepted
residual, so agreement and currency are stated for devices with equal final
voids.

The model collapses a pull's pages into one served inbox (`Pull`) and one
judging step (`Process`). A decoder upgrade may land between the two, which
stands for an SDK upgrade between pages while a continuation is persisted. The
server still serves from the cursor the first page sent, so such a pull leaves
the cursor as it was (`pullJudge`).

Writers are outside actors and devices only read. Commits, decoder upgrades,
state replacement, runtime failures, and restarts have no fairness. Only
server delivery (`Pull`) and the device's own processing (`Process`) are fair,
so no device waits on another.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `HonestCommit` | a span from `createPendingUpdateFields`, which never queues an empty span; `assertOutgoingDeclaredSpan` refuses an empty or inverted one |
| `Overclaim` / `Underclaim` | a modified client signing spans its payload does not carry, which the server stores once `assertOutgoingDeclaredSpan` finds the span non-empty and not inverted |
| `Pull` / `Uncovered` | `resolveSyncPullPagePlan` starting after `readProcessedThroughSequence`, then filtering by the request's version vector |
| `bound` | `createSyncPullPageResponse` returning the page plan's upper bound as `throughUpdateId` |
| `CursorSendable` | `readSendableProcessedCursor`, read by `readProcessedCursorForSync` before each store pull |
| `Judge` / `Accepts` | `validateDocumentSyncUpdateImports` and `judgeUpdate`, which checks the decoded Loro metadata against the signed span before the scratch import, after `judgeDocumentSyncUpdateDecryption` checks the plaintext hash |
| `RuntimeFailure` / `attempts` | `judgeUpdate` returning `runtime_failure` for `isLoroRuntimeFailure`, `LoroRuntimeFailureLedger.noteFailure`, and `recordDocumentSyncRuntimeFailures`, which records the `loro_runtime` row and its `attempts` before the page is saved |
| `failedInLife` / `Restart` | `processLoroRuntimeFailures`, the ledger a process starts with, which counts only its first failure |
| `finalVoid` | a `loro_runtime` row with `MAX_LORO_RUNTIME_ATTEMPTS` attempts, read back as a known void by `recordedImportJudgements` |
| `pullJudge` | the pull premise in `processedCursorTransition`: a pull's first page records its judge and sent cursor (`pullJudge`, `pullSentCursor` on `document_sync_progress`), and a later page under another premise is `abandoned` |
| `CursorPastUnsettled` | the `held` page position in `processedCursorTransition`, which abandons the pull, set from `hasHeldPull` |
| `Process` / `cursorVersion` | `recordDocumentSyncVerdictsInTransaction` as the record save's commit side effect, recording the saved `snapshotEndVersion` |
| `Upgrade` / `cursorJudge` | `documentVerdictJudge`, from `loroDecoderIdentity` and the void rules version |
| `Replace` | a replaced local state whose frontier no longer satisfies the recorded one (`satisfiesVersionVector`); `deleteDocumentSyncVerdictsInTransaction` on a rebind or delete |
| `RefuseVoid` | `assertNoVoidedDocumentSyncUpdates`, which rotation still uses for the history it re-encrypts |

The checked configuration sets every switch to its safe value. Its invariants
require that:

- no device holds an operation that no signed span declares
  (`VoidNeverApplied`);
- the server never serves a device an update its cursor already stands for
  (`ServedOnceAfterProcessed`);
- two devices that processed the whole log with the same judge and the same
  final voids hold the same operations (`ProcessedDevicesAgree`);
- no update, an honest one the decoder can read included, is a final void
  before `MaxAttempts` lifetimes have each failed it
  (`RuntimeVoidOnlyAfterAttempts`);
- each lifetime counts at most one runtime failure
  (`AttemptsWithinLifetimes`), so a process a trap left unusable cannot spend
  another update's attempts.

Its liveness property `DeviceEventuallyCurrent` requires that, once writes
stop, every device holds exactly what a fresh reader on its own decoder holds,
voiding its final voids too. So a device on the newest decoder eventually
imports every honest update, even one an older decoder voided before the
device upgraded, unless `MaxAttempts` lifetimes each failed it there.

Nine negative controls each relax one rule, and the negative-control check
asserts the named violation on every run:

- `RefuseVoid = TRUE` is the behavior before #3135: a void fails the whole
  pass, so one false span stops every later update from reaching the device.
  `DeviceEventuallyCurrent` fails.
- `ImportCarriedOps = TRUE` imports what a mismatched payload carries. An
  underclaim's hidden operation reaches a device: `VoidNeverApplied` fails.
  Without that invariant `ProcessedDevicesAgree` fails next, because a device
  already covering the span is never served the underclaim.
- `PullUsesCursor = FALSE` filters by frontier alone, so an overclaim is
  served on every pull: `ServedOnceAfterProcessed` fails.
- `KeepCursorOnUpgrade = TRUE` keeps the cursor across a decoder upgrade. A
  device that voided an update it could not decode never judges it again:
  `ProcessedDevicesAgree` fails against a device that upgraded first.
- `IgnoreCursorVersion = TRUE` keeps the cursor after the local state is
  replaced by an older copy, so the device never pulls what it lost:
  `ProcessedDevicesAgree` fails.
- `IgnorePullPremise = TRUE` records the cursor of a pull upgraded between its
  pages. The server served it from a cursor the old decoder stood for, so an
  update the old decoder voided is never judged again:
  `ProcessedDevicesAgree` fails.
- `MemoizeRuntimeFailure = TRUE` makes a runtime failure a final void at once,
  as a plain memoized void would, so an honest update one trap hit is lost on
  that device: `RuntimeVoidOnlyAfterAttempts` fails.
- `CountEveryFailure = TRUE` counts every runtime failure, so one poisoned
  process spends several attempts: `AttemptsWithinLifetimes` fails.
- `CursorPastUnsettled = TRUE` records the cursor of a pull held at an
  unsettled update, so the update is never served again and the device never
  holds it: `ProcessedDevicesAgree` fails against a device whose runtime did
  not fail.

Outside the model: the rotation-baseline redirect of a pull's first page,
which skips only updates after the cursor that the baseline covers
([`BaselineDominance`](./BaselineDominance.md) checks that gate); AEAD
failures, which stay availability failures until a
writer-signed key commitment exists; the content-key fingerprint that drops a
void judged under another key; duplicate update ids, which still fail a page;
container metadata documents, which void but keep no cursor; a pull's pages
beyond the collapse above, and a cursor dropped between them, which abandons the
pull as an upgrade does; the per-page rebuild budget, whose deferred updates are
served again as a shorter page would leave them; the retry delay between a
process's attempts and its uncounted later failures, which only hold a pull as
a stutter would; a payload that kills the process outright, which records no
attempt; the record of import voids
that spares a device a second import of an update under the same judge and key;
and devices' own writes. An honest writer depends only on operations committed
before its update. A dishonest writer that forges a dependency on a
later update can make a device that judges an update again (after an upgrade or
a replaced state) accept what a device judging in server order voided; that is
left to the forged-dependency follow-up.

The configuration bounds two devices, two updates, two decoder versions, one
state replacement, and two attempts over two process lifetimes on one device
whose runtime can fail (`FaultyDevices`); the other device stands for readers
whose runtime never fails. TLC explores 1,159,789 generated and 386,593
distinct states at depth 21 in about 46 seconds with one worker. Before runtime
failures the same bounds explored 51,547 distinct states, and three updates
also passed (1,398,292 distinct states in about 5 minutes with one worker).
This is exhaustive bounded model checking, not an unbounded proof.
