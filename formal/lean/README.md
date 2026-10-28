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
| `Tearleads/Transparency/Theorems.lean` | The F3 theorem statements |
| `Tearleads/Transparency/Proof/*.lean` | Their proofs |
| `Tearleads/Transparency/Vectors.lean` | The cases in `vectors/transparency.json` |

Every recursive definition takes explicit fuel and recurses structurally on it.
The public wrappers pass the tree size, which always bounds the depth, and
`Proof/Fuel.lean` shows the fuel stops mattering once it covers the size.

## What is proved

`Theorems.lean` states the four F3 theorems for every tree size, and the
modules under `Proof/` prove them:

| Theorem | Statement | Proof |
| --- | --- | --- |
| `InclusionComplete` | For every tree size and leaf index, the honest audit path is accepted | `inclusion_complete` in `Proof/Inclusion.lean` |
| `InclusionSound` | Against an honest root, only the committed leaf is accepted at an index, whatever the audit path | `inclusion_sound` in `Proof/Inclusion.lean` |
| `ConsistencyComplete` | For every `previous <= size`, the honest consistency proof is accepted | `consistency_complete` in `Proof/Consistency.lean` |
| `ConsistencySound` | Against an honest current root, an accepted proof pins the previous root to the root of the current tree's prefix | `consistency_sound` in `Proof/ConsistencySound.lean` |

`consistency_complete_five_six`, the 5 → 6 proof #2186 refused, is one
instance of `consistency_complete`.

`#guard_msgs` pins each theorem's axioms to Lean's standard `propext`,
`Classical.choice`, and `Quot.sound`, so a proof that silently picks up
`sorryAx` or a native-code axiom fails the build. Each was checked against a
weakened model:

- Restoring the #2186 fold (dropping the `first = second` branch of
  `walkStep`) breaks `consistency_complete`.
- Accepting an inclusion proof without comparing roots breaks
  `inclusion_sound`.
- Skipping the previous-root comparison or the same-size equivocation check
  breaks `consistency_sound`.

The soundness theorems rely on the symbolic digest: `Digest.node` is
injective, so an accepted proof's nodes must be the honest ones. With a real
hash they read "or a collision exists".

## How the proofs go

The inclusion generator and verifier recurse on the same splits, so both
inclusion theorems are inductions on that shared recursion. The consistency
verifier is the RFC 9162 walk, which climbs the tree by halving indices while
the generator splits from the top. The consistency proofs never reason about
powers of two directly; they climb one level at a time:

- `Proof/Split.lean`: for 3 or more leaves the split point is twice the split
  point of half the size, rounded up.
- `Proof/Pairing.lean`: from that, a tree is the tree over its pair hashes, an
  odd last leaf carried up. Inclusion paths and subproofs split the same way,
  and for an odd previous size the subproof is the previous tree's last leaf
  followed by that leaf's inclusion path.
- `Proof/Walk.lean`: the walk over such an inclusion path reaches both roots,
  by strong induction on the current tree's size.
- `Proof/Consistency.lean`: an even previous size verifies as its half does
  one level up, which reduces every case to the odd one.
- `Proof/ConsistencySound.lean`: the same induction over arbitrary nodes. The
  previous tree's last leaf is unknown until the walk pins it down, so it is
  carried as a pointwise update of the leaf function.

`omega` handles all the arithmetic, because it only ever halves. Proofs stay
within Lean core; the package has no Lake dependencies, so its build needs no
network access.

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
- The theorems hold for the model at every size, not for the TypeScript. The
  vectors bind the two only on sizes through 32 leaves and the mutation set:
  a production divergence that shows only on larger trees or other inputs is
  not caught by the replay.
