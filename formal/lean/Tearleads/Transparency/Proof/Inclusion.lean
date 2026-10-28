import Tearleads.Transparency.Theorems
import Tearleads.Transparency.Proof.Pairing

/-!
# Inclusion completeness and soundness

The inclusion generator and verifier recurse on the same splits, top down:
the generator appends each level's sibling after the deeper path, and the
verifier, reading the path reversed, consumes that sibling first. Both
theorems are inductions on that shared recursion. Soundness also uses that
`Digest.node` is injective, which is how the model's symbolic hash encodes
collision resistance.
-/

namespace Tearleads.Transparency

/-- The inclusion root computation with exactly enough fuel. -/
def inclusionRootOf (leafDigest : Digest) (index size : Nat) (path : List Digest) :
    Except Code (Digest × List Digest) :=
  inclusionRootAux leafDigest size index size path

theorem inclusionRootAux_fuel (leafDigest : Digest) :
    ∀ fuel fuel' index size path, index < size → size ≤ fuel → size ≤ fuel' →
      inclusionRootAux leafDigest fuel index size path =
        inclusionRootAux leafDigest fuel' index size path := by
  intro fuel
  induction fuel with
  | zero => intro fuel' index size path h1 h2 _; omega
  | succ fuel ih =>
    intro fuel' index size path hindex h h'
    cases fuel' with
    | zero => omega
    | succ fuel' =>
      match size, path with
      | 1, _ => rfl
      | size + 2, [] => rfl
      | size + 2, sibling :: rest =>
        have ⟨_, hlt, _⟩ := splitPoint_bounds (size + 2) (by omega)
        simp only [inclusionRootAux]
        split
        · rw [ih fuel' index (splitPoint (size + 2)) rest (by omega) (by omega) (by omega)]
        · rw [ih fuel' (index - splitPoint (size + 2)) (size + 2 - splitPoint (size + 2)) rest
            (by omega) (by omega) (by omega)]

theorem inclusionRootOf_one (leafDigest : Digest) (path : List Digest) :
    inclusionRootOf leafDigest 0 1 path = .ok (leafDigest, path) := rfl

theorem inclusionRootOf_nil (leafDigest : Digest) {size : Nat} (index : Nat) (h : 2 ≤ size) :
    inclusionRootOf leafDigest index size [] = .error .missingDependency := by
  obtain ⟨size, rfl⟩ : ∃ s, size = s + 2 := ⟨size - 2, by omega⟩
  rfl

theorem inclusionRootOf_split (leafDigest sibling : Digest) (rest : List Digest)
    {index size : Nat} (hindex : index < size) (h : 2 ≤ size) :
    inclusionRootOf leafDigest index size (sibling :: rest) =
      if index < splitPoint size then
        (inclusionRootOf leafDigest index (splitPoint size) rest).bind fun (computed, rest) =>
          .ok (.node computed sibling, rest)
      else
        (inclusionRootOf leafDigest (index - splitPoint size) (size - splitPoint size)
          rest).bind fun (computed, rest) => .ok (.node sibling computed, rest) := by
  have ⟨_, hlt, _⟩ := splitPoint_bounds size h
  obtain ⟨size, rfl⟩ : ∃ s, size = s + 2 := ⟨size - 2, by omega⟩
  unfold inclusionRootOf
  simp only [inclusionRootAux]
  split
  · rw [inclusionRootAux_fuel leafDigest (size + 1) (splitPoint (size + 2)) index _ rest
      (by omega) (by omega) (by omega)]
    rfl
  · rw [inclusionRootAux_fuel leafDigest (size + 1) (size + 2 - splitPoint (size + 2)) _ _
      rest (by omega) (by omega) (by omega)]
    rfl

theorem inclusionRootOf_honest (leaf : Nat → Digest) :
    ∀ size lo index rest, index < size →
      inclusionRootOf (leaf (lo + index)) index size
          (((inclusionOf lo size index).map (rangeDigest leaf)).reverse ++ rest) =
        .ok (rootOf leaf lo size, rest) := by
  intro size
  induction size using Nat.strongRecOn with
  | ind size ih =>
    intro lo index rest hindex
    by_cases h1 : size = 1
    · subst h1
      obtain rfl : index = 0 := by omega
      rw [inclusionOf_small lo 0 (Nat.le_refl 1)]
      rfl
    · have h2 : 2 ≤ size := by omega
      have ⟨_, hlt, _⟩ := splitPoint_bounds size h2
      rw [inclusionOf_split lo index h2]
      by_cases hleft : index < splitPoint size
      · rw [ite_eq_left hleft]
        simp only [List.map_append, List.map_cons, List.map_nil, List.reverse_append,
          List.reverse_cons, List.reverse_nil, List.nil_append, List.cons_append]
        rw [inclusionRootOf_split _ _ _ hindex h2, ite_eq_left hleft,
          ih (splitPoint size) hlt lo index rest hleft, rootOf_split leaf lo h2]
        rfl
      · rw [ite_eq_right hleft]
        simp only [List.map_append, List.map_cons, List.map_nil, List.reverse_append,
          List.reverse_cons, List.reverse_nil, List.nil_append, List.cons_append]
        have hchild := ih (size - splitPoint size) (by omega) (lo + splitPoint size)
          (index - splitPoint size) rest (by omega)
        rw [show lo + splitPoint size + (index - splitPoint size) = lo + index by omega]
          at hchild
        rw [inclusionRootOf_split _ _ _ hindex h2, ite_eq_right hleft, hchild,
          rootOf_split leaf lo h2]
        rfl

/-- Gate F3: every honest inclusion proof is accepted, for every tree size
and leaf index. -/
theorem inclusion_complete : InclusionComplete := by
  intro values size index hindex
  have hroot := inclusionRootOf_honest (leafDigest values) size 0 index [] hindex
  rw [List.append_nil, Nat.zero_add] at hroot
  show verifyInclusion (leafDigest values index) index size
      (rootOf (leafDigest values) 0 size)
      ((inclusionOf 0 size index).map (rangeDigest (leafDigest values))) = .accepted
  unfold verifyInclusion
  rw [ite_eq_right (by omega)]
  change (match inclusionRootOf _ index size _ with
    | .error code => _
    | .ok (_, _ :: _) => _
    | .ok (computed, []) => _) = _
  rw [hroot]
  simp

theorem inclusionRootOf_sound (leaf : Nat → Digest) :
    ∀ size lo index leafDigest path computed rest, index < size →
      inclusionRootOf leafDigest index size path = .ok (computed, rest) →
      computed = rootOf leaf lo size → leafDigest = leaf (lo + index) := by
  intro size
  induction size using Nat.strongRecOn with
  | ind size ih =>
    intro lo index leafDigest path computed rest hindex hrun hroot
    by_cases h1 : size = 1
    · subst h1
      obtain rfl : index = 0 := by omega
      rw [inclusionRootOf_one] at hrun
      cases hrun
      exact hroot
    · have h2 : 2 ≤ size := by omega
      have ⟨_, hlt, _⟩ := splitPoint_bounds size h2
      cases path with
      | nil => rw [inclusionRootOf_nil _ _ h2] at hrun; cases hrun
      | cons sibling path =>
        rw [inclusionRootOf_split _ _ _ hindex h2, rootOf_split leaf lo h2] at *
        by_cases hleft : index < splitPoint size
        · rw [ite_eq_left hleft] at hrun
          generalize hchild : inclusionRootOf leafDigest index (splitPoint size) path = child
            at hrun
          cases child with
          | error => cases hrun
          | ok result =>
            obtain ⟨childRoot, childRest⟩ := result
            cases hrun
            cases hroot
            exact ih (splitPoint size) hlt lo index leafDigest path _ _ hleft hchild rfl
        · rw [ite_eq_right hleft] at hrun
          generalize hchild : inclusionRootOf leafDigest (index - splitPoint size)
            (size - splitPoint size) path = child at hrun
          cases child with
          | error => cases hrun
          | ok result =>
            obtain ⟨childRoot, childRest⟩ := result
            cases hrun
            cases hroot
            have := ih (size - splitPoint size) (by omega) (lo + splitPoint size)
              (index - splitPoint size) leafDigest path _ _ (by omega) hchild rfl
            rwa [show lo + splitPoint size + (index - splitPoint size) = lo + index by omega]
              at this

/-- Gate F3: against an honest root, only the committed leaf is accepted at
an index, whatever audit path accompanies it. -/
theorem inclusion_sound : InclusionSound := by
  intro values size index claimed auditPath haccepted
  unfold verifyInclusion at haccepted
  by_cases hshape : size = 0 ∨ size ≤ index
  · rw [ite_eq_left hshape] at haccepted
    cases haccepted
  · rw [ite_eq_right hshape] at haccepted
    change (match inclusionRootOf claimed index size auditPath.reverse with
      | .error code => _
      | .ok (_, _ :: _) => _
      | .ok (computed, []) => _) = _ at haccepted
    generalize hrun : inclusionRootOf claimed index size auditPath.reverse = run at haccepted
    rcases run with code | ⟨computed, _ | ⟨head, tail⟩⟩
    · cases haccepted
    · by_cases hroot : computed = root values size
      · have := inclusionRootOf_sound (leafDigest values) size 0 index claimed
          auditPath.reverse computed [] (by omega) hrun hroot
        rwa [Nat.zero_add] at this
      · simp only [hroot, ite_false] at haccepted
        cases haccepted
    · cases haccepted

/-- info: 'Tearleads.Transparency.inclusion_complete' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms inclusion_complete

/-- info: 'Tearleads.Transparency.inclusion_sound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms inclusion_sound

end Tearleads.Transparency
