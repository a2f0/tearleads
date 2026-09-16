# Verification Gates F1 and F2

Audit of [#2192](https://github.com/a2f0/tearleads/issues/2192), September 2026.
F1 and F2 are complete at the bounds below. They establish the roadmap's
prerequisites for starting F3; they do not establish the Lean theorems in F3
or F4.

## F1: no-bricked-device model

The existing [NoBrickedDevice model and mapping](./container-keying/NoBrickedDevice.md)
already satisfy F1. One dependent/authority relation represents either a
descendant container citing an ancestor or a group policy citing Admins.
The implementation traces exercise both interpretations and a container's
historical group membership. No additional currency rule is needed.

| Requirement | Executable evidence |
| --- | --- |
| Heads, independent checkpoints, lag, and revocation | `NoBrickedDevice.tla`: `AdvanceAuthority`, `RevokeLateSigner`, `CommitDependent`, and per-device `checkpoint` / `authorityCheckpoint` |
| Refuse forks, rollback, regressing citations, and authority below a citation | `HeldChainNeverContradictsCheckpoint`, `CheckpointsAreMonotone`, `HeldCitationsNeverRegress`, `HeldAuthorityCoversHeldCitation`; adversary configuration and matching negative controls |
| Progress without another device's cache or write | `DeviceEventuallyCurrent` with weak fairness only on each device's `HonestSync`; no fairness on writes |
| #2174 and #2173 currency rules break liveness | `no-brick-stale-head-citation` and `no-brick-stale-chain-citation` in the [negative-control registry](../scripts/protocol/protocolNegativeControls.ts) require the temporal violation of `DeviceEventuallyCurrent` |
| Implementation-to-model projection | [Projection runner](../scripts/protocol/checkNoBrickProjection.ts): five recorded traces, including container ancestor citations, group membership, and principal-policy citations; five deliberately corrupted projections must fail |
| Registration, checked mapping, and push gate | Both configurations in [protocol-models.txt](./protocol-models.txt); mapping registered in [lintFormalAbstractionMaps.ts](../scripts/protocol/lintFormalAbstractionMaps.ts); all checks in `check:fast` |

Rechecked from model revision `1e450d026259666586ea932897fcd72faf8ab26b`
on 2026-09-16, the honest configuration explores two devices and three versions
of each object: 78,678 generated states, 16,016 distinct states, depth 9. The adversary
configuration explores one device and the same version bounds: 136,428
generated states, 4,676 distinct states, depth 7. All nine model negative
controls remain registered. The authority's genuine history is abstracted as
version numbers; cryptographic verification and durable storage are outside
this model. The [model boundary](./container-keying/NoBrickedDevice.md#boundary)
also explains the accepted, unobserved split-view residual.

## F2: verifier properties

`fast-check` is pinned to `4.9.0` in the root testing catalog and consumed only
as a crypto development dependency. The generators materialize signed events
and manifests, policy chains, key states, and checkpoints for the production
verifiers. The conformance runner includes every suite below.

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

Each forged case has an accepted honest twin. The mutation matrix now checks
its own honest proofs before mutating them, even when run alone. Previously it
selected one replacement and swap position per proof despite a test name
claiming every position. The audit expanded that coverage, added genuine
ancestor paths (the earlier generators only built roots), and distinguished
requested-hash freshness from rollback against a local checkpoint.

Independent review also found that the crypto authorization helpers combined
grants from individually verified heads without checking their path structure.
A generated spliced-root regression failed before the fix. Shared crypto
authorization now requires a root, contiguous parent IDs, one organization,
and no repeated container IDs. The current and historical access folds enforce
this before combining grants; the state-only fold remains a calculation over
already-trusted states. The API and SDK already check path structure, so this
closes a standalone kernel gap, not a demonstrated endpoint bypass. Creation-time
parent hashes need not equal served heads: honest ancestor advancement and
historical citations remain accepted, as the F1 projection tests verify.

Keying properties run eight successful generated cases each; transparency
properties run forty each with trees up to 192 leaves. These randomized runs
shrink failures and report replay seeds. They are bounded tests, not exhaustive
coverage of all keying histories. The independent root oracle shares the
production domain-hash primitive, and proofs are still generated by TypeScript;
neither is the independent Lean vector source required by F3.

## Reproduce the gates

With the mise-pinned tooling installed:

```sh
bun run check:protocol-models
bun run check:protocol-negative-controls
bun run check:no-brick-projection
bun run lint:formal-maps
bun run test:protocol-conformance
```

All five commands are part of `bun run check:fast` and the pre-push gate.

## Remaining Lean work

F3 is the next step: define the exact Tearleads tree/hash shape in Lean, prove
generator/verifier completeness and prefix soundness under explicit abstract
hash assumptions, and export provenance-bearing vectors that the TypeScript
verifiers replay. Pin the Lean toolchain and dependencies, check vector drift,
and add `lake build` to CI with a measured runtime budget. The 5-to-6 regression
is covered by tests today, not a theorem. There are no Lean sources or pinned
Lean toolchain in this checkout yet.

F4 remains dependent on the Part C design decision in #2186: settle the access
and lineage rules before proving the max-fold grant algebra, descendant
relation, revocation/re-grant behavior, and checkpoint monotonicity. Its parity
vectors must then exercise the corresponding TypeScript kernels. Completing
F1/F2 neither ships transparency witnessing nor closes the whole roadmap.
