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

The process can also die while it reads a pull (#3194): a payload that kills
it, or any other death. Its reads run inside a durable window naming the
pull's unsettled updates, and the next lifetime finds the window (`Die`,
`Start`). The window opens once the reader's history is built and closes with
the page's save, which imports the update, so a visible death inside it counts
whatever caused it: other work the process runs meanwhile, the document's own
size while saving, or a killer another tab in the same browser process read.
That falls in the residual above. A window that held one update, in a lifetime
that met no failure, counts an attempt toward it (`Kill`). Any other window
makes its updates suspects (`suspects`), and the device then pulls one update
at a time until it has passed them, so each is read alone and a later death
counts toward it. A death after the app was hidden counts nothing and isolates
nothing (`HiddenKill`): the user ended that lifetime, not the update. A
payload whose import always kills the process is a killer (`KillerPending`);
dying on it is the device's own processing outcome. Only devices in
`FaultyDevices` die visibly (`Kill`): the others stand for readers whose
runtime never fails nor ends their process while the app is visible, so on
them `FaultFreeDevicesCountNothing` checks that a hidden death counts nothing.
Production counts a visible death on any device.

The model collapses a pull's pages into one served inbox (`Pull`) and one
judging step (`Process`). A decoder upgrade may land between the two, which
stands for an SDK upgrade between pages while a continuation is persisted. The
server still serves from the cursor the first page sent, so such a pull leaves
the cursor as it was (`pullJudge`).

Writers are outside actors and devices only read. Commits, decoder upgrades,
state replacement, runtime failures, restarts, and deaths have no fairness.
Only server delivery (`Pull`) and the device's own steps are fair: processing
(`Process`), starting a new lifetime (`Start`), and dying on a killer (`Kill`
while `KillerPending`). So no device waits on another. Deaths other than a
killer's are bounded (`MaxDeaths`): a device whose user hides the app at every
death on a killer never counts it, which is the accepted residual.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `HonestCommit` | a span from `createPendingUpdateFields`, which never queues an empty span; `assertOutgoingDeclaredSpan` refuses an empty or inverted one |
| `Overclaim` / `Underclaim` | a modified client signing spans its payload does not carry, which the server stores once `assertOutgoingDeclaredSpan` finds the span non-empty and not inverted |
| `Pull` / `Uncovered` | `resolveSyncPullPagePlan` starting after `readProcessedThroughSequence`, then filtering by the request's version vector |
| `bound` | `createSyncPullPageResponse` returning the page plan's upper bound as `throughUpdateId` |
| `CursorSendable` | `readSendableProcessedCursor`, read by `readProcessedCursorForSync` before each store pull and by `readContainerMetadataProcessedCursor` before each container metadata pull |
| `Judge` / `Accepts` | `validateDocumentSyncUpdateImports` and `judgeUpdate`, which checks the decoded Loro metadata against the signed span before the scratch import, after `judgeDocumentSyncUpdateDecryption` checks the plaintext hash |
| `RuntimeFailure` / `attempts` | `judgeUpdate` returning `runtime_failure` for `isLoroRuntimeFailure`, `LoroRuntimeFailureLedger.noteFailure`, and `recordDocumentSyncRuntimeFailures`, which records the `loro_runtime` row and its `attempts` before the page is saved, and in the same transaction stops the lifetime's windows counting (`markLoroWindowsNotCountingInTransaction`) |
| `failedInLife` / `Restart` / `lifeAttempts` | `processLoroRuntimeFailures`, the ledger a process starts with, which counts only its first failure (`LoroRuntimeFailureLedger.hasFailed`); its first failure anywhere also calls `noteFailed`, whose marker makes `judgeOrphanWindow` isolate a window that lifetime held open (`endedFailed`); a window row `settleDocumentSyncLoroWindow` cannot delete keeps that marker standing (`noteUnsettledWindow`), and a claim in one database does not drop it (`forget`), since that lifetime's windows may stand in another |
| `Die` / `Pending` | `openDocumentSyncLoroWindow`, which commits the page's unsettled updates as a `document_loro_windows` row once `validateDocumentSyncUpdateImports` has built the reader's history and before it reads the first update (`beforeUpdateReads`); `closeDocumentSyncLoroWindowInTransaction` deletes it in the page's save, and `settleDocumentSyncLoroWindow` deletes it when no save commits. Each sync pass holds its own window (`DocumentSyncLoroWindow`) and deletes only the row that window wrote (`deleteOwnLoroWindowInTransaction`), so two passes on one scope never settle each other's. The model's one window is the union of a lifetime's open windows across documents, passes, and databases: a row counts only while it is the lifetime's only open window (`openWindowCount`), and opening a second stops every row of the lifetime counting, in its transaction (`markLoroWindowsNotCountingInTransaction`) and in each other database the lifetime has a window open in (`stopCountingElsewhere`). A read of served updates no window covers (container metadata, rotation, a founding view) keeps the lifetime's failure marker standing while it runs (`beginUnwindowedRead` in `validateDocumentSyncUpdateImports`), so the model's one window holds no counting update during it; a windowed judgement holds that mark only while building its reader's history, and drops it while its window waits at the gate, where it runs no Loro work. A claim judges each orphan by the markers it read before deleting any row |
| `Kill` / `Start` | `claimDocumentSyncOrphanWindows` in the next lifetime: `createLoroLifetimes` tells an ended lifetime by its released Web Lock, `claimOrphansInTransaction` settles only an orphan its own delete removed (`deleteLoroWindowInTransaction`), so two tabs count one death once even though the database worker does not isolate their transactions, and `judgeOrphanWindow` counts a window `loroWindowCounts` opened as counting. A window isolating suspects reads alone through the lifetime's window gate (`transitionLoroWindowGate`), as the model's fairness on deaths assumes an isolated read does |
| `HiddenKill` | the hidden marker `createLoroLifetimes` keeps in `localStorage` while the app is hidden with a window open; `judgeOrphanWindow` discards a window whose lifetime `endedHidden`. A lifetime that cannot keep markers (`keepsMarkers`) opens only windows that count nothing |
| `suspects` | `document_loro_isolation`, through `transitionLoroIsolation`; `readDocumentSyncPageLimit` makes the next pull send `maxPageUpdates`, and `listMissingDocumentUpdatePage` caps its page there |
| `finalVoid` | a `loro_runtime` row with `MAX_LORO_RUNTIME_ATTEMPTS` attempts, read back as a known void by `recordedImportJudgements` |
| `pullJudge` | the pull premise in `processedCursorTransition`: a pull's first page records its judge and sent cursor (`pullJudge`, `pullSentCursor` on `document_sync_progress`), and a later page under another premise is `abandoned` |
| `CursorPastUnsettled` | the `held` page position in `processedCursorTransition`, which abandons the pull, set from `hasHeldPull` |
| `Process` / `cursorVersion` | `recordDocumentSyncVerdictsInTransaction` as the commit side effect of a document's record save, or of `commitStoredMetadataMutation` through `containerMetadataVerdictRecorder`, recording the saved `snapshotEndVersion` |
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
- each lifetime counts at most one runtime failure or death
  (`AttemptsWithinLifetimes`), so a process a trap left unusable cannot spend
  another update's attempts;
- a death counts only toward the update alone in its window
  (`KilledAttemptsAreIsolated`), so it never spends the attempts of an update
  read beside others; a window spans the update's judgement and its save, and
  a death there that other work caused is the residual above;
- a device whose runtime never fails counts no attempt
  (`FaultFreeDevicesCountNothing`), so a user hiding or closing the app is no
  evidence against an update.

Its liveness property `DeviceEventuallyCurrent` requires that, once writes
stop, every device holds exactly what a fresh reader on its own decoder holds,
voiding its final voids too. So a device on the newest decoder eventually
imports every honest update, even one an older decoder voided before the
device upgraded, unless `MaxAttempts` lifetimes each failed it there.

Thirteen negative controls each relax one rule, and the negative-control check
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
- `RecordBeforeImport = FALSE` leaves no window, so a death counts nothing and
  every lifetime dies on a killer again: `DeviceEventuallyCurrent` fails.
- `IsolateKills = FALSE` isolates nothing after a death in a window of several
  updates, so a killer behind another update is served in the same page
  forever: `DeviceEventuallyCurrent` fails.
- `CountPageKills = TRUE` counts a death toward the first update of a window
  that held several: `KilledAttemptsAreIsolated` fails.
- `CountHiddenKills = TRUE` counts a death after the app was hidden as a
  visible one: `FaultFreeDevicesCountNothing` fails.

Outside the model: the rotation-baseline redirect of a pull's first page, which
skips only updates after the cursor that the baseline covers
([`BaselineDominance`](./BaselineDominance.md) checks that gate); AEAD failures
and content keys, which [`ContentKeyCommitment`](./ContentKeyCommitment.md)
checks; the content-key commitment that drops a void judged under another key;
duplicate update ids, which still fail a page; a pull's pages beyond the
collapse above, and a cursor dropped between them, which abandons the pull as an
upgrade does; the per-page rebuild budget, whose deferred updates are served
again as a shorter page would leave them; the retry delay between a process's
attempts and its uncounted later failures, which only hold a pull as a stutter
would; deaths while hydrating container metadata, rotating, or showing a
founding view, which open no window yet (#3194, D2b) and so count nothing,
since their reads keep the lifetime's failure marker standing, and a death in
the live apply after a page's save, when the update is already accepted; a
document isolating suspects that waits longer than the window gate allows (30
seconds) for other documents' windows to close, which then reads beside them
and counts nothing, so it only delays progress as a stutter would; the
record of import voids that spares a device a second import of an update under
the same judge and key; and devices' own writes. An honest writer depends only
on operations committed before its update. A dishonest writer that forges a
dependency on a later update can make a device that judges an update again
(after an upgrade or a replaced state) accept what a device judging in server
order voided; that is left to the forged-dependency follow-up.

The configuration bounds two devices, two updates, two decoder versions, one
state replacement, and two attempts over two process lifetimes on one device
whose runtime can fail (`FaultyDevices`); the other device stands for readers
whose runtime never fails. TLC explores 1,159,789 generated and 386,593
distinct states at depth 21 in about 46 seconds with one worker. Before runtime
failures the same bounds explored 51,547 distinct states, and three updates
also passed (1,398,292 distinct states in about 5 minutes with one worker).
[`VoidUpdateProgressKills.cfg`](./VoidUpdateProgressKills.cfg) checks deaths
with one decoder and no replacement: a killer at the second update and two
other deaths, hidden or not. TLC explores 187,782 generated and 72,460
distinct states at depth 27 in about 8 seconds; the four death controls run
against it. The main configuration has no killer and no other death, so its
state space is the one above. This is exhaustive bounded model checking, not
an unbounded proof.
