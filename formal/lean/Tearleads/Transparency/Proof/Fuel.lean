import Tearleads.Transparency.Generate
import Tearleads.Transparency.Verify
import Tearleads.Transparency.Proof.Split

/-!
# Fuel independence

Each recursive definition in the model takes explicit fuel. Once the fuel
covers the size, its value no longer matters, so the proofs work with the
fuel-free forms below and their one-step unfolding equations.
-/

namespace Tearleads.Transparency

/-- The root of `size` leaves from `lo`, with exactly enough fuel. -/
def rootOf (leaf : Nat → Digest) (lo size : Nat) : Digest :=
  rangeRootAux leaf size lo size

theorem rangeRootAux_fuel (leaf : Nat → Digest) :
    ∀ fuel fuel' lo size, size ≤ fuel → size ≤ fuel' →
      rangeRootAux leaf fuel lo size = rangeRootAux leaf fuel' lo size := by
  intro fuel
  induction fuel with
  | zero =>
    intro fuel' lo size h _
    obtain rfl : size = 0 := by omega
    cases fuel' <;> rfl
  | succ fuel ih =>
    intro fuel' lo size h h'
    match size, fuel' with
    | 0, 0 => rfl
    | 0, _ + 1 => rfl
    | 1, 0 => omega
    | 1, _ + 1 => rfl
    | size + 2, 0 => omega
    | size + 2, fuel' + 1 =>
      have ⟨h1, hlt, _⟩ := splitPoint_bounds (size + 2) (by omega)
      show Digest.node _ _ = Digest.node _ _
      rw [ih fuel' lo (splitPoint (size + 2)) (by omega) (by omega),
        ih fuel' (lo + splitPoint (size + 2)) (size + 2 - splitPoint (size + 2))
          (by omega) (by omega)]

theorem rootOf_zero (leaf : Nat → Digest) (lo : Nat) : rootOf leaf lo 0 = .empty := rfl

theorem rootOf_one (leaf : Nat → Digest) (lo : Nat) : rootOf leaf lo 1 = leaf lo := rfl

theorem rootOf_split (leaf : Nat → Digest) {size : Nat} (lo : Nat) (h : 2 ≤ size) :
    rootOf leaf lo size =
      .node (rootOf leaf lo (splitPoint size))
        (rootOf leaf (lo + splitPoint size) (size - splitPoint size)) := by
  have ⟨h1, hlt, _⟩ := splitPoint_bounds size h
  obtain ⟨size, rfl⟩ : ∃ s, size = s + 2 := ⟨size - 2, by omega⟩
  unfold rootOf
  show Digest.node _ _ = Digest.node _ _
  rw [rangeRootAux_fuel leaf (size + 1) (splitPoint (size + 2)) lo _ (by omega) (by omega),
    rangeRootAux_fuel leaf (size + 1) (size + 2 - splitPoint (size + 2)) _ _
      (by omega) (by omega)]

/-- The inclusion audit path for offset `index` in `[lo, lo + size)`. -/
def inclusionOf (lo size index : Nat) : List Range :=
  inclusionPathAux size lo size index

theorem inclusionPathAux_fuel :
    ∀ fuel fuel' lo size index, size ≤ fuel → size ≤ fuel' →
      inclusionPathAux fuel lo size index = inclusionPathAux fuel' lo size index := by
  intro fuel
  induction fuel with
  | zero =>
    intro fuel' lo size index h _
    obtain rfl : size = 0 := by omega
    cases fuel' <;> simp [inclusionPathAux]
  | succ fuel ih =>
    intro fuel' lo size index h h'
    cases fuel' with
    | zero =>
      obtain rfl : size = 0 := by omega
      simp [inclusionPathAux]
    | succ fuel' =>
      simp only [inclusionPathAux]
      split
      · rfl
      · have ⟨h1, hlt, _⟩ := splitPoint_bounds size (by omega)
        split
        · rw [ih fuel' lo (splitPoint size) index (by omega) (by omega)]
        · rw [ih fuel' (lo + splitPoint size) (size - splitPoint size)
            (index - splitPoint size) (by omega) (by omega)]

theorem inclusionOf_small {size : Nat} (lo index : Nat) (h : size ≤ 1) :
    inclusionOf lo size index = [] := by
  unfold inclusionOf
  cases size with
  | zero => rfl
  | succ size => simp [inclusionPathAux, h]

theorem inclusionOf_split {size : Nat} (lo index : Nat) (h : 2 ≤ size) :
    inclusionOf lo size index =
      if index < splitPoint size then
        inclusionOf lo (splitPoint size) index ++
          [⟨lo + splitPoint size, size - splitPoint size⟩]
      else
        inclusionOf (lo + splitPoint size) (size - splitPoint size)
            (index - splitPoint size) ++ [⟨lo, splitPoint size⟩] := by
  have ⟨h1, hlt, _⟩ := splitPoint_bounds size h
  obtain ⟨size, rfl⟩ : ∃ s, size = s + 1 := ⟨size - 1, by omega⟩
  unfold inclusionOf
  simp only [inclusionPathAux, show ¬ size + 1 ≤ 1 by omega, ite_false]
  split
  · rw [inclusionPathAux_fuel size (splitPoint (size + 1)) lo _ index (by omega) (by omega)]
  · rw [inclusionPathAux_fuel size (size + 1 - splitPoint (size + 1)) _ _ _
      (by omega) (by omega)]

/-- `SUBPROOF` for relative previous size `previous` in `[lo, lo + size)`. -/
def subproofOf (lo previous size : Nat) (complete : Bool) : List Range :=
  subproofAux size lo previous size complete

theorem subproofAux_fuel :
    ∀ fuel fuel' lo previous size complete, 1 ≤ previous → previous ≤ size →
      size ≤ fuel → size ≤ fuel' →
      subproofAux fuel lo previous size complete =
        subproofAux fuel' lo previous size complete := by
  intro fuel
  induction fuel with
  | zero => intro fuel' lo previous size complete h1 h2 h3 _; omega
  | succ fuel ih =>
    intro fuel' lo previous size complete h1 h2 h3 h4
    cases fuel' with
    | zero => omega
    | succ fuel' =>
      simp only [subproofAux]
      split
      · rfl
      · have ⟨hk1, hlt, _⟩ := splitPoint_bounds size (by omega)
        split
        · rw [ih fuel' lo previous (splitPoint size) complete (by omega) (by omega)
            (by omega) (by omega)]
        · rw [ih fuel' (lo + splitPoint size) (previous - splitPoint size)
            (size - splitPoint size) false (by omega) (by omega) (by omega) (by omega)]

theorem subproofOf_stop (lo size : Nat) (complete : Bool) (h : 1 ≤ size) :
    subproofOf lo size size complete = if complete then [] else [⟨lo, size⟩] := by
  obtain ⟨size, rfl⟩ : ∃ s, size = s + 1 := ⟨size - 1, by omega⟩
  simp [subproofOf, subproofAux]

theorem subproofOf_split {previous size : Nat} (lo : Nat) (complete : Bool)
    (h1 : 1 ≤ previous) (h2 : previous < size) :
    subproofOf lo previous size complete =
      if previous ≤ splitPoint size then
        subproofOf lo previous (splitPoint size) complete ++
          [⟨lo + splitPoint size, size - splitPoint size⟩]
      else
        subproofOf (lo + splitPoint size) (previous - splitPoint size)
            (size - splitPoint size) false ++ [⟨lo, splitPoint size⟩] := by
  have ⟨hk1, hlt, _⟩ := splitPoint_bounds size (by omega)
  obtain ⟨size, rfl⟩ : ∃ s, size = s + 1 := ⟨size - 1, by omega⟩
  unfold subproofOf
  simp only [subproofAux, show previous ≠ size + 1 by omega, ite_false]
  split
  · rw [subproofAux_fuel size (splitPoint (size + 1)) lo previous _ complete
      (by omega) (by omega) (by omega) (by omega)]
  · rw [subproofAux_fuel size (size + 1 - splitPoint (size + 1)) _ _ _ false
      (by omega) (by omega) (by omega) (by omega)]

theorem consistencyPath_eq {previous size : Nat} (h : 1 ≤ previous) :
    consistencyPath previous size = subproofOf 0 previous size true := by
  simp [consistencyPath, subproofOf, show previous ≠ 0 by omega]

theorem halveWhile_fuel (continue? : Nat → Bool) (h0 : continue? 0 = false) :
    ∀ fuel fuel' first second, first + 1 ≤ fuel → first + 1 ≤ fuel' →
      halveWhile continue? fuel first second =
        halveWhile continue? fuel' first second := by
  intro fuel
  induction fuel with
  | zero => intro fuel' first second h _; omega
  | succ fuel ih =>
    intro fuel' first second h h'
    cases fuel' with
    | zero => omega
    | succ fuel' =>
      simp only [halveWhile]
      split
      · have : first ≠ 0 := by
          intro hz
          subst hz
          simp_all
        rw [ih fuel' (first / 2) (second / 2) (by omega) (by omega)]
      · rfl

end Tearleads.Transparency
