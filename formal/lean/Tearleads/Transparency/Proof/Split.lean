import Tearleads.Transparency.Tree

/-!
# Split-point arithmetic

`splitPoint` doubles from 1 while the double is below the size. These lemmas
pin the result down: for `size ≥ 2` it is at least 1, below the size, and at
least half of it, and for `size ≥ 3` it is twice the split point of the
halved, rounded-up size. The last fact is what lets one tree level be read
as a tree over pair hashes.
-/

namespace Tearleads.Transparency

theorem splitPoint_go_succ (size fuel power : Nat) :
    splitPoint.go size (fuel + 1) power =
      if power * 2 < size then splitPoint.go size fuel (power * 2) else power := rfl

theorem splitPoint_go_stable (size : Nat) :
    ∀ fuel power, 1 ≤ power → size ≤ fuel + power →
      splitPoint.go size fuel power = splitPoint.go size (fuel + 1) power := by
  intro fuel
  induction fuel with
  | zero =>
    intro power hp hs
    rw [splitPoint_go_succ]
    simp only [splitPoint.go]
    split <;> omega
  | succ fuel ih =>
    intro power hp hs
    rw [splitPoint_go_succ, splitPoint_go_succ size (fuel + 1)]
    split
    · exact ih (power * 2) (by omega) (by omega)
    · rfl

theorem splitPoint_go_fuel (size power : Nat) (hp : 1 ≤ power) :
    ∀ extra fuel, size ≤ fuel + power →
      splitPoint.go size fuel power = splitPoint.go size (fuel + extra) power := by
  intro extra
  induction extra with
  | zero => intro fuel _; rfl
  | succ extra ih =>
    intro fuel hs
    rw [ih fuel hs, ← Nat.add_assoc]
    exact splitPoint_go_stable size (fuel + extra) power hp (by omega)

theorem splitPoint_go_double (size : Nat) :
    ∀ fuel power, splitPoint.go size fuel (2 * power) =
      2 * splitPoint.go ((size + 1) / 2) fuel power := by
  intro fuel
  induction fuel with
  | zero => intro power; rfl
  | succ fuel ih =>
    intro power
    rw [splitPoint_go_succ, splitPoint_go_succ]
    have hiff : 2 * power * 2 < size ↔ power * 2 < (size + 1) / 2 := by omega
    by_cases h : power * 2 < (size + 1) / 2
    · rw [ite_eq_left (hiff.mpr h), ite_eq_left h, ← ih (power * 2)]
      congr 1
      omega
    · rw [ite_eq_right (fun h' => h (hiff.mp h')), ite_eq_right h]

theorem splitPoint_two : splitPoint 2 = 1 := rfl

/-- For `size ≥ 3`, the split is twice the split of the halved size. -/
theorem splitPoint_half {size : Nat} (h : 3 ≤ size) :
    splitPoint size = 2 * splitPoint ((size + 1) / 2) := by
  unfold splitPoint
  obtain ⟨fuel, rfl⟩ : ∃ fuel, size = fuel + 1 := ⟨size - 1, by omega⟩
  rw [splitPoint_go_succ, ite_eq_left (by omega)]
  have := splitPoint_go_double (fuel + 1) fuel 1
  rw [Nat.mul_one] at this
  rw [Nat.one_mul, this]
  congr 1
  have key := splitPoint_go_fuel ((fuel + 1 + 1) / 2) 1 (by omega)
    (fuel - (fuel + 1 + 1) / 2) ((fuel + 1 + 1) / 2) (by omega)
  rw [show (fuel + 1 + 1) / 2 + (fuel - (fuel + 1 + 1) / 2) = fuel by omega] at key
  exact key.symm

/-- The split of a size of at least 2 is a proper, at-least-half part. -/
theorem splitPoint_bounds : ∀ size, 2 ≤ size →
    1 ≤ splitPoint size ∧ splitPoint size < size ∧ size ≤ 2 * splitPoint size := by
  intro size
  induction size using Nat.strongRecOn with
  | ind size ih =>
    intro h2
    by_cases h3 : 3 ≤ size
    · have ⟨h1, hlt, hle⟩ := ih ((size + 1) / 2) (by omega) (by omega)
      rw [splitPoint_half h3]
      omega
    · have : size = 2 := by omega
      subst this
      decide

theorem splitPoint_even {size : Nat} (h : 3 ≤ size) : splitPoint size % 2 = 0 := by
  rw [splitPoint_half h]
  omega

end Tearleads.Transparency
