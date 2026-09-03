# Document Baseline Dominance

[`BaselineDominance.tla`](./BaselineDominance.tla) models the no-data-loss gate
for document sync baseline redirection. A baseline dominates an update exactly
when both conditions hold:

1. the update's content-key epoch is strictly older than the baseline epoch;
2. the baseline source version vector componentwise covers the update's end
   version vector.

The one-readable-baseline abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `Dominated` | `isDocumentUpdateDominatedByBaseline` |
| `Serve` | `listMissingSyncUpdatesForResponse` |

TLC explores the sync serve decision. The checked invariants require that:

- only dominated older updates are omitted from the response;
- every uncovered update is served;
- current-or-newer-epoch updates are served;
- every unserved update is carried by the readable baseline, while raw mode
  serves the complete retained missing frontier.

## Trace bridge

The invariants are stated with the same `Dominated`/`Older` operators that
guard the action, so TLC alone verifies the redirect decision relative to those
definitions — not the dominance definition itself. That same-predicate blind
spot is closed by the trace bridge:
[`BaselineDominanceTraceExport.tla`](./BaselineDominanceTraceExport.tla)
(registered alongside the base model) prints every served behavior of a bounded
configuration, `bun run generate:protocol-traces` canonicalizes those behaviors
into the committed fixture
[`BaselineDominanceTraces.json`](./BaselineDominanceTraces.json), and
`bun run check:protocol-traces` fails `check:fast` when the fixture drifts
from the model. The TypeScript replay suite
`packages/api/src/documents/documentBaselineDominanceTraceReplay.test.ts` then
drives every exported behavior through the real
`selectServedSyncUpdates`/`isDocumentUpdateDominatedByBaseline` kernels with
real Loro version vectors and through an independent componentwise-counter
oracle. A mutation that weakens `VectorCovers`, deletes the older-epoch
conjunct from `Dominated`, or bypasses raw-mode completeness changes the
exported behaviors, so it fails the fixture drift check — and, if the fixture
is regenerated, the kernel replay. The dominance semantics therefore have two
independent executable ground truths: the parity suite below and the replayed
TLC artifact, both run on every push and pull request via
`test:protocol-conformance`.

## Bounds

The checked configuration bounds the state space to two peers, counters from
zero through two, three content-key epochs, and two arbitrary updates. The
TypeScript bounded-parity test
`packages/api/src/documents/documentBaselineDominance.test.ts` independently
constructs real Loro version vectors for the same bounds. It checks 729
predicate cases, 39,366 normal and raw serve cases, and 4,374 missing-baseline
cases. It also checks ordering, which the set-based TLA+ model omits. The trace
fixture uses a smaller export bound (two peers, counters zero and one, two
epochs, two updates: 2,048 behaviors) so the committed artifact stays
reviewable; the parity suite retains exhaustive coverage at the full registered
bound.

## Assumptions and model boundary

This is exhaustive bounded model checking, not an unbounded mathematical proof.
The model reflects the post-pruning system: the server retains every accepted
update, a normal-mode read is redirected through the readable current-epoch
baseline only when that baseline dominates every omitted older-epoch update,
and raw mode always serves the complete retained missing frontier. Baseline
contents are end-to-end encrypted, so the server cannot verify what a baseline
carries; `hasBaseline` abstracts an authenticated baseline record that passed
replayability checks (`isAuthenticatedReplayableBaseline`), whose declared
coverage vector the model takes at face value, exactly as production does. The
model also assumes well-formed persisted version vectors and continued
availability of that current-epoch baseline. Cryptographic authenticity,
database transactions, SQL ordering, and Loro's own CRDT correctness remain
outside the abstraction. A future TLAPS or theorem-prover layer could prove the
parameterized invariant after this model has stabilized.
