--------------------- MODULE ContainerCreateAdoption ---------------------
(* A pending container create whose response was lost, while a listing     *)
(* carries the container (#2365 finding 26). The create committed under    *)
(* CreatedParent. While the intent is pending, the user may move the       *)
(* folder locally and another writer may move it remotely.                 *)
EXTENDS FiniteSets

CONSTANTS Parents, Scopes, CreatedParent, IntendedScope, NoMove,
          VerifyContainerAdoption, CiteVerifiedHead, KeepQueuedMove,
          ParkForeignCreates
ASSUME /\ CreatedParent \in Parents /\ IntendedScope \in Scopes
       /\ IsFiniteSet(Parents) /\ IsFiniteSet(Scopes)
       /\ NoMove \notin Parents \cup [to : Parents, from : Parents]
       /\ {VerifyContainerAdoption, CiteVerifiedHead, KeepQueuedMove,
           ParkForeignCreates} \subseteq BOOLEAN

VARIABLES listedScope, hydrated, pending, adoptedScope, verified, desired,
          queuedTo, queuedFrom, remoteParent, owedMove, parked, siblingSynced
vars == <<listedScope, hydrated, pending, adoptedScope, verified, desired,
          queuedTo, queuedFrom, remoteParent, owedMove, parked, siblingSynced>>

Moves == [to : Parents, from : Parents] \cup {NoMove}

(* The listing may carry this device's create, or a foreign one under the  *)
(* same id: another writer's colliding create, or one the server invents.  *)
Init ==
  /\ listedScope \in Scopes /\ hydrated = FALSE
  /\ pending = TRUE /\ adoptedScope = IntendedScope /\ verified = FALSE
  /\ desired = CreatedParent /\ queuedTo = NoMove /\ queuedFrom = CreatedParent
  /\ remoteParent = CreatedParent /\ owedMove = NoMove
  /\ parked = FALSE /\ siblingSynced = FALSE

(* Hydration installs the listed container's metadata, which routes the     *)
(* intent to adoption.                                                      *)
Hydrate ==
  /\ pending /\ ~hydrated /\ hydrated' = TRUE
  /\ UNCHANGED <<listedScope, pending, adoptedScope, verified, desired,
                  queuedTo, queuedFrom, remoteParent, owedMove, parked,
                  siblingSynced>>

LocalParent == IF queuedTo = NoMove THEN desired ELSE queuedTo

(* Before hydration a move re-queues the create under the new parent;      *)
(* after it, the folder looks remote and the move queues its own intent,   *)
(* which keeps the parent of its first queued move as its previous one.    *)
LocalMove(p) ==
  /\ pending /\ p # LocalParent
  /\ IF hydrated
       THEN /\ queuedTo' = p
            /\ queuedFrom' = IF queuedTo = NoMove THEN desired ELSE queuedFrom
            /\ UNCHANGED desired
       ELSE /\ desired' = p /\ UNCHANGED <<queuedTo, queuedFrom>>
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  remoteParent, owedMove, parked, siblingSynced>>

RemoteMove(p) ==
  /\ pending /\ p # remoteParent
  /\ remoteParent' = p
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, owedMove, parked,
                  siblingSynced>>

(* Fault: the unsigned listing settles the intent unverified. *)
DiscoverContainer ==
  /\ pending /\ hydrated /\ ~VerifyContainerAdoption
  /\ pending' = FALSE /\ adoptedScope' = listedScope
  /\ UNCHANGED <<listedScope, hydrated, verified, desired, queuedTo,
                  queuedFrom, remoteParent, owedMove, parked, siblingSynced>>

(* The create's own owed move cites the verified head's parent. A desired  *)
(* parent equal to the created one means the user never moved the folder   *)
(* away, so a later remote move stands.                                     *)
PreviousParent == IF CiteVerifiedHead THEN remoteParent ELSE CreatedParent
OwedMove ==
  IF \/ desired = PreviousParent
     \/ (CiteVerifiedHead /\ desired = CreatedParent)
    THEN NoMove
    ELSE [to |-> desired, from |-> PreviousParent]
QueuedMove ==
  IF queuedTo = NoMove THEN NoMove ELSE [to |-> queuedTo, from |-> queuedFrom]

(* A queued move is newer than the create's parent, so it keeps its        *)
(* destination and is rebased onto the verified head. Without that, the    *)
(* owed move's upsert takes over its destination and keeps its stale       *)
(* previous parent.                                                         *)
SettledMove ==
  IF KeepQueuedMove
    THEN IF QueuedMove = NoMove THEN OwedMove
         ELSE [to |-> queuedTo, from |-> remoteParent]
    ELSE IF OwedMove = NoMove THEN QueuedMove
         ELSE IF QueuedMove = NoMove THEN OwedMove
         ELSE [to |-> OwedMove.to, from |-> queuedFrom]

(* Adoption checks the signed epoch-1 create: this user and the intended   *)
(* organization.                                                            *)
AdoptContainerCreate ==
  /\ pending /\ hydrated /\ listedScope = IntendedScope
  /\ pending' = FALSE /\ adoptedScope' = listedScope /\ verified' = TRUE
  /\ owedMove' = SettledMove
  /\ UNCHANGED <<listedScope, hydrated, desired, queuedTo, queuedFrom,
                  remoteParent, parked, siblingSynced>>

(* A foreign create is refused. Parked, the intent is never read again: its *)
(* signed facts cannot change. Unparked, the refusal stops the lane's pass. *)
RefuseForeignCreate ==
  /\ pending /\ hydrated /\ listedScope # IntendedScope /\ ~parked
  /\ parked' = ParkForeignCreates
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, remoteParent, owedMove,
                  siblingSynced>>

LaneHalted == pending /\ hydrated /\ listedScope # IntendedScope /\ ~parked

(* A later intent in the same pass. *)
SiblingSync ==
  /\ ~siblingSynced /\ ~LaneHalted
  /\ siblingSynced' = TRUE
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, remoteParent, owedMove,
                  parked>>

Next == \/ Hydrate \/ \E p \in Parents : LocalMove(p) \/ RemoteMove(p)
        \/ DiscoverContainer \/ AdoptContainerCreate \/ RefuseForeignCreate
        \/ SiblingSync \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
          /\ WF_vars(AdoptContainerCreate) /\ WF_vars(RefuseForeignCreate)
          /\ SF_vars(SiblingSync)

TypeOK ==
  /\ {hydrated, pending, verified, parked, siblingSynced} \subseteq BOOLEAN
  /\ {listedScope, adoptedScope} \subseteq Scopes
  /\ {desired, queuedFrom, remoteParent} \subseteq Parents
  /\ queuedTo \in Parents \cup {NoMove} /\ owedMove \in Moves
ContainerAdoptionHasVerifiedScope ==
  ~pending => verified /\ adoptedScope = IntendedScope
OwedMoveCitesCurrentParent == owedMove # NoMove => owedMove.from = remoteParent
(* The latest local move wins; an untouched intent keeps where the folder   *)
(* is now.                                                                  *)
SettledPlacementFollowsIntent ==
  (~pending /\ verified) =>
    (IF owedMove = NoMove THEN remoteParent ELSE owedMove.to) =
      (IF queuedTo # NoMove THEN queuedTo
       ELSE IF desired = CreatedParent THEN remoteParent ELSE desired)
SiblingEventuallySyncs == <>siblingSynced
=============================================================================
