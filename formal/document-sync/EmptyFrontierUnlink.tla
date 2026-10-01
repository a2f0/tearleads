------------------------ MODULE EmptyFrontierUnlink ------------------------
EXTENDS Naturals

(***************************************************************************)
(* Acceptance gate for a baseline-less document unlink.                    *)
(*                                                                         *)
(* An unlink rotates the document content key. A committed update that no  *)
(* accepted rotation baseline covers becomes unreadable under the new      *)
(* epoch, so the server normally requires a full-history baseline whose    *)
(* source version vector covers the committed frontier                     *)
(* (assertAtomicRotationBaselineCoversCommittedFrontier). A document with  *)
(* an empty committed frontier has nothing to cover — its zero-span        *)
(* full-history snapshot cannot even encode a baseline — so the server     *)
(* instead proves emptiness inside the mutation transaction                *)
(* (assertBaselinelessUnlinkHasEmptyCommittedFrontier) while holding the   *)
(* document manifest-head write lock; sync writers take the same exclusive *)
(* lock.                                                                   *)
(*                                                                         *)
(* `LockedUnlink` models that lock discipline. The registered              *)
(* configuration checks LockedUnlink = TRUE, matching production, and the  *)
(* invariants hold. Setting it to FALSE lets a writer commit an update     *)
(* between the frontier check and the unlink commit, and TLC finds the     *)
(* NoDataLoss violation — the lock is load-bearing, not incidental. A      *)
(* covering unlink checks its baseline against the committed frontier in   *)
(* one step and commits in the next, under the same lock.                  *)
(*                                                                         *)
(* A link never carries a rotation baseline, so a link that advances the   *)
(* content-key epoch must find no committed update to strand               *)
(* (assertLinkKeepsCommittedContentKeyEpoch, #2365 finding 28).            *)
(* RequireBaselineOnEpochAdvance = FALSE is the pre-fix server, which      *)
(* accepted the advance, and TLC finds the NoDataLoss violation.           *)
(***************************************************************************)

CONSTANTS MaxUpdates, LockedUnlink, RequireBaselineOnEpochAdvance

ASSUME /\ MaxUpdates \in Nat \ {0}
       /\ LockedUnlink \in BOOLEAN
       /\ RequireBaselineOnEpochAdvance \in BOOLEAN

(* `uncovered` counts committed updates not covered by any accepted        *)
(* rotation baseline. `lost` records that a rotation orphaned at least one *)
(* such update.                                                            *)
(* `covered` is the frontier a covering unlink's baseline was checked      *)
(* against.                                                                *)
VARIABLES uncovered, unlinkPhase, observedEmpty, covered, lost

vars == << uncovered, unlinkPhase, observedEmpty, covered, lost >>

TypeOK ==
  /\ uncovered \in 0..MaxUpdates
  /\ unlinkPhase \in {"idle", "checking", "covering"}
  /\ observedEmpty \in BOOLEAN
  /\ covered \in 0..MaxUpdates
  /\ lost \in BOOLEAN

Init ==
  /\ uncovered = 0
  /\ unlinkPhase = "idle"
  /\ observedEmpty = FALSE
  /\ covered = 0
  /\ lost = FALSE

(* Sync writers hold the exclusive manifest-head lock, so with the lock    *)
(* discipline in force they cannot commit while an unlink transaction is   *)
(* between its emptiness proof and its commit.                             *)
WriterMayCommit == unlinkPhase = "idle" \/ ~LockedUnlink

Write ==
  /\ WriterMayCommit
  /\ uncovered < MaxUpdates
  /\ uncovered' = uncovered + 1
  /\ UNCHANGED << unlinkPhase, observedEmpty, covered, lost >>

BeginBaselinelessUnlink ==
  /\ unlinkPhase = "idle"
  /\ unlinkPhase' = "checking"
  /\ observedEmpty' = (uncovered = 0)
  /\ UNCHANGED << uncovered, covered, lost >>

(* The emptiness proof passed: rotate without a baseline. Any update that  *)
(* slipped in since the observation is orphaned by the rotation.           *)
CommitBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ observedEmpty
  /\ unlinkPhase' = "idle"
  /\ lost' = (lost \/ uncovered > 0)
  /\ UNCHANGED << uncovered, observedEmpty, covered >>

(* The emptiness proof failed: the mutation is rejected as a conflict and  *)
(* the client must retry with a covering baseline.                         *)
RejectBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ ~observedEmpty
  /\ unlinkPhase' = "idle"
  /\ UNCHANGED << uncovered, observedEmpty, covered, lost >>

(* A baseline-carrying unlink under the same lock. The server checks that  *)
(* the full-history baseline covers the committed frontier               *)
(* (assertAtomicRotationBaselineCoversCommittedFrontier); a baseline that  *)
(* falls short is refused. The rotation then covers what was checked.      *)
CheckCoveringUnlink ==
  /\ unlinkPhase = "idle"
  /\ unlinkPhase' = "covering"
  /\ covered' = uncovered
  /\ UNCHANGED << uncovered, observedEmpty, lost >>

(* Any update committed after the check is orphaned by the rotation.       *)
CommitCoveringUnlink ==
  /\ unlinkPhase = "covering"
  /\ unlinkPhase' = "idle"
  /\ lost' = (lost \/ uncovered > covered)
  /\ uncovered' = 0
  /\ UNCHANGED << observedEmpty, covered >>

(* A link advancing the content-key epoch, checked and committed in one    *)
(* locked transaction. It carries no baseline, so it may proceed only over *)
(* an empty uncovered frontier.                                            *)
LinkAdvancesEpoch ==
  /\ unlinkPhase = "idle"
  /\ ~RequireBaselineOnEpochAdvance \/ uncovered = 0
  /\ lost' = (lost \/ uncovered > 0)
  /\ UNCHANGED << uncovered, unlinkPhase, observedEmpty, covered >>

Next ==
  \/ Write
  \/ BeginBaselinelessUnlink
  \/ CommitBaselinelessUnlink
  \/ RejectBaselinelessUnlink
  \/ CheckCoveringUnlink
  \/ CommitCoveringUnlink
  \/ LinkAdvancesEpoch

Spec == Init /\ [][Next]_vars

NoDataLoss == ~lost

(* With the lock held, the emptiness observation stays true through the    *)
(* commit window.                                                          *)
BaselinelessUnlinkRequiresEmptyFrontier ==
  (unlinkPhase = "checking" /\ observedEmpty /\ LockedUnlink)
    => uncovered = 0

(* With the lock held, the frontier a covering baseline was checked        *)
(* against is still the committed frontier at commit.                      *)
CoveringUnlinkCoversFrontier ==
  (unlinkPhase = "covering" /\ LockedUnlink) => uncovered = covered

=============================================================================
