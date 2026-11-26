------------------------ MODULE EmptyFrontierUnlink ------------------------
EXTENDS Naturals

(***************************************************************************)
(* Acceptance gates for content-key epoch advances without a covering      *)
(* baseline: a baseline-less document unlink, and a link that advances the *)
(* epoch.                                                                  *)
(*                                                                         *)
(* An unlink rotates the document content key. A committed update that no  *)
(* accepted rotation baseline covers becomes unreadable under the new      *)
(* epoch, so the server normally requires a baseline, a group of segments  *)
(* carrying the whole history, whose spans together cover the committed    *)
(* frontier (assertAtomicRotationBaselineCoversCommittedFrontier). A       *)
(* document with an empty committed frontier has nothing to cover, and its *)
(* client sends no baseline: an empty one is sent only with a processed    *)
(* cursor, which a document never written lacks (#3194). The server proves *)
(* emptiness inside the mutation transaction                               *)
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
(* one step and commits in the next, under the same lock; a client's       *)
(* baseline may fall short of the committed frontier, and the server       *)
(* refuses it (CheckBaselineCoversFrontier = FALSE accepts it, and TLC      *)
(* finds the NoDataLoss violation). The baseline's segments commit whole   *)
(* with the unlink, in its transaction. CommitWholeBaseline = FALSE is a   *)
(* server that could keep only some of them: the rotation then covers less *)
(* than the gate checked, and TLC finds the NoDataLoss violation.          *)
(*                                                                         *)
(* A link never carries a rotation baseline, so a link that advances the   *)
(* content-key epoch must find no committed update to strand               *)
(* (assertLinkKeepsCommittedContentKeyEpoch, #2365 finding 28).            *)
(* RequireEmptyFrontierOnLinkAdvance = FALSE is the pre-fix server, which  *)
(* accepted the advance, and TLC finds the NoDataLoss violation.           *)
(*                                                                         *)
(* A rotation baseline covers history only under the epoch it is sealed    *)
(* to, and its segments are committed updates. A later advance without     *)
(* a new baseline strands it too, so both gates ask whether any update is  *)
(* committed (hasCommittedDocumentUpdate), not whether one is uncovered.   *)
(* FrontierCheck = "uncovered" is a server that checked only the uncovered *)
(* frontier: after a covering unlink, TLC finds a link advance that        *)
(* strands the baseline.                                                   *)
(***************************************************************************)

CONSTANTS MaxUpdates, LockedUnlink, RequireEmptyFrontierOnLinkAdvance,
          FrontierCheck, CheckBaselineCoversFrontier, BaselineFrontier,
          CommitWholeBaseline

ASSUME /\ MaxUpdates \in Nat \ {0}
       /\ LockedUnlink \in BOOLEAN
       /\ CommitWholeBaseline \in BOOLEAN
       /\ RequireEmptyFrontierOnLinkAdvance \in BOOLEAN
       /\ FrontierCheck \in {"committed", "uncovered"}
       /\ CheckBaselineCoversFrontier \in BOOLEAN
       /\ BaselineFrontier \in {"committed", "uncovered"}

(* `uncovered` counts committed updates not covered by any accepted        *)
(* rotation baseline. `lost` records that a rotation orphaned at least one *)
(* such update.                                                            *)
(* `covered` is the frontier a covering unlink's baseline was checked      *)
(* against. `committed` records that the document has any committed        *)
(* update, rotation baselines included; `total` counts them, a baseline's  *)
(* segments as one. A covering baseline carries the first `covered` of     *)
(* them, so it must cover `total`, earlier baselines included: those are   *)
(* sealed to an older epoch the rotation retires.                          *)
VARIABLES uncovered, committed, unlinkPhase, observedEmpty, covered, lost, total

vars == << uncovered, committed, unlinkPhase, observedEmpty, covered, lost, total >>

TypeOK ==
  /\ uncovered \in 0..MaxUpdates
  /\ committed \in BOOLEAN
  /\ unlinkPhase \in {"idle", "checking", "covering", "linking"}
  /\ observedEmpty \in BOOLEAN
  /\ covered \in 0..MaxUpdates
  /\ lost \in BOOLEAN
  /\ total \in 0..(MaxUpdates + 1)

Init ==
  /\ uncovered = 0
  /\ committed = FALSE
  /\ unlinkPhase = "idle"
  /\ observedEmpty = FALSE
  /\ covered = 0
  /\ lost = FALSE
  /\ total = 0

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
  /\ total < MaxUpdates
  /\ uncovered' = uncovered + 1
  /\ total' = total + 1
  /\ committed' = TRUE
  /\ UNCHANGED << unlinkPhase, observedEmpty, covered, lost >>

BeginBaselinelessUnlink ==
  /\ unlinkPhase = "idle"
  /\ unlinkPhase' = "checking"
  /\ observedEmpty' = FrontierEmpty
  /\ UNCHANGED << uncovered, committed, covered, lost, total >>

(* The emptiness proof passed: rotate without a baseline. Any committed    *)
(* update, covered under an older epoch or not, is orphaned by the         *)
(* rotation.                                                               *)
CommitBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ observedEmpty
  /\ unlinkPhase' = "idle"
  /\ lost' = (lost \/ committed)
  /\ UNCHANGED << uncovered, committed, observedEmpty, covered, total >>

(* The emptiness proof failed: the mutation is rejected as a conflict and  *)
(* the client must retry with a covering baseline.                         *)
RejectBaselinelessUnlink ==
  /\ unlinkPhase = "checking"
  /\ ~observedEmpty
  /\ unlinkPhase' = "idle"
  /\ UNCHANGED << uncovered, committed, observedEmpty, covered, lost, total >>

(* A baseline-carrying unlink under the same lock. The client's baseline   *)
(* covers whatever frontier it held, possibly short of the committed one.  *)
(* The server checks that it covers the committed frontier               *)
(* (assertAtomicRotationBaselineCoversCommittedFrontier) and refuses one    *)
(* that falls short. The rotation then covers what the baseline covers.   *)
(* A server that compared only the frontier since the latest baseline would *)
(* accept an empty one right after a rotation (BaselineFrontier).          *)
BaselineAccepted(b) ==
  \/ ~CheckBaselineCoversFrontier
  \/ b = total
  \/ BaselineFrontier = "uncovered" /\ uncovered = 0

CheckCoveringUnlink ==
  /\ unlinkPhase = "idle"
  /\ total < MaxUpdates
  /\ \E b \in 0..total :
       /\ BaselineAccepted(b)
       /\ unlinkPhase' = "covering"
       /\ covered' = b
  /\ UNCHANGED << uncovered, committed, observedEmpty, lost, total >>

(* The refusal branch: a short baseline is a conflict and the client       *)
(* retries with a fresh one. Nothing is committed.                         *)
RejectCoveringUnlink ==
  /\ unlinkPhase = "idle"
  /\ \E b \in 0..total : ~BaselineAccepted(b)
  /\ UNCHANGED vars

(* Any update committed after the check is orphaned by the rotation. The   *)
(* baseline's segments are appended as committed updates, every one or     *)
(* none (appendAtomicRotationBaseline). `stored` is how much of the        *)
(* checked coverage the committed segments carry: all of it when the group *)
(* commits whole.                                                          *)
CommitCoveringUnlink ==
  /\ unlinkPhase = "covering"
  /\ unlinkPhase' = "idle"
  /\ \E stored \in 0..covered :
       /\ CommitWholeBaseline => stored = covered
       /\ lost' = (lost \/ total > stored)
  /\ uncovered' = 0
  /\ total' = total + 1
  /\ committed' = TRUE
  /\ UNCHANGED << observedEmpty, covered >>

(* A link advancing the content-key epoch. It carries no baseline, so it  *)
(* strands every committed update, and may proceed only over an empty      *)
(* frontier. Its check and commit hold the same manifest-head lock as an  *)
(* unlink, so with the lock in force no writer commits in between.        *)
BeginLinkAdvance ==
  /\ unlinkPhase = "idle"
  /\ unlinkPhase' = "linking"
  /\ observedEmpty' = FrontierEmpty
  /\ UNCHANGED << uncovered, committed, covered, lost, total >>

LinkAdvancesEpoch ==
  /\ unlinkPhase = "linking"
  /\ ~RequireEmptyFrontierOnLinkAdvance \/ observedEmpty
  /\ unlinkPhase' = "idle"
  /\ lost' = (lost \/ committed)
  /\ UNCHANGED << uncovered, committed, observedEmpty, covered, total >>

(* The emptiness proof failed: the link keeps the current epoch. *)
RejectLinkAdvance ==
  /\ unlinkPhase = "linking"
  /\ RequireEmptyFrontierOnLinkAdvance /\ ~observedEmpty
  /\ unlinkPhase' = "idle"
  /\ UNCHANGED << uncovered, committed, observedEmpty, covered, lost, total >>

Next ==
  \/ Write
  \/ BeginBaselinelessUnlink
  \/ CommitBaselinelessUnlink
  \/ RejectBaselinelessUnlink
  \/ CheckCoveringUnlink
  \/ RejectCoveringUnlink
  \/ CommitCoveringUnlink
  \/ BeginLinkAdvance
  \/ LinkAdvancesEpoch
  \/ RejectLinkAdvance

Spec == Init /\ [][Next]_vars

NoDataLoss == ~lost

(* With the lock held, the emptiness observation stays true through the    *)
(* commit window of a baseline-less unlink or a link advance.              *)
BaselinelessUnlinkRequiresEmptyFrontier ==
  (unlinkPhase \in {"checking", "linking"} /\ observedEmpty /\ LockedUnlink)
    => FrontierEmpty

(* With the lock held, the frontier a covering baseline was checked        *)
(* against is still the committed frontier at commit.                      *)
CoveringUnlinkCoversFrontier ==
  (unlinkPhase = "covering" /\ LockedUnlink /\ CheckBaselineCoversFrontier
     /\ BaselineFrontier = "committed")
    => total = covered

=============================================================================
