/-!
# Transparency tree shape

A symbolic model of `packages/crypto/src/keying/transparencyTree.ts`. A
`Digest` is the term that produced a hash rather than its bytes, so two
digests are equal exactly when they denote the same tree. That models a
collision-free hash whose leaf, node, and empty-tree inputs never coincide,
which the separate `computeKeyingDomainHash` domains are meant to provide.

Every recursive definition takes an explicit `fuel` argument and recurses
structurally on it, so the kernel can evaluate the model for `decide`. The
public wrappers pass the tree size, which always bounds the recursion depth.
-/

namespace Tearleads.Transparency

/-- A hash value, as the term that produced it. -/
inductive Digest where
  /-- `computeTransparencyEmptyTreeHash()`. -/
  | empty
  /-- A leaf hash, named by the value it commits to. -/
  | leaf (value : Nat)
  /-- `computeTransparencyNodeHash(left, right)`. -/
  | node (left right : Digest)
  deriving DecidableEq, Repr, Inhabited

/-- `largestPowerOfTwoLessThan(size)`: doubles from 1 while the double is
still below `size`. -/
def splitPoint (size : Nat) : Nat :=
  go size 1
where
  go : Nat → Nat → Nat
    | 0, power => power
    | fuel + 1, power => if power * 2 < size then go fuel (power * 2) else power

/-- The root of the `size` leaves starting at `lo`, as
`computeTransparencyMerkleRoot(leaves.slice(lo, lo + size))` computes it. -/
def rangeRootAux (values : Nat → Nat) : Nat → Nat → Nat → Digest
  | _, _, 0 => .empty
  | _, lo, 1 => .leaf (values lo)
  | 0, _, _ => .empty
  | fuel + 1, lo, size =>
    let split := splitPoint size
    .node (rangeRootAux values fuel lo split)
      (rangeRootAux values fuel (lo + split) (size - split))

def rangeRoot (values : Nat → Nat) (lo size : Nat) : Digest :=
  rangeRootAux values size lo size

/-- The root of the first `size` leaves. -/
def root (values : Nat → Nat) (size : Nat) : Digest :=
  rangeRoot values 0 size

/-- `size` consecutive leaves starting at `lo`. Proof nodes are always the
roots of such ranges, which is how the vector fixture names them. -/
structure Range where
  lo : Nat
  size : Nat
  deriving DecidableEq, Repr

def Range.digest (values : Nat → Nat) (range : Range) : Digest :=
  rangeRoot values range.lo range.size

end Tearleads.Transparency
