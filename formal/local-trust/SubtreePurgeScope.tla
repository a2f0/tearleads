-------------------------- MODULE SubtreePurgeScope --------------------------
EXTENDS Naturals

CONSTANTS CheckCandidatePath, CheckRequestPath, CheckServerPath, CheckPendingMove,
          CheckRootPendingMove
ASSUME {CheckCandidatePath, CheckRequestPath, CheckServerPath,
        CheckPendingMove, CheckRootPendingMove} \subseteq BOOLEAN

VARIABLES kind, inside, initiallyInside, listed, moved, pending, phase,
          requestInside, version, requestVersion, deleted, escaped, lostMove
vars == <<kind, inside, initiallyInside, listed, moved, pending, phase,
          requestInside, version, requestVersion, deleted, escaped, lostMove>>

Init ==
  /\ kind \in {"local", "document", "container"}
  /\ inside \in BOOLEAN /\ initiallyInside = inside
  /\ listed \in BOOLEAN
  /\ moved = FALSE /\ pending = "none" /\ phase = "candidate"
  /\ requestInside = FALSE /\ version = 0 /\ requestVersion = 0
  /\ deleted = FALSE /\ escaped = FALSE /\ lostMove = FALSE

(* Unsigned listing membership selects a candidate, never deletion authority. *)
CheckCandidate ==
  /\ phase = "candidate"
  /\ phase' = IF listed /\ (~CheckCandidatePath \/ inside)
              THEN "verified" ELSE "done"
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, pending,
                  requestInside, version, requestVersion, deleted, escaped, lostMove>>

(* One honest remote move can land before or after request preparation. Local
   row CAS races are covered separately; this model keeps local ancestry fixed. *)
Move ==
  /\ kind # "local" /\ ~moved /\ phase # "done"
  /\ inside' = ~inside /\ version' = 1 /\ moved' = TRUE
  /\ UNCHANGED <<kind, initiallyInside, listed, pending, phase, requestInside,
                  requestVersion, deleted, escaped, lostMove>>

RestoreIntent ==
  /\ pending = "none" /\ phase # "done"
  /\ pending' \in {"candidate", "root"}
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, phase,
                  requestInside, version, requestVersion, deleted, escaped, lostMove>>

Prepare ==
  /\ phase = "verified"
  /\ requestInside' = inside /\ requestVersion' = version
  /\ phase' = IF kind = "document" /\ CheckRequestPath /\ ~inside
              THEN "done" ELSE "prepared"
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, pending,
                  version, deleted, escaped, lostMove>>

CanCommit ==
  /\ ~CheckPendingMove \/ pending # "candidate"
  /\ ~CheckRootPendingMove \/ pending # "root"
  /\ CASE kind = "document" -> requestVersion = version
       [] kind = "container" -> ~CheckServerPath \/ inside
       [] OTHER -> TRUE

Commit ==
  /\ phase = "prepared" /\ phase' = "done"
  /\ deleted' = CanCommit
  /\ escaped' = (CanCommit /\ ~inside)
  /\ lostMove' = (CanCommit /\ pending # "none")
  /\ UNCHANGED <<kind, inside, initiallyInside, listed, moved, pending,
                  requestInside, version, requestVersion>>

Next == CheckCandidate \/ Move \/ RestoreIntent \/ Prepare \/ Commit
        \/ (phase = "done" /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(CheckCandidate)
        /\ WF_vars(Prepare) /\ WF_vars(Commit)
TypeOK ==
  /\ kind \in {"local", "document", "container"}
  /\ {inside, initiallyInside, listed, moved, requestInside,
       deleted, escaped, lostMove} \subseteq BOOLEAN
  /\ pending \in {"none", "candidate", "root"}
  /\ phase \in {"candidate", "verified", "prepared", "done"}
  /\ version \in 0..1 /\ requestVersion \in 0..1
DeletionStaysInScope == ~escaped
PendingMoveSurvives == ~lostMove
HonestQuiescentPurgeSucceeds ==
  (phase = "done" /\ initiallyInside /\ listed /\ ~moved /\ pending = "none") => deleted
PurgeTerminates == <>(phase = "done")
=============================================================================
