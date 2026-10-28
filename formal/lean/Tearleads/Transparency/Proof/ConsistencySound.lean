import Tearleads.Transparency.Proof.Consistency

/-!
# Consistency soundness

`consistency_sound` proves `ConsistencySound`. The walk's shape (which node
joins which root on which side) depends only on the two sizes, so when the
current root it folds equals the honest one, injectivity of `Digest.node`
forces every consumed node, and the seed, to be the honest digest. The
previous root folded from those same nodes is then the honest prefix root.

The previous tree's last leaf is the seed, unknown until the walk pins it
down, so `walk_sound` carries it as a pointwise update of the leaf function.
-/

namespace Tearleads.Transparency

/-- `leaf` with the digest at `index` replaced. -/
def setLeaf (leaf : Nat → Digest) (index : Nat) (digest : Digest) : Nat → Digest :=
  fun q => if q = index then digest else leaf q

theorem setLeaf_self (leaf : Nat → Digest) (index : Nat) :
    setLeaf leaf index (leaf index) = leaf := by
  funext q
  unfold setLeaf
  split <;> simp_all

theorem foldlM_walkStep_error (init : Walk) (node : Digest) (rest : List Digest)
    (code : Code) (h : walkStep init node = .error code) :
    (node :: rest).foldlM walkStep init = .error code := by
  rw [List.foldlM_cons, h]
  rfl

/-- From any seed pair and any nodes, a walk whose current root is honest
consumed the honest current-tree seed, and its previous root is the previous
tree's root with the previous seed as its last leaf. -/
theorem walk_sound :
    ∀ N (previousLeaf currentLeaf : Nat → Digest) M (previousSeed currentSeed : Digest)
      (nodes : List Digest) (walk : Walk), 1 ≤ M → M ≤ N →
      (∀ q, q + 1 < M → previousLeaf q = currentLeaf q) →
      previousLeaf (M - 1) = previousSeed →
      nodes.foldlM walkStep ⟨M - 1, N - 1, previousSeed, currentSeed⟩ = .ok walk →
      walk.second = 0 → walk.currentRoot = rootOf currentLeaf 0 N →
      currentSeed = currentLeaf (M - 1) ∧ walk.previousRoot = rootOf previousLeaf 0 M := by
  intro N
  induction N using Nat.strongRecOn with
  | ind N ih =>
    intro previousLeaf currentLeaf M previousSeed currentSeed nodes walk hM hMN hagree hseed
      hrun hsecond hcurrent
    cases nodes with
    | nil =>
      cases hrun
      obtain rfl : N = 1 := by simp at hsecond; omega
      obtain rfl : M = 1 := by omega
      exact ⟨hcurrent, hseed.symm⟩
    | cons node rest =>
      have hN : 2 ≤ N := by
        refine Nat.lt_of_not_le fun hle => ?_
        obtain rfl : N = 1 := by omega
        obtain rfl : M = 1 := by omega
        have : walkStep ⟨0, 0, previousSeed, currentSeed⟩ node = .error .invalidShape := by
          simp [walkStep]
        rw [foldlM_walkStep_error _ _ _ _ this] at hrun
        cases hrun
      have hcurrent' : walk.currentRoot =
          rootOf (pairLeaf currentLeaf N) 0 ((N + 1) / 2) := by
        rw [hcurrent, rootOf_pair currentLeaf N N 0 (by rfl) (by omega) (by omega)]
      have hpairs : ∀ q, q + 1 < (M + 1) / 2 →
          pairLeaf previousLeaf M q = pairLeaf currentLeaf N q := by
        intro q hq
        unfold pairLeaf
        rw [ite_eq_left (show 2 * q + 1 < M by omega),
          ite_eq_left (show 2 * q + 1 < N by omega),
          hagree (2 * q) (by omega), hagree (2 * q + 1) (by omega)]
      have hprevious : rootOf previousLeaf 0 M =
          rootOf (pairLeaf previousLeaf M) 0 ((M + 1) / 2) :=
        rootOf_pair previousLeaf M M 0 (by rfl) (by omega) (by omega)
      rw [List.foldlM_cons] at hrun
      by_cases hodd : (M - 1) % 2 = 1
      · rw [walkStep_odd _ _ _ _ _ hodd (by omega)] at hrun
        let upper := setLeaf (pairLeaf previousLeaf M) ((M + 1) / 2 - 1)
          (.node node previousSeed)
        have hstate : (⟨(M - 1) / 2, (N - 1) / 2, .node node previousSeed,
            .node node currentSeed⟩ : Walk) = ⟨(M + 1) / 2 - 1, (N + 1) / 2 - 1,
            .node node previousSeed, .node node currentSeed⟩ := by
          congr 1 <;> omega
        rw [hstate] at hrun
        have ⟨hseed', hroot⟩ := ih ((N + 1) / 2) (by omega) upper (pairLeaf currentLeaf N)
          ((M + 1) / 2) _ _ rest walk (by omega) (by omega)
          (fun q hq => by
            simp only [upper, setLeaf, ite_eq_right (show q ≠ (M + 1) / 2 - 1 by omega)]
            exact hpairs q hq)
          (by simp [upper, setLeaf]) hrun hsecond hcurrent'
        unfold pairLeaf at hseed'
        rw [ite_eq_left (show 2 * ((M + 1) / 2 - 1) + 1 < N by omega),
          show 2 * ((M + 1) / 2 - 1) = M - 1 - 1 by omega,
          show M - 1 - 1 + 1 = M - 1 by omega] at hseed'
        injection hseed' with hnode hcurrentSeed
        refine ⟨hcurrentSeed, ?_⟩
        have hupper : upper = pairLeaf previousLeaf M := by
          funext q
          simp only [upper, setLeaf]
          split
          · rename_i hq
            subst hq
            unfold pairLeaf
            rw [ite_eq_left (show 2 * ((M + 1) / 2 - 1) + 1 < M by omega),
              show 2 * ((M + 1) / 2 - 1) = M - 1 - 1 by omega,
              show M - 1 - 1 + 1 = M - 1 by omega, hseed, hnode,
              hagree (M - 1 - 1) (by omega)]
          · rfl
        rw [hroot, hupper, hprevious]
      · have heven : (M - 1) % 2 = 0 := by omega
        have hupperSeed : pairLeaf previousLeaf M ((M + 1) / 2 - 1) = previousSeed := by
          unfold pairLeaf
          rw [ite_eq_right (show ¬2 * ((M + 1) / 2 - 1) + 1 < M by omega),
            show 2 * ((M + 1) / 2 - 1) = M - 1 by omega, hseed]
        by_cases hnext : M - 1 < N - 1
        · rw [walkStep_even _ _ _ _ _ heven hnext] at hrun
          have hstate : (⟨(M - 1) / 2, (N - 1) / 2, previousSeed,
              .node currentSeed node⟩ : Walk) = ⟨(M + 1) / 2 - 1, (N + 1) / 2 - 1,
              previousSeed, .node currentSeed node⟩ := by
            congr 1 <;> omega
          rw [hstate] at hrun
          have ⟨hseed', hroot⟩ := ih ((N + 1) / 2) (by omega) (pairLeaf previousLeaf M)
            (pairLeaf currentLeaf N) ((M + 1) / 2) _ _ rest walk (by omega) (by omega)
            hpairs hupperSeed hrun hsecond hcurrent'
          unfold pairLeaf at hseed'
          rw [ite_eq_left (show 2 * ((M + 1) / 2 - 1) + 1 < N by omega),
            show 2 * ((M + 1) / 2 - 1) = M - 1 by omega] at hseed'
          injection hseed' with hcurrentSeed
          exact ⟨hcurrentSeed, by rw [hroot, hprevious]⟩
        · obtain rfl : M = N := by omega
          rw [← List.foldlM_cons] at hrun
          rw [foldlM_walkStep_cons, walkStep_merged _ _ _ _ heven (by omega),
            ← foldlM_walkStep_cons] at hrun
          rw [show (M - 1) / 2 = (M + 1) / 2 - 1 by omega] at hrun
          have ⟨hseed', hroot⟩ := ih ((M + 1) / 2) (by omega) (pairLeaf previousLeaf M)
            (pairLeaf currentLeaf M) ((M + 1) / 2) _ _ (node :: rest) walk (by omega)
            (by omega) hpairs hupperSeed hrun hsecond hcurrent'
          unfold pairLeaf at hseed'
          rw [ite_eq_right (show ¬2 * ((M + 1) / 2 - 1) + 1 < M by omega),
            show 2 * ((M + 1) / 2 - 1) = M - 1 by omega] at hseed'
          exact ⟨hseed', by rw [hroot, hprevious]⟩

theorem consistencyRoots_sound :
    ∀ previous (leaf : Nat → Digest) size previousRoot nodes computedPrevious
      computedCurrent, 1 ≤ previous → previous < size →
      consistencyRoots previous size previousRoot nodes =
        .ok (computedPrevious, computedCurrent) →
      computedCurrent = rootOf leaf 0 size → computedPrevious = previousRoot →
      previousRoot = rootOf leaf 0 previous := by
  intro previous
  induction previous using Nat.strongRecOn with
  | ind previous ih =>
    intro leaf size previousRoot nodes computedPrevious computedCurrent h1 hlt hrun hcurrent
      hprevious
    by_cases hodd : previous % 2 = 1
    · rw [consistencyRoots_odd size _ _ hodd] at hrun
      generalize hpath : (if previous - 1 = 0 then previousRoot :: nodes else nodes) = path
        at hrun
      cases path with
      | nil => cases hrun
      | cons seed rest =>
        simp only [bind, Except.bind] at hrun
        generalize hwalk : rest.foldlM walkStep
          ⟨previous - 1, size - 1, seed, seed⟩ = result at hrun
        cases result with
        | error => cases hrun
        | ok walk =>
          simp only at hrun
          by_cases hsecond : walk.second = 0
          · simp only [hsecond, ne_eq, not_true_eq_false, ite_false, pure, Except.pure] at hrun
            injection hrun with hpair
            injection hpair with hp hc
            have ⟨hseed, hroot⟩ := walk_sound size (setLeaf leaf (previous - 1) seed) leaf
              previous seed seed rest walk h1 (by omega)
              (fun q hq => by simp [setLeaf, show q ≠ previous - 1 by omega])
              (by simp [setLeaf]) hwalk hsecond (by rw [hc, hcurrent])
            rw [hseed, setLeaf_self] at hroot
            rw [← hprevious, ← hp, hroot]
          · simp only [hsecond, ne_eq, not_false_eq_true, ite_true] at hrun
            cases hrun
    · have heven : previous % 2 = 0 := by omega
      rw [consistencyRoots_even size _ _ heven (by omega)] at hrun
      have := ih (previous / 2) (by omega) (pairLeaf leaf size) ((size + 1) / 2) previousRoot
        nodes computedPrevious computedCurrent (by omega) (by omega) hrun
        (by rw [hcurrent, rootOf_pair leaf size size 0 rfl (by omega) (Or.inr (by omega)),
          Nat.zero_div])
        hprevious
      rw [this, rootOf_pair leaf size previous 0 rfl (by omega) (Or.inl heven), Nat.zero_div,
        show (previous + 1) / 2 = previous / 2 by omega]

/-- Gate F3: against an honest current root, an accepted consistency proof
pins the previous root to the root of the current tree's prefix. -/
theorem consistency_sound : ConsistencySound := by
  intro values previous size previousRoot nodes haccepted
  unfold verifyConsistency at haccepted
  by_cases hrollback : size < previous
  · simp [hrollback] at haccepted
  simp only [hrollback, ite_false] at haccepted
  by_cases hempty : (previous = 0 ∧ previousRoot ≠ .empty) ∨
      (size = 0 ∧ root values size ≠ .empty)
  · simp only [hempty, ite_true] at haccepted
    cases haccepted
  simp only [hempty, ite_false] at haccepted
  by_cases hzero : previous = 0
  · subst hzero
    simp only [true_and, ne_eq, not_or, Decidable.not_not] at hempty
    exact hempty.1
  simp only [hzero, ite_false] at haccepted
  by_cases hsame : previous = size
  · subst hsame
    by_cases hnodes : nodes.isEmpty
    · simp only [hnodes, Bool.not_true, Bool.false_eq_true, ite_false] at haccepted
      by_cases hroot : previousRoot = root values previous
      · exact hroot
      · simp [hroot] at haccepted
    · simp [hnodes] at haccepted
  simp only [hsame, ite_false] at haccepted
  generalize hrun : consistencyRoots previous size previousRoot nodes = result at haccepted
  rcases result with code | ⟨computedPrevious, computedCurrent⟩
  · cases haccepted
  · simp only at haccepted
    by_cases hp : computedPrevious = previousRoot
    · by_cases hc : computedCurrent = root values size
      · exact consistencyRoots_sound previous (leafDigest values) size previousRoot nodes
          computedPrevious computedCurrent (by omega) (by omega) hrun hc hp
      · simp [hp, hc] at haccepted
    · simp [hp] at haccepted

/-- info: 'Tearleads.Transparency.consistency_sound' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms consistency_sound

end Tearleads.Transparency
