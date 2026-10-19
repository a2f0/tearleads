--------------------- MODULE ContainerCreateAdoption ---------------------
(* A pending container create whose response was lost, while a listing     *)
(* carries the container (#2365 finding 26). The create committed under    *)
(* CreatedParent. While the intent is pending, the user may move the       *)
(* folder locally and another writer may move it remotely.                 *)
EXTENDS FiniteSets

CONSTANTS Parents, Scopes, CreatedParent, IntendedScope, NoMove,
          VerifyContainerAdoption, CiteVerifiedHead, KeepQueuedMove,
          ParkForeignCreates, HoldPendingWrites, KeepMetadataSeedOnAdoption
ASSUME /\ CreatedParent \in Parents /\ IntendedScope \in Scopes
       /\ IsFiniteSet(Parents) /\ IsFiniteSet(Scopes)
       /\ NoMove \notin Parents \cup [to : Parents, from : Parents]
       /\ {VerifyContainerAdoption, CiteVerifiedHead, KeepQueuedMove,
           ParkForeignCreates, HoldPendingWrites,
           KeepMetadataSeedOnAdoption} \subseteq BOOLEAN

VARIABLES listedScope, hydrated, pending, adoptedScope, verified, desired,
          queuedTo, queuedFrom, remoteParent, owedMove, parked, siblingSynced,
          wroteUnadopted, seedQueued, seedCommitted
vars == <<listedScope, hydrated, pending, adoptedScope, verified, desired,
          queuedTo, queuedFrom, remoteParent, owedMove, parked, siblingSynced,
          wroteUnadopted, seedQueued, seedCommitted>>
seedVars == <<seedQueued, seedCommitted>>

Moves == [to : Parents, from : Parents] \cup {NoMove}

(* The listing may carry this device's create, or a foreign one under the  *)
(* same id: another writer's colliding create, or one the server invents.  *)
Init ==
  /\ listedScope \in Scopes /\ hydrated = FALSE
  /\ pending = TRUE /\ adoptedScope = IntendedScope /\ verified = FALSE
  /\ desired = CreatedParent /\ queuedTo = NoMove /\ queuedFrom = CreatedParent
  /\ remoteParent = CreatedParent /\ owedMove = NoMove
  /\ parked = FALSE /\ siblingSynced = FALSE /\ wroteUnadopted = FALSE
  (* The folder's first metadata update is queued as the create's seed.   *)
  (* The lost response may have been the seeded create's, which committed *)
  (* it, or a plain fallback's, which did not.                            *)
  /\ seedQueued = TRUE /\ seedCommitted \in BOOLEAN

(* Hydration installs the listed container's metadata, which routes the     *)
(* intent to adoption.                                                      *)
Hydrate ==
  /\ pending /\ ~hydrated /\ hydrated' = TRUE
  /\ UNCHANGED <<listedScope, pending, adoptedScope, verified, desired,
                  queuedTo, queuedFrom, remoteParent, owedMove, parked,
                  siblingSynced, wroteUnadopted>>
  /\ UNCHANGED seedVars

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
                  remoteParent, owedMove, parked, siblingSynced, wroteUnadopted>>
  /\ UNCHANGED seedVars

RemoteMove(p) ==
  /\ pending /\ p # remoteParent
  /\ remoteParent' = p
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, owedMove, parked,
                  siblingSynced, wroteUnadopted>>
  /\ UNCHANGED seedVars

(* Fault: the unsigned listing settles the intent unverified. *)
DiscoverContainer ==
  /\ pending /\ hydrated /\ ~VerifyContainerAdoption
  /\ pending' = FALSE /\ adoptedScope' = listedScope
  /\ UNCHANGED <<listedScope, hydrated, verified, desired, queuedTo,
                  queuedFrom, remoteParent, owedMove, parked, siblingSynced, wroteUnadopted>>
  /\ UNCHANGED seedVars

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
  (* The committed manifest does not say whether the seed committed with  *)
  (* it, so the seed stays queued for the folder's metadata sync.          *)
  /\ seedQueued' = (seedQueued /\ KeepMetadataSeedOnAdoption)
  /\ UNCHANGED <<listedScope, hydrated, desired, queuedTo, queuedFrom,
                  remoteParent, parked, siblingSynced, wroteUnadopted,
                  seedCommitted>>

(* A foreign create is refused. Parked, the intent is never read again: its *)
(* signed facts cannot change. Unparked, the refusal stops the lane's pass. *)
RefuseForeignCreate ==
  /\ pending /\ hydrated /\ listedScope # IntendedScope /\ ~parked
  /\ parked' = ParkForeignCreates
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, remoteParent, owedMove,
                  siblingSynced, wroteUnadopted>>
  /\ UNCHANGED seedVars

LaneHalted == pending /\ hydrated /\ listedScope # IntendedScope /\ ~parked

(* A later intent in the same pass. *)
SiblingSync ==
  /\ ~siblingSynced /\ ~LaneHalted
  /\ siblingSynced' = TRUE
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, remoteParent, owedMove,
                  parked, wroteUnadopted>>
  /\ UNCHANGED seedVars

(* A move or metadata edit written into the folder itself. Held, a folder  *)
(* whose create is pending takes none: its listed identity is unverified,  *)
(* or refused.                                                             *)
WriteIntoFolder ==
  /\ hydrated /\ (HoldPendingWrites => ~pending)
  /\ wroteUnadopted' = (wroteUnadopted \/ pending)
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, remoteParent, owedMove,
                  parked, siblingSynced>>
  /\ UNCHANGED seedVars

(* Once adopted, the folder's metadata sync sends the queued seed. One    *)
(* already stored under its id comes back encrypted again, so the server  *)
(* reports an update-id conflict and recovery settles or re-keys it; this *)
(* step abstracts that exchange to its outcome.                           *)
SyncMetadataSeed ==
  /\ ~pending /\ verified /\ seedQueued
  /\ seedQueued' = FALSE /\ seedCommitted' = TRUE
  /\ UNCHANGED <<listedScope, hydrated, pending, adoptedScope, verified,
                  desired, queuedTo, queuedFrom, remoteParent, owedMove,
                  parked, siblingSynced, wroteUnadopted>>

Next == \/ Hydrate \/ WriteIntoFolder \/ \E p \in Parents : LocalMove(p) \/ RemoteMove(p)
        \/ DiscoverContainer \/ AdoptContainerCreate \/ RefuseForeignCreate
        \/ SiblingSync \/ SyncMetadataSeed \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
          /\ WF_vars(AdoptContainerCreate) /\ WF_vars(RefuseForeignCreate)
          /\ SF_vars(SiblingSync)

TypeOK ==
  /\ {hydrated, pending, verified, parked, siblingSynced} \subseteq BOOLEAN
  /\ {listedScope, adoptedScope} \subseteq Scopes
  /\ {desired, queuedFrom, remoteParent} \subseteq Parents
  /\ queuedTo \in Parents \cup {NoMove} /\ owedMove \in Moves
  /\ {wroteUnadopted, seedQueued, seedCommitted} \subseteq BOOLEAN
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
NoWriteIntoUnadoptedFolder == ~wroteUnadopted
(* The metadata seed leaves the queue only once the server holds it. *)
AdoptedSeedIsCommitted == ~seedQueued => seedCommitted
SiblingEventuallySyncs == <>siblingSynced
=============================================================================
