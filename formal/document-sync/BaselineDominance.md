# Document Baseline Dominance

[`BaselineDominance.tla`](./BaselineDominance.tla) models the no-data-loss gate
for document sync baseline redirection. A
[rotation baseline](../../docs/glossary/keys.md#rotation-baseline) is an
ordered group of ordinary updates, its segments, committed together at the
epoch a rotation opened. A baseline dominates an update exactly when both
conditions hold:

1. the update's content-key epoch is strictly older than the baseline epoch;
2. the baseline's coverage, the version its segments' signed spans reach
   together, componentwise covers the update's end version vector.

The model's baseline is a group of `SegmentCount` segments. `segmentOf` names
the segment that carries each update's operations, and a writer's group holds
exactly the updates its coverage covers. `storedSegments` are the segments the
server still holds as signed. The group is readable for a redirect only when
it is whole (`WholeBaseline`): the final segment signs the count and a digest
of the others, so the server can tell a whole group from one missing a
segment.

The abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `Dominated` | `isDocumentUpdateDominatedByBaseline` |
| `ReadableBaseline` / `WholeBaseline` | `loadLatestReadableBaselineCoverage`, the coverage of the group `loadLatestStoredDocumentBaselineGroup` returns: the newest one at the epoch whose stored segments all pass `judgeDocumentBaselineGroup` |
| `storedSegments` | a group's `document_updates` rows whose columns still give the metadata hash their header signs (`storedDocumentUpdateMetadataHash`) |
| `coverage` | the merged ends of the group's segments, which `judgeDocumentBaselineGroup` returns once their spans run gapless from zero |
| `Serve` / `RedirectServed` | `listMissingSyncUpdatesForResponse` through `selectServedSyncUpdates` |

TLC explores the sync serve decision. The checked invariants require that:

- only dominated older updates are omitted from the response;
- every uncovered update is served;
- current-or-newer-epoch updates are served;
- every unserved update is carried by a stored segment of the baseline the
  reader is redirected to, while raw mode serves the complete retained missing
  frontier.

`NoDataLoss` is stated against `BaselineContains`, what the stored segments
actually carry, not against the `Dominated` predicate that guards the
redirect. A whole group carries exactly the updates its coverage covers. A
group missing a segment carries less than its coverage says, and is not
readable for a redirect.

## Negative controls

Four controls each flip one production rule and require TLC to report the
named invariant:

- `CheckVectorCovers = FALSE` omits an older update the baseline's coverage
  does not cover, violating `NoDataLoss`.
- `RequireWholeBaseline = FALSE` redirects through a group that is missing a
  segment, so an update only that segment carries reaches no reader,
  violating `NoDataLoss`.
- `RawModeServesAll = FALSE` redirects a raw-history read, violating
  `RawModeServesCompleteFrontier`.
- `RedirectKeepsCurrentEpoch = FALSE` drops every covered update rather than
  only older-epoch ones, violating `CurrentOrNewerUpdateIsServed`.

## Trace bridge

The invariants are stated with the same `Dominated`/`Older` operators that guard
the action, so TLC alone verifies the redirect decision relative to those
definitions, not the dominance definition itself. That same-predicate blind
spot is closed by the trace bridge:
[`BaselineDominanceTraceExport.tla`](./BaselineDominanceTraceExport.tla)
(registered alongside the base model) prints every served behavior of a bounded
configuration, `bun run generate:protocol-traces` canonicalizes those behaviors
into the committed fixture
[`BaselineDominanceTraces.json`](./BaselineDominanceTraces.json), and `bun run
check:protocol-traces` fails `check:fast` when the fixture drifts from the
model. The TypeScript replay suite
[`packages/api/src/documents/documentBaselineDominanceTraceReplay.test.ts`](../../packages/api/src/documents/documentBaselineDominanceTraceReplay.test.ts)
then drives every exported behavior through the real
`selectServedSyncUpdates`/`isDocumentUpdateDominatedByBaseline` kernels with
real Loro version vectors and through an independent componentwise-counter
oracle. A mutation that weakens `VectorCovers`, deletes the older-epoch conjunct
from `Dominated`, or bypasses raw-mode completeness changes the exported
behaviors, so it fails the fixture drift check, and, if the fixture is
regenerated, the kernel replay. The dominance semantics therefore have two
independent executable ground truths: the parity suite below and the replayed
TLC artifact, both run on every push and pull request via
`test:protocol-conformance`.

The export prints whether the baseline is readable and what it covers, which
is all the kernels receive. Which segment carries an update and which segments
are stored decide only whether a group is readable, so the fixture is the same
2,048 behaviors it was when a baseline was one record.

## Bounds

The checked configuration bounds the state space to two peers, counters from
zero through two, three content-key epochs, two arbitrary updates, and a
baseline of two segments: 758,268 distinct states. The TypeScript
bounded-parity test
[`packages/api/src/documents/documentBaselineDominance.test.ts`](../../packages/api/src/documents/documentBaselineDominance.test.ts)
independently constructs real Loro version vectors for the same bounds. It
checks 729 predicate cases, 39,366 normal and raw serve cases, and 4,374
missing-baseline cases. It also checks ordering, which the set-based TLA+ model
omits. The trace fixture uses a smaller export bound (two peers, counters zero
and one, two epochs, two updates: 2,048 behaviors) so the committed artifact
stays reviewable; the parity suite retains exhaustive coverage at the full
registered bound.

## Assumptions and model boundary

Distinct concurrent writers must have distinct peer IDs; otherwise a counter
does not identify one operation history. `getRuntimePeerSeed` grants the
persisted scoped seed to one live runtime; other concurrent runtimes in that
scope receive memory-only seeds cached by their domain scope. Persistent pane
namespaces retain separate device seeds, and the first runtime after a page
reload can reuse its device seed under the existing tab lock. Each record's
peer comes from that runtime seed, the signed-in user, and the record
(`recordPeerSeed`), so two identities on one device never share a peer.
Runtime seed regressions check isolation, stable reuse, and bounded
device-storage keys.
This mapping does not change the version-vector dominance predicate.

This is exhaustive bounded model checking, not an unbounded mathematical proof.
In the model, as in production, the server retains every accepted update, a
normal-mode read is redirected through the readable current-epoch baseline only
when that baseline dominates every omitted older-epoch update, and raw mode
always serves the complete retained missing frontier. Baseline contents are
end-to-end encrypted, so the server cannot verify what a segment carries;
`ReadableBaseline` is a group whose stored segments each authenticate against
their signed metadata hash and together pass the group rules
(`judgeDocumentBaselineGroup`): index order, the signed count and digest, and
spans that run gapless from zero. The model trusts that an honest writer's
segments carry what their signed spans declare, exactly as production does; a
writer that signs a span its payload does not match is outside the boundary,
and every reader voids that segment. The model commits a group whole, as one
transaction does, and does not model a group across requests. It also assumes
well-formed persisted version vectors and continued availability of that
current-epoch baseline. Cryptographic authenticity, database transactions, SQL
ordering, and Loro's own CRDT correctness remain outside the abstraction.
