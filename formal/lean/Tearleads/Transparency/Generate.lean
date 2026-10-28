import Tearleads.Transparency.Tree

/-!
# Proof generation

`createTransparencyInclusionProof` and `createTransparencyConsistencyProof`
from `transparencyTree.ts`, returning the leaf range each proof node is the
root of instead of its hash.
-/

namespace Tearleads.Transparency

/-- `createTransparencyInclusionAuditPath` over the range `[lo, lo + size)`
for the leaf at offset `index` in it: deepest sibling first. -/
def inclusionPathAux : Nat → Nat → Nat → Nat → List Range
  | 0, _, _, _ => []
  | fuel + 1, lo, size, index =>
    if size ≤ 1 then []
    else
      let split := splitPoint size
      if index < split then
        inclusionPathAux fuel lo split index ++ [⟨lo + split, size - split⟩]
      else
        inclusionPathAux fuel (lo + split) (size - split) (index - split) ++
          [⟨lo, split⟩]

def inclusionPath (size index : Nat) : List Range :=
  inclusionPathAux size 0 size index

/-- RFC 6962 `SUBPROOF`, as `createTransparencyConsistencyNodeHashes` walks
it over the range `[lo, lo + size)`. -/
def subproofAux : Nat → Nat → Nat → Nat → Bool → List Range
  | 0, _, _, _, _ => []
  | fuel + 1, lo, previous, size, complete =>
    if previous = size then
      if complete then [] else [⟨lo, size⟩]
    else
      let split := splitPoint size
      if previous ≤ split then
        subproofAux fuel lo previous split complete ++ [⟨lo + split, size - split⟩]
      else
        subproofAux fuel (lo + split) (previous - split) (size - split) false ++
          [⟨lo, split⟩]

def consistencyPath (previous size : Nat) : List Range :=
  if previous = 0 then [] else subproofAux size 0 previous size true

end Tearleads.Transparency
