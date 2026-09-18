# Formal Model Audit and Recommendations

Audit the existing TLA+ models and recommend fixes or additions in the report.
Do not implement those recommendations during the audit, including in scratch
copies. Models, configurations, negative controls, trace fixtures, registries,
and model documentation remain unchanged. Implementation belongs to a separate
follow-up task; do not create or commit a model-change branch.

The models do not prove the code correct. They explore rules within configured
bounds, and their assumptions and mappings to production must also be audited.

## Audit existing coverage

Read `formal/README.md` and the documentation of every relevant module. Review
the actual `.tla` and `.cfg` files, registered configurations in
`formal/protocol-models.txt`, negative controls in
`scripts/protocol/protocolNegativeControls.ts`, and trace projections.

- Compare model actions, guards, and assumptions with the production call
  paths. Identify where a model describes a proposed fixed rule while
  production still behaves like a vulnerable negative control.
- Check that invariants and temporal properties express the claimed harm,
  including the no-brick rule. Look for missing behaviors, vacuous properties,
  and bounds or fairness assumptions that exclude a reachable failure.
- Check that negative controls exercise the intended rule and name the
  expected violation. Review abstraction maps and trace coverage for drift.
- Report model defects and coverage gaps even when no production bug is
  confirmed. Distinguish a model counterexample from a verified production
  finding, and do not treat a passing bounded check as proof of correctness.

## Run existing checks

Use the mise-pinned Java and TLA+ tools for checks relevant to the audited
scope, without changing model inputs or registering new cases:

```sh
bun run check:protocol-models             # registered model/config pairs
bun run check:protocol-negative-controls  # existing expected violations
bun run lint:formal-maps                  # model tokens and production seams
bun run check:no-brick-projection         # verifier runs vs NoBrickedDevice
bun run check:protocol-traces             # trace fixture drift, no generation
bun run check:protocol-projection         # implementation trace projection
```

Keep logs, TLC metadata, and captured counterexamples outside the checkout. To
inspect an existing configuration directly, follow `runTlc` in
`scripts/protocol/tlcTools.ts` and use a scratch `-metadir`. Do not regenerate
fixtures or patch a model to make a finding reproducible. If existing coverage
cannot express the finding, report the gap and the validation a follow-up must
perform. Record checks not run and why.

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

## Recommend follow-up model work

For each model-shaped finding, name the existing module that should cover it,
or propose a new module if none fits:

| Finding shape | Module |
| --- | --- |
| Client refusal rule that honest data can trigger | `formal/container-keying/NoBrickedDevice.tla` |
| Grant subject or roster scope | `formal/container-keying/ContainerGrantScope.tla` |
| KEK, keyring, or wrap recovery | `formal/container-keying/KeyringReachability.tla` |
| Document sync, baseline, unlink, or tail settlement | the matching module in `formal/document-sync/` |
| Nothing fits | propose a new module beside the closest existing one |

Describe the recommendation in the report, without implementing it:

1. The missing or incorrect behavior, the production seam it maps to, and the
   rule or parameter and invariant or temporal property needed to express it.
2. The proposed fixed and vulnerable configurations, negative control, and
   expected violated property. Mark an expected counterexample as proposed
   unless it was actually observed with existing checks.
3. Any needed abstraction-map, model-documentation, registration, or trace
   projection updates and regression scenarios.
4. The follow-up validation commands, bounds, and expected outcomes, including
   the no-brick check. Do not invent state counts or claim unrun checks passed.

Recommend extending an existing module when its abstraction already contains
the needed objects. Recommend a new module when extending one would exceed
its documented boundary.

## Assess proposed client refusals

Evaluate every proposed client refusal against the no-brick rule using the
existing models and production paths. If validation needs a new parameter in
`NoBrickedDevice`, recommend that follow-up and require its honest
configuration to satisfy `DeviceEventuallyCurrent` and
`HonestServerNeverRefused`. Record that validation as pending; do not add the
parameter during the audit or describe the proposal as model-checked. A
refusal known to fail either property bricks devices and is not a valid fix.

## Report the model audit

For each finding, state one of:

- `TLA+: <module>; existing coverage: <coverage or gap>; observed checks:
  <results or not run>; recommended changes: <proposal>; pending validation:
  <checks needed>.`
- `Not model-shaped: <reason>; regression test: <test to add>.`

Summarize any observed counterexample step by step, with its configuration,
bounds, and actual state counts. Separate existing check results from proposed
work, and state that no formal-model changes were made during the audit.
