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

Writers are outside actors and devices only read. Commits, decoder upgrades,
and state replacement have no fairness. Only server delivery (`Pull`) and the
device's own processing (`Process`) are fair, so no device waits on another.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `HonestCommit` | a span from `createPendingUpdateFields`, which never queues an empty span; `assertOutgoingDeclaredSpan` refuses an empty or inverted one |
| `Overclaim` / `Underclaim` | a modified client signing spans its payload does not carry, which the server stores once `assertOutgoingDeclaredSpan` finds the span non-empty and not inverted |
| `Pull` / `Uncovered` | `resolveSyncPullPagePlan` starting after `readProcessedThroughSequence`, then filtering by the request's version vector |
| `bound` | `createSyncPullPageResponse` returning the page plan's upper bound as `throughUpdateId` |
| `CursorSendable` | `readSendableProcessedCursor`, read by `readProcessedCursorForSync` before each store pull |
| `Judge` / `Accepts` | `validateDocumentSyncUpdateImports` and `voidedDocumentSyncUpdate`, after `decryptDocumentSyncUpdatesByEpoch` voids a payload whose decoded span differs from its signed one |
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
- two devices that processed the whole log with the same judge hold the same
  operations (`ProcessedDevicesAgree`).

Its liveness property `DeviceEventuallyCurrent` requires that, once writes
stop, every device holds exactly what a fresh reader on its own decoder holds.
So a device on the newest decoder eventually imports every honest update, even
one an older decoder voided before the device upgraded.

Five negative controls each relax one rule, and the negative-control check
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

Outside the model: AEAD failures, which stay availability failures until a
writer-signed key commitment exists; the content-key fingerprint that drops a
void judged under another key; duplicate update ids, which still fail a page;
container metadata documents, which void but keep no cursor; pagination within
a pull; the per-page rebuild budget, whose deferred updates are served again as
a shorter page would leave them; the record of import voids that spares a
device a second import of an update under the same judge and key; and devices'
own writes. An honest writer depends only on operations
committed before its update. A dishonest writer that forges a dependency on a
later update can make a device that judges an update again (after an upgrade or
a replaced state) accept what a device judging in server order voided; that is
left to the forged-dependency follow-up.

The configuration bounds two devices, two updates, two decoder versions, and
one state replacement. TLC explores 64,092 generated and 24,746 distinct states
at depth 14 in about 2 seconds with one worker. Three updates also pass
(581,002 distinct states in about 2 minutes with one worker). This is
exhaustive bounded model checking, not an unbounded proof.
