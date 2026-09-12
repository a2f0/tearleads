# Formal Model Updates

Every audit updates `formal/` for its protocol-shaped findings. The models do
not prove the code correct. They show that a rule is load-bearing, reproduce
the vulnerability as a counterexample, and check that a proposed fix does not
break the no-brick invariant.

## Tooling

```sh
mise install java github:tlaplus/tlaplus
bun run check:protocol-models            # every registered model|config pair
bun run check:protocol-negative-controls # each control hits its violation
bun run lint:formal-maps                 # model tokens and production seams
bun run check:no-brick-projection        # verifier runs vs NoBrickedDevice
bun run test:protocol-models             # checker script self-tests
```

Read `formal/README.md` and the documentation of every module you change.

To print a counterexample trace, run TLC the way `runTlc` in
`scripts/tlcTools.ts` does, on a copy of the registered configuration with the
vulnerable constant substituted. Write the copy outside the checkout:

```sh
"$(mise which java)" -XX:+UseParallelGC \
  -jar "$(mise where github:tlaplus/tlaplus)/tla2tools.jar" \
  -workers 1 -metadir "$(mktemp -d)" \
  -config <derived.cfg> formal/<area>/<Module>.tla
```

## Classify each finding

Model-shaped findings change which behaviors are allowed over time:

- a client refusal or acceptance rule, including which membership or
  checkpoint option a verifier applies to a served projection;
- a commit-time guard or lock discipline in the API, such as a check-then-write
  race or a deleted row whose head remains current;
- ordering and monotonicity, such as checkpoints, rollback of a slot or head,
  or adoption of a pending write;
- recovery reachability, such as keyrings, rewraps, and stale bundles.

Not model-shaped: byte canonicalization, hashing and sort order, cryptographic
primitive use, schema validation, and authorization leaks with no state
machine. Record the reason and name the unit, property, or parity test that
should cover the finding instead.

## Choose the module

| Finding shape | Module |
| --- | --- |
| Client refusal rule that honest data can trigger | `formal/container-keying/NoBrickedDevice.tla` |
| Grant subject or roster scope | `formal/container-keying/ContainerGrantScope.tla` |
| KEK, keyring, or wrap recovery | `formal/container-keying/KeyringReachability.tla` |
| Document sync, baseline, unlink, or tail settlement | the matching module in `formal/document-sync/` |
| Nothing fits | a new module beside the closest existing one |

Extend an existing module when its abstraction already contains the objects
the finding needs. Add a new module rather than stretching one past the
boundary its documentation states.

## Encode the vulnerability

Keep `check:fast` green before production is fixed: register the fixed rule,
and make the vulnerable rule a negative control.

1. Add a boolean `CONSTANT` named for the rule and gate the relevant action or
   predicate on it. If no invariant or temporal property states the harm
   directly, add one (for example `HonestServerNeverRefused` or `NoDataLoss`).
2. Set the fixed value in every registered `.cfg` and run
   `bun run check:protocol-models`. If the fixed rule also violates a property,
   the proposed fix is wrong; revise it before reporting. This is how the
   #2173 and #2174 currency rules were shown to brick devices.
3. Add an entry to `NEGATIVE_CONTROLS` in `scripts/protocolNegativeControls.ts`
   with the vulnerable value, the exact expected violation kind and name, and a
   `why` that cites the issue and the production seam that currently behaves
   that way. Run `bun run check:protocol-negative-controls`.
4. Capture the shortest counterexample with the TLC command above and
   summarize it step by step for the report.
5. For a new module, commit its `.tla`, a bounded `.cfg`, and a `.md`, then add
   the `model|config` pair to `formal/protocol-models.txt`, listing each
   configuration exactly once. Keep bounds small enough for `check:fast`, and
   record generated states, distinct states, and depth in the documentation,
   as the existing model documents do.

## Document the mapping

- In the module's `.md`, describe the new parameter and add
  `Model action or predicate | Production seam` rows. Backticked model tokens
  must be declared in the module, and backticked seams must exist in
  production source, or `bun run lint:formal-maps` fails.
- State that production currently behaves like negative control `<id>` until
  the issue is fixed. The production fix PR removes that sentence.
- A new document with map tables needs its exact table count in
  `EXPECTED_TABLES` in `scripts/lintFormalAbstractionMaps.ts`.
- When the finding sits on a seam with a trace projection
  (`check:no-brick-projection` or `check:protocol-projection`), add a recorded
  scenario for the vulnerable shape if the real verifier can drive it.
- Keep prose wrapped at 80 columns; `bun run lint:markdown` checks it.

## Vet proposed client refusals

Before recommending a new client refusal, add it as a parameter to
`NoBrickedDevice` and confirm the honest configuration still satisfies
`DeviceEventuallyCurrent` and `HonestServerNeverRefused`. A refusal that fails
either property bricks devices and is not a valid fix.

## Report the model work

For each finding, the report states one of:

- `TLA+: <module> parameter <name>; negative control <id> violates <property>;`
  followed by a short step summary of the counterexample.
- `Not model-shaped: <reason>; regression test: <test to add>.`

Also list the branch, the commands run, and their results. Bounded model
checking explores only the configured bounds; do not describe it as a proof.
