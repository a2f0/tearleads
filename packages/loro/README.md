# @tearleads/loro

Build support for [Loro](https://loro.dev), the CRDT library behind document
sync.

`@tearleads/loro/bun-plugin` exports `loroWasmPlugin` for Bun build scripts.
It resolves Loro to its supported base64 entrypoint, embedding WASM and its
JavaScript glue in the resulting bundle or standalone executable. Use it for
browser builds and `Bun.build({ compile: ... })` builds so deployment does not
require files from `node_modules`. Runtime consumers import the regular
`@tearleads/loro` entrypoints.

## Change timestamps

`createDocument` is the only way to make a document that authors. It turns on
Loro timestamp recording, so every change carries the Unix time, in seconds, of
its commit, and a writer's consecutive commits share a change only within
`DOCUMENT_CHANGE_MERGE_INTERVAL_SECONDS` of its timestamp. The setting belongs
to the document instance rather than its exported bytes: a bare `new LoroDoc()`
that edits would stamp the newest time it has imported instead of the current
one. Read-only scratch documents may be bare; `fork()` keeps the setting.

## History timeline

`openHistoryViewer` takes a scratch document from `createReadOnlyDocument` that
already holds the history to browse, and returns its changes as ordered `stops`
with `checkout(index)` and `versionAt(index)`. `orderHistoryStops` is the pure
ordering: recorded time, then Lamport time, then peer, with a change never
placed before one it depends on, so every prefix is a real version whatever the
clocks recorded. The viewer keeps its document detached, so it cannot be
edited; never hand it a document that is being edited.

## History segments

`exportHistorySegments` splits the whole history a document holds into
ordinary update blobs, its segments, that rebuild the document when a reader
imports them in order through `importUpdates`. It returns a generator that
exports each segment when the caller asks for it, so a caller that hands each
one on never holds the history twice. Each segment carries its index and the
vectors `getUpdateVersionVectors` reads from it. An empty document has no
segments. Nothing calls it yet: it is the first step toward a rotation
baseline that is a run of updates instead of one snapshot.

- **Cuts.** A segment may start and end at any counter of any peer: between
  changes, inside a change, or inside one long text or list insert. The
  [history identity](#history-identity) depends only on a history's units, so
  a reader of the segments computes the writer's `exportFullHistoryIdentity`
  however Loro regroups the pieces, and `updateMatchesDocumentHistory` holds
  for every segment on every holder of the same history.
- **Order.** Changes are taken by Lamport time, then peer, and a segment is a
  stretch of their counters. A change's Lamport time is past that of every
  operation it depends on, so every change comes after what it depends on. A
  cut inside a change leaves its head at the end of one segment and its rest
  at the start of the next, and the rest depends only on the counter before
  it. So each segment extends a real version: per peer the segments are
  gapless from zero, each peer's share of a segment is one span, and a
  segment depends only on the segments before it. The order does not rest on
  Lamport times being honest: a change is never placed before one it depends
  on. `historySegmentsImportInOrder` checks both properties from the declared
  vectors of any list of segments. It cannot tell that a tail is missing.
- **Size.** A segment aims for `targetBytes` and never exceeds `maxBytes`,
  both measured on the plaintext blob: 4 MiB and 16 MiB unless the caller
  says otherwise (`DEFAULT_HISTORY_SEGMENT_TARGET_BYTES`,
  `DEFAULT_HISTORY_SEGMENT_MAX_BYTES`). A size is known only after an export,
  and a counter is one code point, one list element or one whole operation,
  not a number of bytes. So a candidate is a number of counters, sized from
  the bytes per counter of the last export, and kept when it fits the cap. A
  candidate over the cap is exported again with at most half its counters,
  sized by what the first export measured.
- **Exports.** A segment whose first candidate held `n` counters takes at most
  `1 + ceil(log2(n))` exports. A second export happens only where the bytes
  per counter rise by more than the cap is of the target, so a history of
  even density takes one export per segment. An export reads only its own
  range, so cutting one long insert does not read the insert again for each
  piece. The first candidate assumes one byte per counter, so a history of
  large values is exported whole once before its first segment is sized.
- **One counter.** A counter is the smallest thing an update carries. One
  whose own update is larger than the cap, such as one map value or one list
  element, cannot be cut. The generator throws
  `HistorySegmentCounterTooLargeError`, with the peer and counter, when it
  reaches that counter; it has handed over the segments before it by then.
  The value is the author's own data, so the error is final for that cap: a
  caller reports that the history cannot be segmented and does not retry.

Segmenting one document twice gives the same bytes, and a holder restored
from its snapshot gives them too. `exportHistorySegmentRange` gives a
segment's bytes again from its declared range, and goes on giving them while
the document gains history, so a caller can check a segment it kept against
the document before relying on it. Loro's encoding of a range depends on the
order its spans are given in, so both functions give them in peer order.

Another holder of the same history cuts elsewhere when it groups operations
into other changes. A reader of the segments holds a cut change in parts, so
its own segments have other ranges and other bytes; they carry the same
history, and each matches every holder.

`updateMatchesDocumentHistory` first compares a blob with the holder's own
export of the same range, and expands operations only when the bytes differ.
It gives that export its spans in the order the blob's vectors list them. On
the document a segment came from, that finds a segment of one peer equal at
once. For a segment of several peers the two orders can differ, and on
another holder the changes can; it then compares canonical forms, which
gives the same answer at more cost.

A reader pays for each import against the state it already holds. Importing
the 13 segments of a 51 MiB history one at a time into an attached document
took 7.7 s; one `importUpdates` call with all of them, or imports into a
detached document followed by one `checkoutToLatest`, took about 0.5 s, the
time of the one whole update.

[`historySegments.test.ts`](./src/historySegments.test.ts) checks all of this
at small sizes: generated histories of two or three writers, one commit cut
inside its text and list inserts, one insert many times the cap, and one
counter over it.

## History identity

`exportFullHistoryIdentity` is the canonical form of a document's operations,
and `updateMatchesDocumentHistory` compares a blob with it. Rotation proofs
and the sync judge rest on both, so two things must hold:

- **Every holder of the same operations computes the same identity**, whatever
  path brought them: separate uploads, one batch, a snapshot, a snapshot and
  updates, or pieces cut at any counter. A false difference fails an honest
  device's rotation proof or voids an honest update.
- **Two histories that differ in anything that matters never share one.** A
  false equality lets a forged update or baseline pass as the genuine one.

### Units

The canonical form depends only on a history's units. A unit is what one
operation counter of one peer did, with the facts its change gives it:

- **Its dependencies, Lamport time, commit time and message.** A change's
  first unit carries the change's own. Every later unit depends on the counter
  before it and nothing else, has the next Lamport time, and has the same
  commit time and message.
- **A text insert** `{pos, text}`: unit `i` inserts code point `i` at
  `pos + i`.
- **A list or movable-list insert** `{pos, value}`: unit `i` inserts
  `value[i]` at `pos + i`.
- **A delete** `{pos, len, start_id}` in a text, list or movable list: with a
  positive `len`, unit `i` deletes id `start_id + i` at `pos`, as the delete
  key does; with a negative one, unit `i` deletes id
  `start_id + |len| - 1 - i` at `pos - i`, as backspace does. A delete of one
  element has no direction.
- **Everything else** is one unit that stays whole: map sets and deletes,
  marks and their ends, tree operations, counter increments, and movable-list
  sets and moves. Each takes one counter.

Loro groups units into operations and changes by the path that brought them.
It stores a peer's changes in blocks of about 4 KiB and joins an imported
change to the one before it only while the block has room, so a reader of two
updates can hold one change as two, cut where the writer has no cut, and one
run of deletes as two operations.

### The canonical form

The form regroups the units, the same way for every holder:

- **Canonical changes.** A unit starts a canonical change when it is its
  peer's first in the history or range, when its dependencies are not exactly
  the counter before it, when its Lamport time is not the next one, or when
  its commit time or message differs from the unit before it. Otherwise it
  continues the change, whichever of Loro's changes held it.
- **Runs.** Inside a canonical change, a unit joins the run before it when it
  is of the same kind, in the same container, at the next counter, and
  continues it: an insert at the position after the run, a delete forward
  (same position, next id) or backward (previous position, previous id). A
  run of deletes keeps the direction its second unit took, because direction
  says which counter deleted which id.
- **Whole operations** stay as Loro exported them. So does an insert or delete
  with a field this package does not know, which joined would lose it.

Each run and canonical change says exactly what its units are, so the form
gives back the units, and equal forms mean equal units. Dependencies are
sorted, since they are a set. An export's `start_version` is left out: it is
the frontier of a range's start as the exporting document sees it, and the
range's first counters already say where it starts.

`updateMatchesDocumentHistory` imports the blob into a scratch document that
holds what the blob's range builds on and none of the range, then compares
the range that document holds with the reader's, both in canonical form. The
range is cut out of the scratch document on purpose. Another peer's operation
that a later part of the range depends on can itself depend on an earlier
part, and Loro takes a held operation that arrives again with another commit
time or message as already held, so a document that held that part would
report its own and hide a forgery. Loro 1.19.1 also panics
(`counter should be continuous`) on some such imports: a document forked from
another, or loaded from a snapshot, that imports an update repeating a change
it holds in two parts, before anything has read its changes. The first test
of [`historyOverlap.test.ts`](./src/historyOverlap.test.ts) builds one.

### What the tests prove

- [`historyUnitModel.test.ts`](./src/historyUnitModel.test.ts): Loro reads a
  generated history taken apart into one operation and one change per counter
  as the same document; every grouping of one history's units has one form;
  and the form gives back exactly the units.
- [`historyRuns.test.ts`](./src/historyRuns.test.ts): by hand, which units
  join and which stay apart, including delete runs in both directions, gaps in
  counters, unknown fields, and the one counter each whole operation takes.
- [`historyChangeSplits.test.ts`](./src/historyChangeSplits.test.ts): inserts,
  delete runs and mixed changes cut across Loro's storage blocks keep their
  identity, and each piece matches every holder.
- [`historyHolders.test.ts`](./src/historyHolders.test.ts): generated
  histories of two or three writers, held by writers and by readers of every
  path, have one identity, and every honest upload, snapshot and segment
  matches every holder.
- [`historySoundness.test.ts`](./src/historySoundness.test.ts): each kind of
  forgery, by hand and applied at random to generated histories, changes the
  identity and matches no holder.
- [`historyOverlap.test.ts`](./src/historyOverlap.test.ts): an update whose
  own dependencies descend from part of it matches every holder, and a forgery
  of that part matches none.
- [`historyGrouping.test.ts`](./src/historyGrouping.test.ts),
  [`historyIdentity.test.ts`](./src/historyIdentity.test.ts) and
  [`historyDeletionIdentity.test.ts`](./src/historyDeletionIdentity.test.ts):
  the regressions that came first.

The generated histories come from a seed: the edits, the commit times (passed
to each commit, never read from the clock) and the way each holder was fed.

## Import refusals

Import blobs through `importUpdates` and `importSnapshot`, never through a
document's own `import`. Loro throws its refusals as bare strings; these
helpers name the ones callers act on:

- `LoroReusedOperationIdError`: the blob carries an operation id the document
  already holds with other content. It names the first such id Loro met. The
  sync judge voids the update and, when the update's declared span reuses ids
  under the peer this device writes with, records a
  [preemption notice](../../docs/advisory-op-spans.md#preemption-notices).
- `LoroImportUnresolvedDependenciesError`: the blob depends on operations the
  document lacks, which Loro keeps as pending.

`importUpdates` is not all-or-nothing. When one update of a batch is refused
on its own, it throws and the document keeps what the other updates brought.
Operations a document already holds import again as a no-op.

## Text writes

Write a document's text through `updateText`, never through a text
container's own `update`. Loro's diffs run in one synchronous WebAssembly call
and take time quadratic in how much of the text differs, so `updateText` gives
each one `TEXT_DIFF_BUDGET_MS` and falls back when it runs out. A diff that
runs out leaves the document as it was. The result says how the write was
expressed, which decides how it merges with a concurrent edit:

- `character`: only the characters that differ were deleted and inserted. An
  ordinary edit or paste takes this path.
- `line`: only the lines that differ were. A concurrent edit inside a line the
  write kept merges into it; one inside a rewritten line loses its
  surroundings.
- `whole`: every character held was deleted and the new text inserted. A
  concurrent insert survives, without any of the text it was written into.

## Runtime contract

[`runtimeContract.test.ts`](./src/runtimeContract.test.ts) pins behavior of the
exact Loro version that document sync is built on:

- One large text insert imports into a non-empty document in bounded time.
  Loro 1.16.4 took time quadratic in the insert's size.
- While an update is pending under a document's own peer id, Loro refuses that
  document's local writes with `ConcurrentOpsWithSamePeerID`. The way out is a
  fresh peer id. Sync never leaves such an update in a live document: the
  judge voids an update whose dependencies no earlier update carries before it
  reaches one.

[`textUpdate.test.ts`](./src/textUpdate.test.ts) pins what `updateText` relies
on: a diff past its `timeoutMs` throws an `Error` whose message is
`Update timeout`, and leaves the document as it was.

See [dependency maintenance](../../docs/dependency-upgrades.md#current-constraints)
for what moving the Loro pin requires.
