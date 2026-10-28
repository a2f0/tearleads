# Protocol Models

This directory holds executable protocol safety models. They complement the
runtime grammar in
[`docs/protocol-specification.md`](../docs/protocol-specification.md); they do
not replace Zod validation, cryptographic verification, database constraints, or
integration tests.

The [model index](./models.md) summarizes every registered model, grouped by
directory, and links each model's mapping document.

## Running the models

Run every bounded model with:

```sh
mise install java github:tlaplus/tlaplus
bun run check:protocol-models
```

The repository pins Java 25 LTS and the prebuilt TLA+ tools; TLC requires Java
11 or newer. No generated state directory or tool binary is committed.

[`protocol-models.txt`](./protocol-models.txt) registers `model|config` pairs.
The checker validates every pair and rejects unregistered configurations before
running Java. Each invocation has isolated state, JVM temporary files, and hosts
files. `PROTOCOL_TLC_PARALLELISM` controls concurrency (default 2); results print
in deterministic registry order.

## Abstraction maps

Model documentation that maps abstract actions to production seams does so in
`Model action … | Production …` tables; the registry in
`scripts/protocol/lintFormalAbstractionMaps.ts` pins which documents carry them.
`bun run lint:formal-maps` (part of `check:fast`) verifies every backticked
model token is declared in the module the table documents and every backticked
production seam occurs in production package source code, so a rename or
removal on either side fails the check instead of leaving the map prose-only.
The check proves that names exist, not that an action and its implementation
are semantically equivalent. `AncestorRecovery` and `KeyringReachability`
document their seams in prose in the [model index](./models.md) and carry no
map tables.

## Trace bridges

`BaselineDominance` exports every bounded behavior into a committed fixture that
the production kernels replay; see its
[trace bridge](./document-sync/BaselineDominance.md#trace-bridge).

Two checks run in the implementation-to-model direction.
`bun run check:protocol-projection` (part of `check:fast`) records
fault-injected runs of the real probe and interest seams and replays them as
action sequences through `RestartProbeConvergence` with TLC, failing on any
trace the model rejects. See the
[trace projection section](./document-sync/RestartProbeConvergence.md#implementation-trace-projection)
for the recorded scenarios, negative controls, and boundaries.
`bun run check:no-brick-projection` (also in `check:fast`) replays recorded runs
of the real container-path and principal-policy verifiers through
`NoBrickedDevice` the same way; see its
[trace projection section](./container-keying/NoBrickedDevice.md#implementation-trace-projection).

## Negative controls

`bun run check:protocol-negative-controls` (part of `check:fast`) checks selected
properties for sensitivity to faults: each entry in
`scripts/protocol/protocolNegativeControls.ts` flips one rule or lock in a
registered configuration and requires TLC to report exactly the named violation.

A control shows that removing one rule produces a failing path. It does not show
that every other property in the model is meaningful, that every action is
reachable, or that the intended successful path stays reachable with every
production rule on. Every registered model has at least one control.

## Limits of the suite

The models are exhaustive bounded checks, not proofs. Each registered
configuration runs in `check:fast`, so bounds stay small; there is no separate
broader-bound suite, and per-configuration action coverage is not recorded.
Cryptography, signatures, and SQL atomicity are abstracted at the seams each
mapping names. Many models include an always-enabled stuttering action, so a
clean TLC deadlock check is not evidence of useful progress; only the temporal
properties a configuration lists establish progress, and `[][A]_vars` action
properties are safety properties.

Model-specific gaps:

- `ContainerGrantScope` treats grant preparation and roster removal as atomic
  transitions, with no concurrent transaction model or group membership.
- `KeyringReachability` assumes every current member already holds the current
  KEK, and its properties share `Closure` with the recovery they check. It does
  not model what a revoked member already knows, so excluding revoked members
  from recovery is not a proof that they cannot derive later keys.
- `DeferredTailSettlement` checks durability and generation safety only; it has
  no eventual-settlement property.
- `RawHistoryRecovery` progress assumes awaited worker operations return; it
  does not cover retries, cancellation, or network failure.
- `RestartProbeConvergence` and the honest `NoBrickedDevice` configuration bound
  the number of server writes, so their eventual-convergence checks reach a
  quiescent server; they do not show catch-up under unbounded writes.
- `NoBrickedDevice` stops following a device after it accepts an undetectable
  forged branch.

The [verification gates](./verification-gates.md) page maps the
no-bricked-device requirement and the keying verifier properties to the
executable checks and property tests that enforce them.

## Adding a model

To add a model, commit its `.tla` and bounded `.cfg` files and register the
pair. One module may appear with multiple configurations, but each configuration
must appear exactly once. Keep registered bounds small enough for `check:fast`.

Document the model beside its module, register any abstraction-map table it
carries, and add a summary under its directory in the
[model index](./models.md).
