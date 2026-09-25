--------------------- MODULE ContainerTombstoneRecovery ---------------------
EXTENDS Naturals, FiniteSets
CONSTANTS PreserveWork, FenceOnlyNamed, UseGeneration, IgnoreUnsignedClock
ASSUME {PreserveWork, FenceOnlyNamed, UseGeneration, IgnoreUnsignedClock} \subseteq BOOLEAN
Objects == {"parent", "child"}
Work == {"rename", "create", "move"}
VARIABLES visible, work, generation, fetched, live, moved, removedAt
vars == <<visible, work, generation, fetched, live, moved, removedAt>>

Init ==
  /\ visible = Objects
  /\ work = Work
  /\ generation = [o \in Objects |-> 0]
  /\ fetched = [o \in Objects |-> 3]
  /\ live = Objects
  /\ moved = FALSE
  /\ removedAt = [o \in Objects |-> 0]

(* Another device moves the child, then deletes its now-empty old parent. *)
MoveChild == /\ ~moved /\ moved' = TRUE
             /\ UNCHANGED <<visible, work, generation, fetched, live, removedAt>>
DeleteParent == /\ moved /\ "parent" \in live
                /\ live' = live \ {"parent"}
                /\ UNCHANGED <<visible, work, generation, fetched, moved, removedAt>>

(* The old local topology still cascades the listing removal to the child.
   A dishonest server can send this hint while both objects are still live. *)
ObserveHint ==
  /\ generation["parent"] < 2
  /\ visible' = {}
  /\ work' = IF PreserveWork THEN work ELSE {}
  /\ generation' = [o \in Objects |->
       IF o = "parent" \/ ~FenceOnlyNamed THEN generation[o] + 1 ELSE generation[o]]
  /\ removedAt' = [o \in Objects |->
       IF o = "parent" \/ ~FenceOnlyNamed THEN 2 ELSE removedAt[o]]
  /\ UNCHANGED <<fetched, live, moved>>

(* Fetch observes the local generation before obtaining a verified live proof.
   Its server timestamp is 1, older than the unsigned removal clock 2. *)
Fetch(o) == /\ o \in live
            /\ fetched' = [fetched EXCEPT ![o] = generation[o]]
            /\ UNCHANGED <<visible, work, generation, live, moved, removedAt>>
Restore(o) ==
  /\ o \in live /\ fetched[o] # 3
  /\ ~UseGeneration \/ fetched[o] = generation[o]
  /\ IgnoreUnsignedClock \/ removedAt[o] < 1
  /\ visible' = visible \cup {o}
  /\ UNCHANGED <<work, generation, fetched, live, moved, removedAt>>

Next == MoveChild \/ DeleteParent \/ ObserveHint \/
        (\E o \in Objects : Fetch(o) \/ Restore(o))
Spec == Init /\ [][Next]_vars
TypeOK == /\ visible \subseteq Objects /\ work \subseteq Work
          /\ generation \in [Objects -> 0..2]
          /\ fetched \in [Objects -> 0..3]
          /\ live \subseteq Objects /\ moved \in BOOLEAN
          /\ removedAt \in [Objects -> 0..2]
LocalWorkSurvives == work = Work
ChildHasNoInheritedFence == generation["child"] = 0
ObservedLiveProofCanRestore ==
  \A o \in live : fetched[o] = generation[o] => ENABLED Restore(o)
LateProofNeverRestores ==
  [][\A o \in Objects :
      (o \notin visible /\ fetched[o] # generation[o]) => o \notin visible']_vars
=============================================================================
