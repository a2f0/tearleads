# Protocol Models

This directory contains executable abstractions of protocol safety rules. The
models complement the runtime grammar in
[`docs/protocol-specification.md`](../docs/protocol-specification.md); they do
not replace Zod validation, cryptographic verification, database constraints,
or integration tests.

Run every bounded model with:

```sh
mise install java github:tlaplus/tlaplus
bun run check:protocol-models
```

The repository pins Java 21 and the prebuilt TLA+ tools; TLC itself requires
Java 11 or newer. No generated state directory or tool binary is committed.

[`protocol-models.txt`](./protocol-models.txt) is the pull-request model
registry. Each non-comment line pairs one repository-relative TLA+ module and
configuration as `model|config`. The checker validates the complete registry
before starting Java, rejects unregistered configuration files, sorts pairs
deterministically, and gives each TLC invocation an isolated state directory.

To add a model, commit its `.tla` and bounded `.cfg` files and register the pair.
One module may appear with multiple configurations, but each configuration must
appear exactly once. Keep registered bounds small enough for `check:fast`;
broader configurations should use a separate scheduled suite rather than
silently increasing pull-request check time.

## Document Baseline Dominance

[`document-sync/BaselineDominance.tla`](./document-sync/BaselineDominance.tla)
models the no-data-loss gate shared by document sync baseline redirection and
payload pruning. A baseline dominates an update exactly when both conditions
hold:

1. the update's content-key epoch is strictly older than the baseline epoch;
2. the baseline source version vector componentwise covers the update's end
   version vector.

The one-readable-baseline abstraction maps to production at these seams:

| Model action or predicate | Production implementation |
| --- | --- |
| `Dominated` | `isDocumentUpdateDominatedByBaseline` |
| `Prune` | `planDominatedUpdatePrune` |
| `Serve` | `selectServedSyncUpdates` |

The model's `live` set relies on `listMissingDocumentUpdates` excluding rows
whose encrypted payload has been cleared. Removing that query predicate would
break the modeled coupling between pruning a payload and omitting it from the
next sync response.

TLC explores every ordering of eligible prune actions followed by a sync serve
decision. The checked invariants require that:

- only dominated older payloads are pruned or omitted;
- every uncovered update is served;
- current-or-newer-epoch payloads remain live and are served;
- after serving, every unserved update is carried by the readable baseline.

The checked configuration bounds the state space to two peers, counters from
zero through two, three content-key epochs, and two arbitrary updates. The
TypeScript bounded-parity test
`packages/api/src/documents/documentBaselineDominance.test.ts` independently
constructs real Loro version vectors for the same bounds. It checks 729
predicate cases, 118,098 readable-baseline prune/serve transitions across both
candidate orders and limits zero through two, and 4,374 missing-baseline cases.
It also checks the order-preserving behavior that the set-based TLA+ abstraction
intentionally omits. The test does not consume TLC-generated traces, so the
explicit mapping above must stay synchronized as either side evolves.

This is exhaustive bounded model checking, not an unbounded mathematical proof.
The model assumes well-formed persisted version vectors, one same-document
baseline that has passed authenticated replayability checks, and continued
availability of that current-epoch baseline. The production prune planner may
choose among multiple historical baselines; cross-baseline retention is outside
this first model. Cryptographic authenticity, database transactions, SQL
ordering, and Loro's own CRDT correctness also remain outside the abstraction. A
future TLAPS or theorem-prover layer could prove the parameterized invariant
after this model has stabilized.
