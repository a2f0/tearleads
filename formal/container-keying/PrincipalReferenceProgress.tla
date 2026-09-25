--------------------- MODULE PrincipalReferenceProgress ---------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Containers, SharedContainer, MaxVersion, EnforceCurrent, EnforceProgress, FilterDeletedGrants
ASSUME /\ SharedContainer \in Containers /\ IsFiniteSet(Containers)
       /\ MaxVersion >= 2 /\ {EnforceCurrent, EnforceProgress, FilterDeletedGrants} \subseteq BOOLEAN
VARIABLES groupVersion, committed, held, live
vars == <<groupVersion, committed, held, live>>

Init ==
  /\ live = Containers
  /\ groupVersion = 2
  /\ committed = [c \in Containers |-> IF c = SharedContainer THEN 2 ELSE 0]
  /\ held = committed

Progresses(previous, next) == ~EnforceProgress \/ next >= previous

(* New grants and rekeys use existing signed policies, under the group lock. *)
Commit(c, reference) ==
  /\ c \in live
  /\ reference \in 1..groupVersion
  /\ ~EnforceCurrent \/ reference = groupVersion
  /\ Progresses(committed[c], reference)
  /\ committed' = [committed EXCEPT ![c] = reference]
  /\ UNCHANGED <<groupVersion, held, live>>

(* The policy update atomically refreshes every directly granted container. *)
AdvanceGroup ==
  /\ groupVersion < MaxVersion /\ groupVersion' = groupVersion + 1
  /\ \A c \in Containers : FilterDeletedGrants \/ c \in live \/ committed[c] = 0
  /\ committed' = [c \in Containers |-> IF c \notin live \/ committed[c] = 0 THEN committed[c] ELSE groupVersion + 1]
  /\ UNCHANGED <<held, live>>

(* A dishonest server may serve a signed successor with an older policy. *)
VerifySuccessor(c, reference) ==
  /\ reference \in 1..groupVersion
  /\ Progresses(held[c], reference)
  /\ held' = [held EXCEPT ![c] = reference]
  /\ UNCHANGED <<groupVersion, committed, live>>

(* Delete only the live identity; retain signed references for historical proof. *)
Delete(c) ==
  /\ c \in live
  /\ live' = live \ {c}
  /\ UNCHANGED <<groupVersion, committed, held>>

Next == AdvanceGroup \/ (\E c \in Containers : Delete(c)) \/ (\E c \in Containers, v \in 1..MaxVersion :
          Commit(c, v) \/ VerifySuccessor(c, v))
Spec == Init /\ [][Next]_vars
TypeOK == /\ live \subseteq Containers
          /\ groupVersion \in 2..MaxVersion
          /\ committed \in [Containers -> 0..groupVersion]
          /\ held \in [Containers -> 0..groupVersion]
CommittedReferencesAreCurrent ==
  \A c \in live : committed[c] \in {0, groupVersion}
DeletedGrantsDoNotBlockProgress == groupVersion < MaxVersion => ENABLED AdvanceGroup
HeldReferencesNeverRegress ==
  [][\A c \in Containers : held'[c] >= held[c]]_vars
=============================================================================
