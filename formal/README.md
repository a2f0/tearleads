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
`ContainerGrantScope` and `KeyringReachability` document their seams in prose in
the [model index](./models.md) and carry no map tables; `NoBrickedDevice`
carries one.

## Trace projections

The bridge also runs in the implementation-to-model direction:
`bun run check:protocol-projection` (part of `check:fast`) records
fault-injected runs of the real probe and interest seams and replays them as
action sequences through `RestartProbeConvergence` with TLC, failing on any
trace the model rejects. See the
[trace projection section](./document-sync/RestartProbeConvergence.md) for the
recorded scenarios, negative controls, and boundaries.

`bun run check:no-brick-projection` (also in `check:fast`) replays recorded runs
of the real container-path and principal-policy verifiers through
`NoBrickedDevice` the same way; see the
[trace projection section](./container-keying/NoBrickedDevice.md).

## Negative controls

`bun run check:protocol-negative-controls` (part of `check:fast`) checks selected
properties for sensitivity to faults: each entry in `scripts/protocol/protocolNegativeControls.ts`
flips one rule or lock in a registered configuration and requires TLC to
report exactly the named violation.

Negative controls do not establish general non-vacuity or action reachability.
See the [coverage audit](./audit-2026-09.md).

The [F1/F2 gate audit](./verification-gates.md) maps #2192's no-brick and
verifier-property requirements to executable evidence, records their bounds,
and identifies the remaining Lean proof and vector work.

## Adding a model

To add a model, commit its `.tla` and bounded `.cfg` files and register the
pair. One module may appear with multiple configurations, but each configuration
must appear exactly once. Keep registered bounds small enough for `check:fast`;
put broader configurations in a separate scheduled suite instead of lengthening
pull-request checks.

Document the model beside its module, register any abstraction-map table it
carries, and add a summary under its directory in the
[model index](./models.md).
