import Tearleads.Transparency.Proof.Pairing

/-!
# The consistency walk over an inclusion path

From its seed on, the RFC 9162 walk in `consistencyRoots` folds the previous
tree's last-leaf node into both roots one level at a time, and the nodes it
consumes are that node's inclusion path in the current tree. `walk_inclusion`
proves it reaches both roots, one level per step of a strong induction on the
current tree's size.
-/

namespace Tearleads.Transparency

private def evenNonzero (index : Nat) : Bool := index % 2 == 0 && index != 0

/-- An odd index takes its left sibling into both roots. -/
theorem walkStep_odd (first second : Nat) (previousRoot currentRoot node : Digest)
    (hodd : first % 2 = 1) (hsecond : second ≠ 0) :
    walkStep ⟨first, second, previousRoot, currentRoot⟩ node =
      .ok ⟨first / 2, second / 2, .node node previousRoot, .node node currentRoot⟩ := by
  simp only [walkStep, hsecond, hodd, true_or, ite_true, ite_false, halveWhile]
  simp

/-- An even index below the current tree's last one takes its right sibling
into the current root only. -/
theorem walkStep_even (first second : Nat) (previousRoot currentRoot node : Digest)
    (heven : first % 2 = 0) (hlt : first < second) :
    walkStep ⟨first, second, previousRoot, currentRoot⟩ node =
      .ok ⟨first / 2, second / 2, previousRoot, .node currentRoot node⟩ := by
  simp only [walkStep, show second ≠ 0 by omega, show first ≠ second by omega, heven,
    ite_false]
  simp

/-- Where both paths merge on an even, nonzero index the level is a single
child, and the walk consumes the next node one level up instead. -/
theorem walkStep_merged (first : Nat) (previousRoot currentRoot node : Digest)
    (heven : first % 2 = 0) (hnonzero : first ≠ 0) :
    walkStep ⟨first, first, previousRoot, currentRoot⟩ node =
      walkStep ⟨first / 2, first / 2, previousRoot, currentRoot⟩ node := by
  have hhalf : first / 2 ≠ 0 := by omega
  have hcontinue : evenNonzero first = true := by simp [evenNonzero, heven, hnonzero]
  have hfuel := halveWhile_fuel evenNonzero (by rfl) first (first / 2 + 1) (first / 2)
    (first / 2) (by omega) (by omega)
  have hstep : halveWhile evenNonzero (first + 1) first first =
      halveWhile evenNonzero first (first / 2) (first / 2) := by
    simp only [halveWhile, hcontinue, ite_true]
  unfold walkStep
  simp only [hnonzero, hhalf, ite_false, or_true, ite_true]
  change Except.ok _ = Except.ok _
  rw [show (fun index => index % 2 == 0 && index != 0) = evenNonzero from rfl, hstep, hfuel]

theorem inclusionOf_ne_nil {size : Nat} (lo index : Nat) (h : 2 ≤ size) :
    inclusionOf lo size index ≠ [] := by
  rw [inclusionOf_split lo index h]
  split <;> simp

theorem foldlM_walkStep_cons (init : Walk) (node : Digest) (rest : List Digest) :
    (node :: rest).foldlM walkStep init = (walkStep init node).bind (rest.foldlM walkStep) := by
  rfl

/-- From the seed of a previous tree of `M` leaves that agrees with the
current tree of `N` leaves on all but its last leaf, the walk over that
leaf's inclusion path in the current tree reaches both roots. -/
theorem walk_inclusion :
    ∀ N (previousLeaf currentLeaf : Nat → Digest) M, 1 ≤ M → M ≤ N →
      (∀ q, q + 1 < M → previousLeaf q = currentLeaf q) →
      ((inclusionOf 0 N (M - 1)).map (rangeDigest currentLeaf)).foldlM walkStep
          ⟨M - 1, N - 1, previousLeaf (M - 1), currentLeaf (M - 1)⟩ =
        .ok ⟨0, 0, rootOf previousLeaf 0 M, rootOf currentLeaf 0 N⟩ := by
  intro N
  induction N using Nat.strongRecOn with
  | ind N ih =>
    intro previousLeaf currentLeaf M hM hMN hagree
    by_cases hN : N = 1
    · subst hN
      obtain rfl : M = 1 := by omega
      rfl
    · have hhalf := ih ((N + 1) / 2) (by omega) (pairLeaf previousLeaf M)
        (pairLeaf currentLeaf N) ((M + 1) / 2) (by omega) (by omega) (by
          intro q hq
          unfold pairLeaf
          rw [ite_eq_left (show 2 * q + 1 < M by omega),
            ite_eq_left (show 2 * q + 1 < N by omega),
            hagree (2 * q) (by omega), hagree (2 * q + 1) (by omega)])
      rw [show ((M + 1) / 2 - 1) = (M - 1) / 2 by omega,
        show ((N + 1) / 2 - 1) = (N - 1) / 2 by omega,
        ← rootOf_pair previousLeaf M M 0 (by rfl) (by omega) (by omega),
        ← rootOf_pair currentLeaf N N 0 (by rfl) (by omega) (by omega)] at hhalf
      rw [inclusionOf_pair currentLeaf N N 0 (M - 1) (by rfl) (by omega) (by omega)
        (by omega), Nat.zero_div, List.foldlM_append]
      unfold levelZero
      by_cases hodd : (M - 1) % 2 = 1
      · rw [ite_eq_left hodd]
        simp only [List.foldlM_cons, List.foldlM_nil, Nat.zero_add]
        rw [walkStep_odd _ _ _ _ _ hodd (by omega)]
        simp only [bind, Except.bind, pure, Except.pure]
        rw [← hhalf]
        unfold pairLeaf
        rw [ite_eq_left (show 2 * ((M - 1) / 2) + 1 < M by omega),
          ite_eq_left (show 2 * ((M - 1) / 2) + 1 < N by omega),
          show 2 * ((M - 1) / 2) = M - 1 - 1 by omega,
          show M - 1 - 1 + 1 = M - 1 by omega, hagree (M - 1 - 1) (by omega)]
      · have heven : (M - 1) % 2 = 0 := by omega
        rw [ite_eq_right hodd]
        by_cases hnext : M - 1 + 1 < N
        · rw [ite_eq_left hnext]
          simp only [List.foldlM_cons, List.foldlM_nil, Nat.zero_add]
          rw [walkStep_even _ _ _ _ _ heven (by omega)]
          simp only [bind, Except.bind, pure, Except.pure]
          rw [← hhalf]
          unfold pairLeaf
          rw [ite_eq_right (show ¬2 * ((M - 1) / 2) + 1 < M by omega),
            ite_eq_left (show 2 * ((M - 1) / 2) + 1 < N by omega),
            show 2 * ((M - 1) / 2) = M - 1 by omega]
        · rw [ite_eq_right hnext]
          obtain rfl : M = N := by omega
          have hrest := inclusionOf_ne_nil 0 ((M - 1) / 2) (show 2 ≤ (M + 1) / 2 by omega)
          simp only [List.foldlM_nil, bind, Except.bind, pure, Except.pure]
          revert hhalf
          generalize hpath : inclusionOf 0 ((M + 1) / 2) ((M - 1) / 2) = path
          cases path with
          | nil => exact absurd hpath hrest
          | cons first rest =>
            intro hhalf
            rw [List.map_cons, foldlM_walkStep_cons, walkStep_merged _ _ _ _ heven (by omega),
              ← foldlM_walkStep_cons, ← List.map_cons, ← hhalf]
            unfold pairLeaf
            rw [ite_eq_right (show ¬2 * ((M - 1) / 2) + 1 < M by omega),
              show 2 * ((M - 1) / 2) = M - 1 by omega,
              ite_eq_right (show ¬M - 1 + 1 < M by omega)]

end Tearleads.Transparency
