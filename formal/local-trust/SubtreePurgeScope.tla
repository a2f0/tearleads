-------------------------- MODULE SubtreePurgeScope --------------------------
EXTENDS Naturals

CONSTANTS CheckCandidatePath, CheckRequestPath, CheckServerPath, CheckPendingMove,
          CheckRootPendingMove, CheckLocalPlacement, CheckLocalContainerPlacement,
          CaptureLocalScope, CheckSettledRootPlacement
ASSUME {CheckCandidatePath, CheckRequestPath, CheckServerPath,
        CheckPendingMove, CheckRootPendingMove, CheckLocalPlacement,
        CheckLocalContainerPlacement, CaptureLocalScope,
        CheckSettledRootPlacement} \subseteq BOOLEAN

VARIABLES kind, inside, initiallyInside, listed, moved, rootMoved, pending, phase,
          requestInside, version, requestVersion, deleted, escaped, lostMove
vars == <<kind, inside, initiallyInside, listed, moved, rootMoved, pending, phase,
          requestInside, version, requestVersion, deleted, escaped, lostMove>>

Init ==
  /\ kind \in {"local", "local-container", "document", "container"}
  /\ inside \in BOOLEAN /\ initiallyInside = inside
  /\ listed \in BOOLEAN
  /\ rootMoved = FALSE
  /\ moved = FALSE /\ pending = "none" /\ phase = "candidate"
  /\ requestInside = FALSE /\ version = 0 /\ requestVersion = 0
  /\ deleted = FALSE /\ escaped = FALSE /\ lostMove = FALSE

(* Unsigned listing membership selects a candidate, never deletion authority. *)
CheckCandidate ==
  /\ phase = "candidate"
  /\ requestVersion' = version
  /\ phase' = IF listed /\ (~CheckCandidatePath \/ inside)
              THEN "verified" ELSE "done"
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, rootMoved, pending,
                  requestInside, version, deleted, escaped, lostMove>>

(* One remote move, local document move, or local ancestor move can land
   before or after request preparation. Local deletion rechecks inside its tx. *)
Move ==
  /\ ~moved /\ phase # "done"
  /\ inside' = ~inside /\ version' = 1 /\ moved' = TRUE
  /\ UNCHANGED <<kind, initiallyInside, listed, rootMoved, pending, phase, requestInside,
                  requestVersion, deleted, escaped, lostMove>>

RestoreIntent ==
  /\ pending = "none" /\ phase # "done"
  /\ pending' \in {"candidate", "root"}
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, rootMoved, phase,
                  requestInside, version, requestVersion, deleted, escaped, lostMove>>

(* Another device restores the selected root; hydration has no local intent. *)
RestoreRoot ==
  /\ ~rootMoved /\ phase # "done"
  /\ rootMoved' = TRUE
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, pending, phase,
                  requestInside, version, requestVersion, deleted, escaped, lostMove>>

Prepare ==
  /\ phase = "verified"
  /\ requestInside' = inside
  /\ requestVersion' = IF kind \in {"local", "local-container"}
                        THEN requestVersion ELSE version
  /\ phase' = IF kind = "document" /\ CheckRequestPath /\ ~inside
              THEN "done" ELSE "prepared"
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, rootMoved, pending,
                  version, deleted, escaped, lostMove>>

LocalPlacementCurrent ==
  (IF CaptureLocalScope THEN requestVersion ELSE version) = version

CanCommit ==
  /\ ~CheckSettledRootPlacement \/ ~rootMoved
  /\ ~CheckPendingMove \/ pending # "candidate"
  /\ ~CheckRootPendingMove \/ pending # "root"
  /\ CASE kind = "document" -> requestVersion = version
       [] kind = "container" -> ~CheckServerPath \/ inside
       [] kind = "local" -> ~CheckLocalPlacement \/ LocalPlacementCurrent
       [] OTHER -> ~CheckLocalContainerPlacement \/ LocalPlacementCurrent

Commit ==
  /\ phase = "prepared" /\ phase' = "done"
  /\ deleted' = CanCommit
  /\ escaped' = (CanCommit /\ (~inside \/ rootMoved))
  /\ lostMove' = (CanCommit /\ pending # "none")
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, rootMoved, pending,
                  requestInside, version, requestVersion>>

Next == CheckCandidate \/ Move \/ RestoreIntent \/ RestoreRoot \/ Prepare \/ Commit
        \/ (phase = "done" /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(CheckCandidate)
        /\ WF_vars(Prepare) /\ WF_vars(Commit)
TypeOK ==
  /\ kind \in {"local", "local-container", "document", "container"}
  /\ {inside, initiallyInside, listed, moved, rootMoved, requestInside,
       deleted, escaped, lostMove} \subseteq BOOLEAN
  /\ pending \in {"none", "candidate", "root"}
  /\ phase \in {"candidate", "verified", "prepared", "done"}
  /\ version \in 0..1 /\ requestVersion \in 0..1
DeletionStaysInScope == ~escaped
PendingMoveSurvives == ~lostMove
HonestQuiescentPurgeSucceeds ==
  (phase = "done" /\ initiallyInside /\ listed /\ ~moved /\ ~rootMoved /\ pending = "none") => deleted
PurgeTerminates == <>(phase = "done")
=============================================================================
