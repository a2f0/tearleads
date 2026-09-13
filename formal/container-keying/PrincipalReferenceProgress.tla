--------------------- MODULE PrincipalReferenceProgress ---------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Containers, SharedContainer, MaxVersion, EnforceCurrent, EnforceProgress
ASSUME /\ SharedContainer \in Containers /\ IsFiniteSet(Containers)
       /\ MaxVersion >= 2 /\ {EnforceCurrent, EnforceProgress} \subseteq BOOLEAN
VARIABLES groupVersion, committed, held
vars == <<groupVersion, committed, held>>

Init ==
  /\ groupVersion = 2
  /\ committed = [c \in Containers |-> IF c = SharedContainer THEN 2 ELSE 0]
  /\ held = committed

Progresses(previous, next) == ~EnforceProgress \/ next >= previous

(* New grants and rekeys use existing signed policies, under the group lock. *)
Commit(c, reference) ==
  /\ reference \in 1..groupVersion
  /\ ~EnforceCurrent \/ reference = groupVersion
  /\ Progresses(committed[c], reference)
  /\ committed' = [committed EXCEPT ![c] = reference]
  /\ UNCHANGED <<groupVersion, held>>

(* The policy update atomically refreshes every directly granted container. *)
AdvanceGroup ==
  /\ groupVersion < MaxVersion /\ groupVersion' = groupVersion + 1
  /\ committed' = [c \in Containers |-> IF committed[c] = 0 THEN 0 ELSE groupVersion + 1]
  /\ UNCHANGED held

(* A dishonest server may serve a signed successor with an older policy. *)
VerifySuccessor(c, reference) ==
  /\ reference \in 1..groupVersion
  /\ Progresses(held[c], reference)
  /\ held' = [held EXCEPT ![c] = reference]
  /\ UNCHANGED <<groupVersion, committed>>

Next == AdvanceGroup \/ (\E c \in Containers, v \in 1..MaxVersion :
          Commit(c, v) \/ VerifySuccessor(c, v))
Spec == Init /\ [][Next]_vars
TypeOK == /\ groupVersion \in 2..MaxVersion
          /\ committed \in [Containers -> 0..groupVersion]
          /\ held \in [Containers -> 0..groupVersion]
CommittedReferencesAreCurrent ==
  \A c \in Containers : committed[c] \in {0, groupVersion}
HeldReferencesNeverRegress ==
  [][\A c \in Containers : held'[c] >= held[c]]_vars
=============================================================================
