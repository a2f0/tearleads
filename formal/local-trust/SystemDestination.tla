------------------------- MODULE SystemDestination -------------------------
EXTENDS Naturals
CONSTANTS VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
          PreserveDestinationIdentity
ASSUME {VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
        PreserveDestinationIdentity}
       \subseteq BOOLEAN
Candidates == {"ownRoot", "foreignRoot", "ordinary", "system"}
VARIABLES candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved
vars == <<candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved>>

Init ==
  /\ candidate \in Candidates /\ shared \in BOOLEAN
  /\ creatorRole \in {"write", "admin"}
  /\ hydrated = FALSE /\ rootRole = FALSE /\ systemRole = FALSE
  /\ merged = FALSE /\ usedSystem = FALSE /\ unauthorizedSlot = FALSE /\ moved = FALSE

(* The adversary claims both a root edge and the expected system slot. *)
Hydrate ==
  /\ ~hydrated /\ hydrated' = TRUE
  /\ rootRole' = IF VerifyDestination
                  THEN candidate \in {"ownRoot", "foreignRoot"} ELSE TRUE
  /\ systemRole' = IF VerifyDestination THEN candidate = "system" ELSE TRUE
  /\ UNCHANGED <<candidate, shared, creatorRole, merged, usedSystem,
                  unauthorizedSlot, moved>>
MergeRoot ==
  /\ hydrated /\ rootRole
  /\ ~RequireSessionRoot \/ candidate = "ownRoot"
  /\ merged' = TRUE
  /\ UNCHANGED <<candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, usedSystem, unauthorizedSlot, moved>>
UseSystem ==
  /\ hydrated /\ systemRole /\ usedSystem' = TRUE
  /\ UNCHANGED <<candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, unauthorizedSlot, moved>>
CreateSystem ==
  /\ ~RequireSystemAdministrator \/ creatorRole = "admin"
  /\ unauthorizedSlot' = (creatorRole # "admin")
  /\ UNCHANGED <<candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, moved>>
MoveDestination ==
  /\ ~PreserveDestinationIdentity
  /\ candidate \in {"ownRoot", "foreignRoot", "system"}
  /\ moved' = TRUE
  /\ UNCHANGED <<candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, unauthorizedSlot>>
Next == Hydrate \/ MergeRoot \/ UseSystem \/ CreateSystem \/ MoveDestination \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ candidate \in Candidates /\ creatorRole \in {"write", "admin"}
  /\ {shared, hydrated, rootRole, systemRole, merged, usedSystem,
       unauthorizedSlot, moved} \subseteq BOOLEAN
OnlyOwnRootReceivesLocalContent == merged => candidate = "ownRoot"
OnlySignedSlotReceivesSystemWrites == usedSystem => candidate = "system"
OnlyAdministratorsCreateSlots == ~unauthorizedSlot
CachedDestinationsNeverMove == (usedSystem \/ merged) => ~moved
SharedSystemRemainsUsable ==
  (hydrated /\ candidate = "system" /\ shared) => systemRole
=============================================================================
