import Tearleads.Transparency.Proof.Fuel

/-!
# One tree level as a tree of pairs

An RFC 6962 tree over `n` leaves is the same tree as the one over its
`⌈n/2⌉` pair hashes, an odd last leaf carried up unpaired. Inclusion paths
and consistency subproofs split the same way: the level-0 sibling, then the
path one level up. The proofs only halve, so `omega` does the arithmetic.
-/

namespace Tearleads.Transparency

/-- The level-1 leaves of a tree of `n` leaves: pair `q` hashes leaves `2q`
and `2q + 1`, or carries leaf `2q` up when it is the last one. -/
def pairLeaf (leaf : Nat → Digest) (n q : Nat) : Digest :=
  if 2 * q + 1 < n then .node (leaf (2 * q)) (leaf (2 * q + 1)) else leaf (2 * q)

/-- The digest a proof node names. -/
def rangeDigest (leaf : Nat → Digest) (range : Range) : Digest :=
  rootOf leaf range.lo range.size

/-- A range starting at an even offset and ending at `n` or at an even
offset is the range of its pairs one level up. -/
theorem rootOf_pair (leaf : Nat → Digest) (n : Nat) :
    ∀ size lo, lo % 2 = 0 → lo + size ≤ n → (size % 2 = 0 ∨ lo + size = n) →
      rootOf leaf lo size = rootOf (pairLeaf leaf n) (lo / 2) ((size + 1) / 2) := by
  intro size
  induction size using Nat.strongRecOn with
  | ind size ih =>
    intro lo heven hle hend
    match size, ih with
    | 0, _ => rfl
    | 1, _ =>
      show leaf lo = pairLeaf leaf n (lo / 2)
      unfold pairLeaf
      rw [ite_eq_right (by omega), show 2 * (lo / 2) = lo by omega]
    | 2, _ =>
      rw [rootOf_split leaf lo (by omega), splitPoint_two]
      show Digest.node (leaf lo) (leaf (lo + 1)) = pairLeaf leaf n (lo / 2)
      unfold pairLeaf
      rw [ite_eq_left (by omega), show 2 * (lo / 2) = lo by omega]
    | size + 3, ih =>
      have hk := splitPoint_half (size := size + 3) (by omega)
      have ⟨_, hlt, _⟩ := splitPoint_bounds (size + 3) (by omega)
      have ⟨_, hlt', _⟩ := splitPoint_bounds ((size + 3 + 1) / 2) (by omega)
      rw [rootOf_split leaf lo (by omega), rootOf_split (pairLeaf leaf n) (lo / 2) (by omega)]
      generalize hsplit : splitPoint (size + 3) = split at *
      generalize hhalf : splitPoint ((size + 3 + 1) / 2) = half at *
      rw [ih split (by omega) lo heven (by omega) (by omega),
        ih (size + 3 - split) (by omega) (lo + split) (by omega) (by omega) (by omega)]
      congr 2 <;> omega

/-- The level-0 node of an inclusion path: the left sibling of an odd
offset, the right sibling of an even one when it exists. -/
def levelZero (leaf : Nat → Digest) (lo size index : Nat) : List Digest :=
  if index % 2 = 1 then [leaf (lo + index - 1)]
  else if index + 1 < size then [leaf (lo + index + 1)] else []

theorem inclusionOf_pair (leaf : Nat → Digest) (n : Nat) :
    ∀ size lo index, lo % 2 = 0 → lo + size ≤ n → (size % 2 = 0 ∨ lo + size = n) →
      index < size →
      (inclusionOf lo size index).map (rangeDigest leaf) =
        levelZero leaf lo size index ++
          (inclusionOf (lo / 2) ((size + 1) / 2) (index / 2)).map
            (rangeDigest (pairLeaf leaf n)) := by
  intro size
  induction size using Nat.strongRecOn with
  | ind size ih =>
    intro lo index heven hle hend hindex
    match size, ih with
    | 0, _ => omega
    | 1, _ =>
      rw [inclusionOf_small lo index (by omega), inclusionOf_small _ _ (by omega)]
      simp [levelZero, show index = 0 by omega]
    | 2, _ =>
      rw [inclusionOf_split lo index (by omega), splitPoint_two,
        inclusionOf_small _ _ (by omega)]
      by_cases h : index = 0
      · subst h
        simp [inclusionOf_small, levelZero, rangeDigest, rootOf_one]
      · obtain rfl : index = 1 := by omega
        simp [inclusionOf_small, levelZero, rangeDigest, rootOf_one]
    | size + 3, ih =>
      have hk := splitPoint_half (size := size + 3) (by omega)
      have ⟨_, hlt, _⟩ := splitPoint_bounds (size + 3) (by omega)
      have ⟨_, hlt', _⟩ := splitPoint_bounds ((size + 3 + 1) / 2) (by omega)
      rw [inclusionOf_split lo index (by omega),
        inclusionOf_split (lo / 2) (index / 2) (by omega)]
      generalize hsplit : splitPoint (size + 3) = split at *
      generalize hhalf : splitPoint ((size + 3 + 1) / 2) = half at *
      by_cases hleft : index < split
      · rw [ite_eq_left hleft, ite_eq_left (by omega), List.map_append,
          ih split (by omega) lo index heven (by omega) (by omega) hleft,
          List.map_append, List.append_assoc]
        have hzero : levelZero leaf lo split index = levelZero leaf lo (size + 3) index := by
          unfold levelZero
          split
          · rfl
          · rw [ite_eq_left (by omega), ite_eq_left (by omega)]
        rw [hzero]
        simp only [List.map_cons, List.map_nil, rangeDigest]
        rw [rootOf_pair leaf n (size + 3 - split) (lo + split) (by omega) (by omega) (by omega)]
        congr 4 <;> omega
      · rw [ite_eq_right hleft, ite_eq_right (by omega), List.map_append,
          ih (size + 3 - split) (by omega) (lo + split) (index - split) (by omega) (by omega)
            (by omega) (by omega),
          List.map_append, List.append_assoc]
        have hzero : levelZero leaf (lo + split) (size + 3 - split) (index - split) =
            levelZero leaf lo (size + 3) index := by
          unfold levelZero
          rw [show (index - split) % 2 = index % 2 by omega,
            show lo + split + (index - split) = lo + index by omega]
          split
          · rfl
          · by_cases hnext : index + 1 < size + 3
            · rw [ite_eq_left (by omega), ite_eq_left hnext]
            · rw [ite_eq_right (by omega), ite_eq_right hnext]
        rw [hzero]
        simp only [List.map_cons, List.map_nil, rangeDigest]
        rw [rootOf_pair leaf n split lo heven (by omega) (by omega)]
        congr 4 <;> omega

/-- For an even previous size, the subproof is the subproof one level up. -/
theorem subproofOf_pair (leaf : Nat → Digest) (n : Nat) :
    ∀ size lo previous complete, previous % 2 = 0 → 1 ≤ previous → previous ≤ size →
      lo % 2 = 0 → lo + size ≤ n → (size % 2 = 0 ∨ lo + size = n) →
      (subproofOf lo previous size complete).map (rangeDigest leaf) =
        (subproofOf (lo / 2) (previous / 2) ((size + 1) / 2) complete).map
          (rangeDigest (pairLeaf leaf n)) := by
  intro size
  induction size using Nat.strongRecOn with
  | ind size ih =>
    intro lo previous complete hpeven hp1 hps heven hle hend
    by_cases hstop : previous = size
    · subst hstop
      rw [subproofOf_stop lo previous complete (by omega),
        show (previous + 1) / 2 = previous / 2 by omega,
        subproofOf_stop (lo / 2) (previous / 2) complete (by omega)]
      cases complete
      · simp only [Bool.false_eq_true, ite_false, List.map_cons, List.map_nil, rangeDigest]
        rw [rootOf_pair leaf n previous lo heven hle hend,
          show (previous + 1) / 2 = previous / 2 by omega]
      · rfl
    · have h3 : 3 ≤ size := by omega
      have hk := splitPoint_half h3
      have ⟨_, hlt, _⟩ := splitPoint_bounds size (by omega)
      have ⟨_, hlt', _⟩ := splitPoint_bounds ((size + 1) / 2) (by omega)
      rw [subproofOf_split lo complete hp1 (by omega),
        subproofOf_split (lo / 2) complete (by omega) (by omega)]
      generalize hsplit : splitPoint size = split at *
      generalize hhalf : splitPoint ((size + 1) / 2) = half at *
      by_cases hleft : previous ≤ split
      · rw [ite_eq_left hleft, ite_eq_left (by omega), List.map_append, List.map_append,
          ih split (by omega) lo previous complete hpeven hp1 hleft heven (by omega) (by omega)]
        simp only [List.map_cons, List.map_nil, rangeDigest]
        rw [rootOf_pair leaf n (size - split) (lo + split) (by omega) (by omega) (by omega)]
        congr 4 <;> omega
      · rw [ite_eq_right hleft, ite_eq_right (by omega), List.map_append, List.map_append,
          ih (size - split) (by omega) (lo + split) (previous - split) false (by omega)
            (by omega) (by omega) (by omega) (by omega) (by omega)]
        simp only [List.map_cons, List.map_nil, rangeDigest]
        rw [rootOf_pair leaf n split lo heven (by omega) (by omega)]
        congr 3 <;> omega

/-- For an odd previous size, the subproof is the previous tree's last
leaf (unless it is the whole complete tree) and then that leaf's inclusion
path in the current tree. -/
theorem subproofOf_odd :
    ∀ size lo previous complete, previous % 2 = 1 → previous < size →
      subproofOf lo previous size complete =
        (if complete ∧ previous = 1 then [] else [⟨lo + previous - 1, 1⟩]) ++
          inclusionOf lo size (previous - 1) := by
  intro size
  induction size using Nat.strongRecOn with
  | ind size ih =>
    intro lo previous complete hodd hlt
    rw [subproofOf_split lo complete (by omega) hlt, inclusionOf_split lo _ (by omega)]
    by_cases h2 : size = 2
    · subst h2
      obtain rfl : previous = 1 := by omega
      rw [splitPoint_two, subproofOf_stop lo 1 complete (by omega)]
      simp only [Nat.le_refl, ite_true, Nat.sub_self, Nat.zero_lt_one, Nat.add_sub_cancel,
        inclusionOf_small lo 0 (Nat.le_refl 1), List.nil_append]
      cases complete <;> simp
    · have h3 : 3 ≤ size := by omega
      have heven := splitPoint_even h3
      have ⟨_, hk, _⟩ := splitPoint_bounds size (by omega)
      generalize hsplit : splitPoint size = split at *
      by_cases hleft : previous ≤ split
      · rw [ite_eq_left hleft, ite_eq_left (show previous - 1 < split by omega),
          ih split (by omega) lo previous complete hodd (show previous < split by omega),
          List.append_assoc]
      · have hfirst : ¬(complete = true ∧ previous = 1) := fun h => by
          have := h.2
          omega
        rw [ite_eq_right hleft, ite_eq_right (show ¬previous - 1 < split by omega),
          ih (size - split) (by omega) (lo + split) (previous - split) false (by omega)
            (by omega),
          ite_eq_right (show ¬(false = true ∧ previous - split = 1) by simp),
          ite_eq_right hfirst,
          show lo + split + (previous - split) - 1 = lo + previous - 1 by omega,
          show previous - split - 1 = previous - 1 - split by omega,
          List.append_assoc]

end Tearleads.Transparency
