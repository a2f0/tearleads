import Tearleads.Transparency.Generate
import Tearleads.Transparency.Verify

/-!
# Gate F3 obligations and bounded results

The `Prop` definitions below state the #2192 Gate F3 theorems for every tree
size. They are stated, not yet proved: each becomes a `theorem` of the same
name once its proof lands, and `formal/lean/README.md` tracks which are open.

The bounded theorems after them are proved now, by kernel evaluation of the
model. They are not the F3 theorems: they cover sizes through 32, the range
the TypeScript mutation matrices already exhaust.
-/

namespace Tearleads.Transparency

/-- Leaf `i` commits to value `i`, the leaf set the vector fixture uses. -/
def vectorLeaf : Nat → Nat := id

def honestInclusion (values : Nat → Nat) (size index : Nat) : Outcome :=
  verifyInclusion (.leaf (values index)) index size (root values size)
    ((inclusionPath size index).map (Range.digest values))

def honestConsistency (values : Nat → Nat) (previous size : Nat) : Outcome :=
  verifyConsistency previous (root values previous) size (root values size)
    ((consistencyPath previous size).map (Range.digest values))

/-- Completeness: every leaf of every tree has an inclusion proof the
verifier accepts. -/
def InclusionComplete : Prop :=
  ∀ (values : Nat → Nat) (size index : Nat), index < size →
    honestInclusion values size index = .accepted

/-- Completeness: for all `previous ≤ size`, the generated consistency proof
is accepted. #2186's 5 → 6 failure is one instance. -/
def ConsistencyComplete : Prop :=
  ∀ (values : Nat → Nat) (previous size : Nat), previous ≤ size →
    honestConsistency values previous size = .accepted

/-- Soundness: against an honest root, only the committed leaf is accepted
at an index, whatever audit path accompanies it. -/
def InclusionSound : Prop :=
  ∀ (values : Nat → Nat) (size index : Nat) (leafDigest : Digest)
    (auditPath : List Digest),
    verifyInclusion leafDigest index size (root values size) auditPath = .accepted →
      leafDigest = .leaf (values index)

/-- Soundness: against an honest current root, an accepted consistency proof
pins the previous root to the root of the current tree's prefix, so the
previous tree is a prefix of the current one. -/
def ConsistencySound : Prop :=
  ∀ (values : Nat → Nat) (previous size : Nat) (previousRoot : Digest)
    (nodes : List Digest),
    verifyConsistency previous previousRoot size (root values size) nodes = .accepted →
      previousRoot = root values previous

theorem consistency_complete_five_six :
    honestConsistency vectorLeaf 5 6 = .accepted := by
  decide +kernel

theorem inclusion_complete_through_32 :
    ∀ size < 33, ∀ index < size,
      honestInclusion vectorLeaf size index = .accepted := by
  decide +kernel

theorem consistency_complete_through_32 :
    ∀ size < 33, ∀ previous ≤ size,
      honestConsistency vectorLeaf previous size = .accepted := by
  decide +kernel

/-- info: 'Tearleads.Transparency.consistency_complete_through_32' does not depend on any axioms -/
#guard_msgs in
#print axioms consistency_complete_through_32

/-- info: 'Tearleads.Transparency.inclusion_complete_through_32' does not depend on any axioms -/
#guard_msgs in
#print axioms inclusion_complete_through_32

end Tearleads.Transparency
