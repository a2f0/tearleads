import Tearleads.Transparency.Theorems
import Tearleads.Transparency.Proof.Walk

/-!
# Consistency completeness

`consistency_complete` proves `ConsistencyComplete` for every tree size.
An even previous size has an odd last index, so the verifier's strip loop
and the generator both move one level up, onto the tree of pair hashes. An
odd previous size seeds the walk with its last leaf, and the remaining nodes
are that leaf's inclusion path, which `walk_inclusion` folds into both roots.
-/

namespace Tearleads.Transparency

private def oddIndex (index : Nat) : Bool := index % 2 == 1

theorem halveWhile_succ (continue? : Nat → Bool) (fuel first second : Nat) :
    halveWhile continue? (fuel + 1) first second =
      if continue? first then halveWhile continue? fuel (first / 2) (second / 2)
      else (first, second) := rfl

/-- An even previous size verifies exactly as its halved size does one
level up: the strip loop's first step is the only difference. -/
theorem consistencyRoots_even {previous : Nat} (size : Nat) (previousRoot : Digest)
    (nodes : List Digest) (heven : previous % 2 = 0) (h2 : 2 ≤ previous) :
    consistencyRoots previous size previousRoot nodes =
      consistencyRoots (previous / 2) ((size + 1) / 2) previousRoot nodes := by
  have hstep : halveWhile oddIndex previous (previous - 1) (size - 1) =
      halveWhile oddIndex (previous / 2) (previous / 2 - 1) ((size + 1) / 2 - 1) := by
    calc halveWhile oddIndex previous (previous - 1) (size - 1)
        = halveWhile oddIndex (previous - 1 + 1) (previous - 1) (size - 1) := by
          rw [show previous - 1 + 1 = previous by omega]
      _ = halveWhile oddIndex (previous - 1) ((previous - 1) / 2) ((size - 1) / 2) := by
          rw [halveWhile_succ, ite_eq_left (by simp [oddIndex]; omega)]
      _ = halveWhile oddIndex (previous / 2) (previous / 2 - 1) ((size + 1) / 2 - 1) := by
          rw [show (previous - 1) / 2 = previous / 2 - 1 by omega,
            show (size - 1) / 2 = (size + 1) / 2 - 1 by omega]
          exact halveWhile_fuel oddIndex rfl _ _ _ _ (by omega) (by omega)
  unfold consistencyRoots
  rw [show (fun index => index % 2 == 1) = oddIndex from rfl, hstep]

/-- An odd previous size strips nothing: the walk starts at its last leaf. -/
theorem consistencyRoots_odd {previous : Nat} (size : Nat) (previousRoot : Digest)
    (nodes : List Digest) (hodd : previous % 2 = 1) :
    consistencyRoots previous size previousRoot nodes =
      (match (if previous - 1 = 0 then previousRoot :: nodes else nodes) with
      | [] => .error .missingDependency
      | seed :: rest => do
        let walk ← rest.foldlM walkStep
          { first := previous - 1, second := size - 1, previousRoot := seed,
            currentRoot := seed }
        if walk.second ≠ 0 then .error .missingDependency
        else pure (walk.previousRoot, walk.currentRoot)) := by
  have hstrip : halveWhile oddIndex previous (previous - 1) (size - 1) =
      (previous - 1, size - 1) := by
    rw [show previous = previous - 1 + 1 by omega, halveWhile_succ,
      ite_eq_right (by simp [oddIndex]; omega)]
  unfold consistencyRoots
  rw [show (fun index => index % 2 == 1) = oddIndex from rfl, hstrip]
  rfl

theorem consistencyRoots_honest :
    ∀ previous (leaf : Nat → Digest) size, 1 ≤ previous → previous < size →
      consistencyRoots previous size (rootOf leaf 0 previous)
          ((consistencyPath previous size).map (rangeDigest leaf)) =
        .ok (rootOf leaf 0 previous, rootOf leaf 0 size) := by
  intro previous
  induction previous using Nat.strongRecOn with
  | ind previous ih =>
    intro leaf size h1 hlt
    rw [consistencyPath_eq h1]
    by_cases hodd : previous % 2 = 1
    · have hwalk := walk_inclusion size leaf leaf previous h1 (by omega) (fun _ _ => rfl)
      rw [consistencyRoots_odd size _ _ hodd, subproofOf_odd size 0 previous true hodd hlt]
      by_cases hone : previous = 1
      · subst hone
        simp only [Nat.sub_self, ite_true, and_self, List.nil_append, rootOf_one] at hwalk ⊢
        rw [hwalk]
        rfl
      · have hseed : rangeDigest leaf ⟨0 + previous - 1, 1⟩ = leaf (previous - 1) := by
          simp [rangeDigest, rootOf_one]
        simp only [show previous - 1 ≠ 0 by omega, ite_false, hone, and_false,
          List.cons_append, List.nil_append, List.map_cons, hseed]
        rw [hwalk]
        rfl
    · have heven : previous % 2 = 0 := by omega
      rw [consistencyRoots_even size _ _ heven (by omega),
        subproofOf_pair leaf size size 0 previous true heven h1 (by omega) rfl (by omega)
          (Or.inr (by omega)),
        rootOf_pair leaf size previous 0 rfl (by omega) (Or.inl heven),
        rootOf_pair leaf size size 0 rfl (by omega) (Or.inr (by omega)),
        Nat.zero_div, show (previous + 1) / 2 = previous / 2 by omega]
      have := ih (previous / 2) (by omega) (pairLeaf leaf size) ((size + 1) / 2)
        (by omega) (by omega)
      rwa [consistencyPath_eq (by omega)] at this

/-- Gate F3: every honest consistency proof is accepted, for every pair of
tree sizes. -/
theorem consistency_complete : ConsistencyComplete := by
  intro values previous size hle
  show verifyConsistency previous (rootOf (leafDigest values) 0 previous) size
      (rootOf (leafDigest values) 0 size)
      ((consistencyPath previous size).map (rangeDigest (leafDigest values))) = .accepted
  by_cases hzero : previous = 0
  · subst hzero
    by_cases hsize : size = 0
    · subst hsize
      rfl
    · simp [verifyConsistency, consistencyPath, rootOf_zero, hsize]
  · by_cases hsame : previous = size
    · subst hsame
      rw [consistencyPath_eq (by omega), subproofOf_stop 0 previous true (by omega)]
      simp [verifyConsistency, hzero]
    · have hroots := consistencyRoots_honest previous (leafDigest values) size (by omega)
        (by omega)
      simp [verifyConsistency, show ¬size < previous by omega, hzero, hsame,
        show size ≠ 0 by omega, hroots]

/-- #2186's refused 5 → 6 proof is one instance. -/
theorem consistency_complete_five_six : honestConsistency vectorLeaf 5 6 = .accepted :=
  consistency_complete vectorLeaf 5 6 (by omega)

/-- info: 'Tearleads.Transparency.consistency_complete' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms consistency_complete

end Tearleads.Transparency
