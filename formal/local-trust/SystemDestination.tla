------------------------- MODULE SystemDestination -------------------------
EXTENDS Naturals
CONSTANTS VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
          PreserveDestinationIdentity, PreserveSessionAcknowledgment, RejectSharedSystem, RequireSystemScope, RequireRootScope
ASSUME {VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
        PreserveDestinationIdentity, PreserveSessionAcknowledgment, RejectSharedSystem, RequireSystemScope, RequireRootScope}
       \subseteq BOOLEAN
Candidates == {"ownRoot", "foreignRoot", "ordinary", "system"}
VARIABLES sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved
vars == <<sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved>>

Init ==
  /\ sameOrganization \in BOOLEAN
  /\ acknowledgedRoot = "ownRoot"
  /\ candidate \in Candidates /\ shared \in BOOLEAN
  /\ creatorRole \in {"write", "admin"}
  /\ hydrated = FALSE /\ rootRole = FALSE /\ systemRole = FALSE
  /\ merged = FALSE /\ usedSystem = FALSE /\ unauthorizedSlot = FALSE /\ moved = FALSE

(* The adversary claims both a root edge and the expected system slot. *)
Hydrate ==
  /\ ~hydrated /\ hydrated' = TRUE
  /\ rootRole' = IF VerifyDestination
                  THEN candidate \in {"ownRoot", "foreignRoot"} ELSE TRUE
  /\ systemRole' = IF VerifyDestination THEN candidate = "system" /\ (~RejectSharedSystem \/ ~shared) ELSE TRUE
  /\ UNCHANGED <<sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, merged, usedSystem,
                  unauthorizedSlot, moved>>
MergeRoot ==
  /\ ~RequireRootScope \/ sameOrganization
  /\ hydrated /\ rootRole
  /\ ~RequireSessionRoot \/ candidate = acknowledgedRoot
  /\ merged' = TRUE
  /\ UNCHANGED <<sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, usedSystem, unauthorizedSlot, moved>>
UseSystem ==
  /\ ~RequireSystemScope \/ sameOrganization
  /\ hydrated /\ systemRole /\ usedSystem' = TRUE
  /\ UNCHANGED <<sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, unauthorizedSlot, moved>>
CreateSystem ==
  /\ ~RequireSystemAdministrator \/ creatorRole = "admin"
  /\ unauthorizedSlot' = (creatorRole # "admin")
  /\ UNCHANGED <<sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, moved>>
MoveDestination ==
  /\ ~PreserveDestinationIdentity
  /\ candidate \in {"ownRoot", "foreignRoot", "system"}
  /\ moved' = TRUE
  /\ UNCHANGED <<sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, unauthorizedSlot>>
SelectView ==
  /\ acknowledgedRoot' = IF PreserveSessionAcknowledgment THEN acknowledgedRoot ELSE candidate
  /\ UNCHANGED <<sameOrganization, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
                  merged, usedSystem, unauthorizedSlot, moved>>
Next == SelectView \/ Hydrate \/ MergeRoot \/ UseSystem \/ CreateSystem \/ MoveDestination \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ acknowledgedRoot \in Candidates
  /\ candidate \in Candidates /\ creatorRole \in {"write", "admin"}
  /\ {sameOrganization, shared, hydrated, rootRole, systemRole, merged, usedSystem,
       unauthorizedSlot, moved} \subseteq BOOLEAN
OnlyServerRootsAcknowledged == acknowledgedRoot = "ownRoot"
RootWritesStayInOrganization == merged => sameOrganization
OnlyOwnRootReceivesLocalContent == merged => candidate = "ownRoot"
SystemWritesStayInOrganization == usedSystem => sameOrganization
OnlySignedSlotReceivesSystemWrites == usedSystem => candidate = "system"
OnlyAdministratorsCreateSlots == ~unauthorizedSlot
CachedDestinationsNeverMove == (usedSystem \/ merged) => ~moved
SharedSystemRemainsUsable ==
  (hydrated /\ candidate = "system" /\ shared) => systemRole
=============================================================================
