------------------------ MODULE EmptyFrontierUnlink ------------------------
EXTENDS Naturals

(***************************************************************************)
(* Acceptance gates for content-key epoch advances without a covering      *)
(* baseline: a baseline-less document unlink, and a link that advances the *)
(* epoch.                                                                  *)
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
(* RequireEmptyFrontierOnLinkAdvance = FALSE is the pre-fix server, which  *)
(* accepted the advance, and TLC finds the NoDataLoss violation.           *)
(*                                                                         *)
(* A rotation baseline covers history only under the epoch it is sealed    *)
(* to, and it is itself a committed update. A later epoch advance without  *)
(* a new baseline strands it too, so both gates ask whether any update is  *)
(* committed (hasCommittedDocumentUpdate), not whether one is uncovered.   *)
(* FrontierCheck = "uncovered" is a server that checked only the uncovered *)
(* frontier: after a covering unlink, TLC finds a link advance that        *)
(* strands the baseline.                                                   *)
(***************************************************************************)

CONSTANTS MaxUpdates, LockedUnlink, RequireEmptyFrontierOnLinkAdvance,
          FrontierCheck

ASSUME /\ MaxUpdates \in Nat \ {0}
       /\ LockedUnlink \in BOOLEAN
       /\ RequireEmptyFrontierOnLinkAdvance \in BOOLEAN
       /\ FrontierCheck \in {"committed", "uncovered"}

(* `uncovered` counts committed updates not covered by any accepted        *)
(* rotation baseline. `lost` records that a rotation orphaned at least one *)
(* such update.                                                            *)
(* `covered` is the frontier a covering unlink's baseline was checked      *)
(* against. `committed` records that the document has any committed        *)
(* update, rotation baselines included.                                    *)
VARIABLES uncovered, committed, unlinkPhase, observedEmpty, covered, lost

vars == << uncovered, committed, unlinkPhase, observedEmpty, covered, lost >>

TypeOK ==
  /\ uncovered \in 0..MaxUpdates
  /\ committed \in BOOLEAN
  /\ unlinkPhase \in {"idle", "checking", "covering"}
  /\ observedEmpty \in BOOLEAN
  /\ covered \in 0..MaxUpdates
  /\ lost \in BOOLEAN

Init ==
  /\ uncovered = 0
  /\ committed = FALSE
  /\ unlinkPhase = "idle"
  /\ observedEmpty = FALSE
  /\ covered = 0
  /\ lost = FALSE

(* The emptiness proof both gates share. Production asks whether any       *)
(* update is committed.                                                    *)
FrontierEmpty ==
  IF FrontierCheck = "committed" THEN ~committed ELSE uncovered = 0

(* Sync writers hold the exclusive manifest-head lock, so with the lock    *)
(* discipline in force they cannot commit while an unlink transaction is   *)
(* between its emptiness proof and its commit.                             *)
WriterMayCommit == unlinkPhase = "idle" \/ ~LockedUnlink

Write ==
  /\ WriterMayCommit
  /\ uncovered < MaxUpdates
  /\ uncovered' = uncovered + 1
  /\ committed' = TRUE
  /\ UNCHANGED << unlinkPhase, observedEmpty, covered, lost >>

BeginBaselinelessUnlink ==
  /\ unlinkPhase = "idle"
  /\ unlinkPhase' = "checking"
  /\ observedEmpty' = FrontierEmpty
  /\ UNCHANGED << uncovered, committed, covered, lost >>

(* The emptiness proof passed: rotate without a baseline. Any committed    *)
(* update, covered under an older epoch or not, is orphaned by the         *)
(* rotation.                                                               *)
CommitBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ observedEmpty
  /\ unlinkPhase' = "idle"
  /\ lost' = (lost \/ committed)
  /\ UNCHANGED << uncovered, committed, observedEmpty, covered >>

(* The emptiness proof failed: the mutation is rejected as a conflict and  *)
(* the client must retry with a covering baseline.                         *)
RejectBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ ~observedEmpty
  /\ unlinkPhase' = "idle"
  /\ UNCHANGED << uncovered, committed, observedEmpty, covered, lost >>

(* A baseline-carrying unlink under the same lock. The server checks that  *)
(* the full-history baseline covers the committed frontier               *)
(* (assertAtomicRotationBaselineCoversCommittedFrontier); a baseline that  *)
(* falls short is refused. The rotation then covers what was checked.      *)
CheckCoveringUnlink ==
  /\ unlinkPhase = "idle"
  /\ unlinkPhase' = "covering"
  /\ covered' = uncovered
  /\ UNCHANGED << uncovered, committed, observedEmpty, lost >>

(* Any update committed after the check is orphaned by the rotation. The   *)
(* baseline is appended as a committed update                              *)
(* (appendAtomicRotationBaseline).                                         *)
CommitCoveringUnlink ==
  /\ unlinkPhase = "covering"
  /\ unlinkPhase' = "idle"
  /\ lost' = (lost \/ uncovered > covered)
  /\ uncovered' = 0
  /\ committed' = TRUE
  /\ UNCHANGED << observedEmpty, covered >>

(* A link advancing the content-key epoch, checked and committed in one    *)
(* locked transaction. It carries no baseline, so it strands every         *)
(* committed update, and may proceed only over an empty frontier.          *)
LinkAdvancesEpoch ==
  /\ unlinkPhase = "idle"
  /\ ~RequireEmptyFrontierOnLinkAdvance \/ FrontierEmpty
  /\ lost' = (lost \/ committed)
  /\ UNCHANGED << uncovered, committed, unlinkPhase, observedEmpty, covered >>

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
    => FrontierEmpty

(* With the lock held, the frontier a covering baseline was checked        *)
(* against is still the committed frontier at commit.                      *)
CoveringUnlinkCoversFrontier ==
  (unlinkPhase = "covering" /\ LockedUnlink) => uncovered = covered

=============================================================================
