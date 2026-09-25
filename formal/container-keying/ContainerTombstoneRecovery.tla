--------------------- MODULE ContainerTombstoneRecovery ---------------------
EXTENDS Naturals, FiniteSets
CONSTANTS PreserveWork, FenceAllRemoved, UseGeneration, IgnoreUnsignedClock, RetainGeneration
ASSUME {PreserveWork, FenceAllRemoved, UseGeneration, IgnoreUnsignedClock, RetainGeneration} \subseteq BOOLEAN
Objects == {"parent", "child"}
Work == {"rename", "create", "move"}
VARIABLES visible, work, generation, fetched, live, moved, removedAt,
          removalRevision, fetchedRevision, visibleRevision
vars == <<visible, work, generation, fetched, live, moved, removedAt,
          removalRevision, fetchedRevision, visibleRevision>>

Init ==
  /\ visible = Objects /\ work = Work /\ live = Objects /\ moved = FALSE
  /\ generation = [o \in Objects |-> 0]
  /\ fetched = [o \in Objects |-> 3]
  /\ removedAt = [o \in Objects |-> 0]
  /\ removalRevision = [o \in Objects |-> 0]
  /\ fetchedRevision = [o \in Objects |-> 3]
  /\ visibleRevision = [o \in Objects |-> 0]

MoveChild == /\ ~moved /\ moved' = TRUE
             /\ UNCHANGED <<visible, work, generation, fetched, live, removedAt,
                             removalRevision, fetchedRevision, visibleRevision>>
DeleteParent == /\ moved /\ "parent" \in live
                /\ live' = live \ {"parent"}
                /\ UNCHANGED <<visible, work, generation, fetched, moved, removedAt,
                                removalRevision, fetchedRevision, visibleRevision>>

(* Removal revisions describe actual local cascades, independently of which
   generation fences the implementation installs. No server clock is trusted. *)
ObserveHint ==
  /\ removalRevision["parent"] < 2
  /\ visible' = {}
  /\ work' = IF PreserveWork THEN work ELSE {}
  /\ removalRevision' = [o \in Objects |-> removalRevision[o] + 1]
  /\ generation' = [o \in Objects |->
       IF o = "parent" \/ FenceAllRemoved
       THEN IF RetainGeneration \/ o \notin visible THEN generation[o] + 1 ELSE 1
       ELSE generation[o]]
  /\ removedAt' = [o \in Objects |-> 2]
  /\ UNCHANGED <<fetched, live, moved, fetchedRevision, visibleRevision>>

(* A request records its observation before obtaining a verified live proof.
   It may be committed after a later local cascade. *)
Fetch(o) == /\ o \in live
            /\ fetched' = [fetched EXCEPT ![o] = generation[o]]
            /\ fetchedRevision' = [fetchedRevision EXCEPT ![o] = removalRevision[o]]
            /\ UNCHANGED <<visible, work, generation, live, moved, removedAt,
                            removalRevision, visibleRevision>>
Restore(o) ==
  /\ o \in live /\ fetched[o] # 3
  /\ ~UseGeneration \/ fetched[o] = generation[o]
  /\ IgnoreUnsignedClock \/ removedAt[o] < 1
  /\ visible' = visible \cup {o}
  /\ visibleRevision' = [visibleRevision EXCEPT ![o] = fetchedRevision[o]]
  /\ UNCHANGED <<work, generation, fetched, live, moved, removedAt,
                  removalRevision, fetchedRevision>>

Next == MoveChild \/ DeleteParent \/ ObserveHint \/
        (\E o \in Objects : Fetch(o) \/ Restore(o))
Spec == Init /\ [][Next]_vars
TypeOK == /\ visible \subseteq Objects /\ work \subseteq Work
          /\ generation \in [Objects -> 0..2] /\ fetched \in [Objects -> 0..3]
          /\ live \subseteq Objects /\ moved \in BOOLEAN
          /\ removedAt \in [Objects -> 0..2]
          /\ removalRevision \in [Objects -> 0..2]
          /\ fetchedRevision \in [Objects -> 0..3]
          /\ visibleRevision \in [Objects -> 0..2]
LocalWorkSurvives == work = Work
LateProofNeverRestores ==
  \A o \in visible : visibleRevision[o] = removalRevision[o]
ObservedLiveProofCanRestore ==
  \A o \in live : fetchedRevision[o] = removalRevision[o] => ENABLED Restore(o)
MovedChildCanRecover ==
  (moved /\ "parent" \notin live /\ fetchedRevision["child"] = removalRevision["child"])
    => ENABLED Restore("child")
=============================================================================
