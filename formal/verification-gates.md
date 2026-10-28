# Verification Gates

This page maps two keying requirements to the executable evidence that enforces
them: no device is ever bricked by another device's cache or write, and the
keying verifiers refuse forged, rolled-back, or spliced state while accepting
its honest twin. Every check below runs in `bun run check:fast` and the pre-push
gate.

## No-bricked-device model

The [NoBrickedDevice model and mapping](./container-keying/NoBrickedDevice.md)
carries this requirement. One dependent/authority relation represents either a
descendant container citing an ancestor or a group policy citing Admins. The
implementation traces exercise both interpretations and a container's
historical group membership.

| Requirement | Executable evidence |
| --- | --- |
| Heads, independent checkpoints, lag, and revocation | `NoBrickedDevice.tla`: `AdvanceAuthority`, `RevokeLateSigner`, `CommitDependent`, and per-device `checkpoint` / `authorityCheckpoint` |
| Refuse forks, rollback, regressing citations, and authority below a citation | `HeldChainNeverContradictsCheckpoint`, `CheckpointsAreMonotone`, `HeldCitationsNeverRegress`, `HeldAuthorityCoversHeldCitation`; adversary configuration and matching negative controls |
| Progress without another device's cache or write | `DeviceEventuallyCurrent` (reads) and `DeviceEventuallyWrites` (the device's own `DeviceWrite`, accepted only at the current heads) with weak fairness only on each device's `HonestSync` and `DeviceWrite`; no fairness on server-side writes |
| Stale-head and stale-chain currency rules break liveness | `no-brick-stale-head-citation` and `no-brick-stale-chain-citation` in the [negative-control registry](../scripts/protocol/protocolNoBrickNegativeControls.ts) require the temporal violation of `DeviceEventuallyCurrent`; `no-brick-writer-waits-for-fresh-dependent` requires that of `DeviceEventuallyWrites` |
| Implementation-to-model projection | [Projection runner](../scripts/protocol/checkNoBrickProjection.ts): four scenario tests record six traces, covering container ancestor citations, group membership, historical policy, and principal-policy citations; six deliberately corrupted projections must fail |
| Registration, checked mapping, and push gate | Both configurations in [protocol-models.txt](./protocol-models.txt); mapping registered in [lintFormalAbstractionMaps.ts](../scripts/protocol/lintFormalAbstractionMaps.ts) |

The [model's configurations](./container-keying/NoBrickedDevice.md#registered-configurations)
state its bounds and explored state counts. The authority's genuine history is
abstracted as version numbers; cryptographic verification and durable storage
are outside the model. Its [boundary](./container-keying/NoBrickedDevice.md#boundary)
also explains the accepted, unobserved split-view residual.

## Verifier properties

`fast-check` is pinned in the root `testing` catalog and consumed only as a
crypto development dependency. The generators materialize signed events and
manifests, policy chains, key states, and checkpoints for the production
verifiers. `bun run test:protocol-conformance` runs every suite below.

| Requirement | Test and generator evidence |
| --- | --- |
| Manifest/event/checkpoint generators | [keyingArbitraries.testFixtures.ts](../packages/crypto/src/keying/keyingArbitraries.testFixtures.ts): grant/revoke/rekey plans, signed chain builders, local checkpoints, linked documents, and recipient key states |
| Policy generators | [keyingPolicyArbitraries.testFixtures.ts](../packages/crypto/src/keying/keyingPolicyArbitraries.testFixtures.ts): signed add/remove chains and checkpoint selection |
| Ancestor path generators | [keyingPathArbitraries.testFixtures.ts](../packages/crypto/src/keying/keyingPathArbitraries.testFixtures.ts): a generated root history and two or three child edges, each creation verified with its full authorizing path |
| Forged grant, omitted target, swapped recipient key | [keyingProperties.test.ts](../packages/crypto/src/keying/keyingProperties.test.ts): mutated grants, missing document KEK targets, and swapped recipient fingerprints |
| Split projection, key-epoch reuse after shrink | Same suite: unsigned policy projection members and signed shrink without key rotation |
| Same-epoch fork and rollback below checkpoint | Same suite: container and policy checkpoint checks against independently valid signed alternatives |
| Stale manifest and inherited path authority | [keyingPathProperties.test.ts](../packages/crypto/src/keying/keyingPathProperties.test.ts): old signed manifest under a requested newer hash, removal of the authorizing root or cited parent, and splicing an unrelated authorizing root |
| Exhaustive Merkle prefix and inclusion matrix | [transparencyProofs.test.ts](../packages/crypto/src/keying/transparencyProofs.test.ts): all 2,145 pairs `0 <= m <= n <= 64`, all 2,080 leaf positions through size 64, independent iterative root oracle, and explicit 5-to-6 proof shape |
| Merkle mutation negatives | [transparencyProofMutations.test.ts](../packages/crypto/src/keying/transparencyProofMutations.test.ts): every node position of every nontrivial prefix and every inclusion proof through size 32; deletion, replacement, adjacent swaps, extra nodes, wrong leaves/positions, and decoy checkpoints |
| Lean model parity | [transparencyLeanVectors.test.ts](../packages/crypto/src/keying/transparencyLeanVectors.test.ts): the [Lean model's](./lean/README.md) honest proofs through size 32 and its mutations through size 16, each reproduced by the production generator and reaching the model's outcome and refusal code |

Each forged case has an accepted honest twin, and the mutation matrix checks
its own honest proofs before mutating them, even when run alone. The path
generators build genuine ancestor paths, and the path properties distinguish
requested-hash freshness from rollback against a local checkpoint.

Shared crypto authorization requires a path with a root, contiguous parent IDs,
one organization, and no repeated container IDs. The current and historical
access folds enforce this before combining grants from individually verified
heads; the state-only fold is a calculation over already-trusted states. The
API and SDK check path structure independently. Creation-time parent hashes
need not equal served heads: honest ancestor advancement and historical
citations remain accepted, as the no-brick projection traces verify.

Keying properties run eight generated cases each; transparency properties run
forty each with trees up to 192 leaves. These randomized runs shrink failures
and report replay seeds. They are bounded tests, not exhaustive coverage of all
keying histories. The independent root oracle shares the production
domain-hash primitive, and the TypeScript generators produce the proofs. The
only machine-checked results are the [Lean](./lean/README.md) theorems for
Merkle completeness through size 32, which are about the model. The unbounded
completeness and soundness theorems are stated but unproved. The grant algebra,
revocation and re-grant, and checkpoint monotonicity are covered by these tests
and the bounded models, not by theorems.

## Reproduce the gates

With the mise-pinned tooling installed:

```sh
bun run check:protocol-models
bun run check:protocol-negative-controls
bun run check:no-brick-projection
bun run lint:formal-maps
bun run test:protocol-conformance
```

The Lean proofs need their own toolchain (about 2.8 GB):

```sh
mise install github:leanprover/lean4
bun run check:protocol-proofs
```
