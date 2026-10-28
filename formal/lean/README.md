# Lean proofs

A Lean 4 proof layer for the keying transparency log, Gate F3 of #2192. Lean
never runs in production. The package states and proves properties of a model
of the TypeScript Merkle code, and binds that model to the production code
through a committed vector fixture that the TypeScript verifiers replay.

## Layout

| Module | Production counterpart |
| --- | --- |
| `Tearleads/Transparency/Tree.lean` | `computeTransparencyMerkleRoot`, `largestPowerOfTwoLessThan`, and the empty and node hashes in `transparencyTree.ts` |
| `Tearleads/Transparency/Generate.lean` | `createTransparencyInclusionProof` and `createTransparencyConsistencyProof` |
| `Tearleads/Transparency/Verify.lean` | `assertTransparencyInclusion` and `assertTransparencyConsistency` in `transparencyProofs.ts`, check for check, with the same refusal codes |
| `Tearleads/Transparency/Theorems.lean` | The F3 obligations and the bounded theorems proved so far |
| `Tearleads/Transparency/Vectors.lean` | The cases in `vectors/transparency.json` |

Every recursive definition takes explicit fuel and recurses structurally on it,
so the kernel can evaluate the model. The public wrappers pass the tree size,
which always bounds the depth.

## What is proved

`Theorems.lean` proves, by kernel evaluation with `decide +kernel`:

- `inclusion_complete_through_32`: every honest inclusion proof for every leaf
  of every tree up to 32 leaves is accepted.
- `consistency_complete_through_32`: every honest consistency proof for every
  `previous <= size <= 32` is accepted.
- `consistency_complete_five_six`: the 5 → 6 proof #2186 refused is accepted.

`#guard_msgs` pins that the two bounded theorems depend on no axioms, so a
proof that silently picks up `sorryAx` or a native-code axiom fails the build.
Restoring the #2186 fold (dropping the `first = second` branch of `walkStep`)
makes all three fail.

These results are about the model at bounded sizes. They are not the F3
theorems.

## Open obligations

`Theorems.lean` states the F3 theorems as `Prop` definitions, so they
type-check but claim nothing. Each becomes a `theorem` of the same name when
its proof lands:

| Obligation | Statement |
| --- | --- |
| `InclusionComplete` | For every tree size and leaf index, the honest audit path is accepted |
| `ConsistencyComplete` | For every `previous <= size`, the honest consistency proof is accepted |
| `InclusionSound` | Against an honest root, only the committed leaf is accepted at an index, whatever the audit path |
| `ConsistencySound` | Against an honest current root, an accepted proof pins the previous root to the root of the current tree's prefix |

The soundness statements rely on the symbolic digest: with a real hash they
read "or a collision exists". Proofs should stay within Lean core, which
includes `omega`, `simp`, and `grind`; the package has no Lake dependencies,
so its build needs no network access.

## Vectors

`lake exe transparency-vectors` prints `vectors/transparency.json`. Each digest
in it is named by the leaf range `[lo, size]` it is the root of, and each case
records the outcome the model reaches: `ok` or a `KeyingVerificationCode`.

- Honest inclusion and consistency proofs cover every size pair through 32 leaves.
- Mutations cover every pair through 16 leaves: appended, dropped, replaced,
  and swapped nodes, shifted roots, rollback, foreign and neighboring leaves,
  neighboring and out-of-range indexes.
- Cases labeled `empty-prefix-any-root` are accepted by design, because the
  empty tree is a prefix of every tree.

[`transparencyLeanVectors.test.ts`](../../packages/crypto/src/keying/transparencyLeanVectors.test.ts)
hashes the same ranges with the production domain hashes. It requires the
production generators to produce every honest proof and the production
verifiers to reach every recorded outcome, refusal code included. It runs in
`test:protocol-conformance` and the crypto package tests. Restoring the #2186
fold in `transparencyProofs.ts` makes it fail at the `honest 5 → 6` case.

## Running

The toolchain is pinned in `.mise.toml` and `lean-toolchain`, with checksums in
`mise.lock`. It installs about 2.8 GB, so it is not part of `check:fast`:

```sh
mise install github:leanprover/lean4
bun run check:protocol-proofs
bun run generate:protocol-proof-vectors
```

`check:protocol-proofs` requires the mise pin, `lean-toolchain`, and
`lake --version` to agree, builds the package with `lake build --wfail`, and
fails if the regenerated fixture differs from the committed one.
`generate:protocol-proof-vectors` rewrites the fixture instead.
`LEAN_TOOLCHAIN_ROOT` points both at a toolchain outside mise. Editors using
`elan` pick up `lean-toolchain` directly.

Both commands refuse `sorry`, `admit`, `native_decide`, `axiom`,
`implemented_by`, `extern`, and `unsafe` anywhere in the sources, comments
included. `--wfail` catches `sorry`, but the others build without a warning.

CI runs `check:protocol-proofs` in the `Lean proofs` job whenever this
directory, its tooling, or the pinned toolchain changes. The replay suite runs
on every change.

## Limits

- The digest is symbolic. The model assumes a collision-free hash with leaf,
  node, and empty-tree inputs kept apart. That holds only if callers pass leaf
  hashes from `computeTransparencyLeafHash`, never an arbitrary digest.
- Input normalization, log-id equality, and the proof-size versus
  checkpoint-size checks are outside the model. A proof's sizes are the
  checkpoint sizes.
- The vectors sample sizes through 32 leaves. A production divergence that
  only shows on larger trees, or on inputs outside the mutation set, is not
  caught by the replay. Once proved, the unbounded theorems hold for the
  model, not for the TypeScript.
