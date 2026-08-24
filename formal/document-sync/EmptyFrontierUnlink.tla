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
(* between the emptiness proof and the unlink commit, and TLC finds the    *)
(* NoDataLoss violation — the lock is load-bearing, not incidental.        *)
(***************************************************************************)

CONSTANTS MaxUpdates, LockedUnlink

ASSUME /\ MaxUpdates \in Nat \ {0}
       /\ LockedUnlink \in BOOLEAN

(* `uncovered` counts committed updates not covered by any accepted        *)
(* rotation baseline. `lost` records that a rotation orphaned at least one *)
(* such update.                                                            *)
VARIABLES uncovered, unlinkPhase, observedEmpty, lost

vars == << uncovered, unlinkPhase, observedEmpty, lost >>

TypeOK ==
  /\ uncovered \in 0..MaxUpdates
  /\ unlinkPhase \in {"idle", "checking"}
  /\ observedEmpty \in BOOLEAN
  /\ lost \in BOOLEAN

Init ==
  /\ uncovered = 0
  /\ unlinkPhase = "idle"
  /\ observedEmpty = FALSE
  /\ lost = FALSE

(* Sync writers hold the exclusive manifest-head lock, so with the lock    *)
(* discipline in force they cannot commit while an unlink transaction is   *)
(* between its emptiness proof and its commit.                             *)
WriterMayCommit == unlinkPhase = "idle" \/ ~LockedUnlink

Write ==
  /\ WriterMayCommit
  /\ uncovered < MaxUpdates
  /\ uncovered' = uncovered + 1
  /\ UNCHANGED << unlinkPhase, observedEmpty, lost >>

BeginBaselinelessUnlink ==
  /\ unlinkPhase = "idle"
  /\ unlinkPhase' = "checking"
  /\ observedEmpty' = (uncovered = 0)
  /\ UNCHANGED << uncovered, lost >>

(* The emptiness proof passed: rotate without a baseline. Any update that  *)
(* slipped in since the observation is orphaned by the rotation.           *)
CommitBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ observedEmpty
  /\ unlinkPhase' = "idle"
  /\ lost' = (lost \/ uncovered > 0)
  /\ UNCHANGED << uncovered, observedEmpty >>

(* The emptiness proof failed: the mutation is rejected as a conflict and  *)
(* the client must retry with a covering baseline.                         *)
RejectBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ ~observedEmpty
  /\ unlinkPhase' = "idle"
  /\ UNCHANGED << uncovered, observedEmpty, lost >>

(* A baseline-carrying unlink under the same lock: the full-history        *)
(* baseline covers the commit-time frontier atomically, so every           *)
(* previously uncovered update becomes covered.                            *)
CommitCoveringUnlink ==
  /\ unlinkPhase = "idle"
  /\ uncovered' = 0
  /\ UNCHANGED << unlinkPhase, observedEmpty, lost >>

Next ==
  \/ Write
  \/ BeginBaselinelessUnlink
  \/ CommitBaselinelessUnlink
  \/ RejectBaselinelessUnlink
  \/ CommitCoveringUnlink

Spec == Init /\ [][Next]_vars

NoDataLoss == ~lost

(* With the lock held, the emptiness observation stays true through the    *)
(* commit window.                                                          *)
BaselinelessUnlinkRequiresEmptyFrontier ==
  (unlinkPhase = "checking" /\ observedEmpty /\ LockedUnlink)
    => uncovered = 0

=============================================================================
