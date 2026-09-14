------------------------- MODULE SystemDestination -------------------------
EXTENDS Naturals
CONSTANTS VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
          PreserveDestinationIdentity, PreserveSessionAcknowledgment, RejectSharedSystem, RequireSystemScope, RequireRootScope, RequireSystemRootParent,
          RequireRootCreator, RefuseRootSwap
ASSUME {VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
        PreserveDestinationIdentity, PreserveSessionAcknowledgment, RejectSharedSystem, RequireSystemScope, RequireRootScope, RequireSystemRootParent,
        RequireRootCreator, RefuseRootSwap}
       \subseteq BOOLEAN
Candidates == {"ownRoot", "foreignRoot", "ordinary", "system"}
VARIABLES systemParentIsRoot, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser
vars == <<systemParentIsRoot, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>

Init ==
  /\ systemParentIsRoot \in BOOLEAN /\ malformedSlot = FALSE
  /\ sameOrganization \in BOOLEAN
  /\ acknowledgedRoot = "ownRoot"
  /\ candidate \in Candidates /\ shared \in BOOLEAN
  /\ creatorRole \in {"write", "admin"}
  (* Whether the verified root's epoch-1 create was signed by the session user. *)
  /\ rootCreatorIsUser \in BOOLEAN
  /\ hydrated = FALSE /\ rootRole = FALSE /\ systemRole = FALSE
  /\ merged = FALSE /\ usedSystem = FALSE /\ unauthorizedSlot = FALSE /\ moved = FALSE

(* The adversary claims both a root edge and the expected system slot. *)
Hydrate ==
  /\ ~hydrated /\ hydrated' = TRUE
  /\ rootRole' = IF VerifyDestination
                  THEN candidate \in {"ownRoot", "foreignRoot"} ELSE TRUE
  /\ systemRole' = IF VerifyDestination THEN candidate = "system" /\ (~RejectSharedSystem \/ ~shared) ELSE TRUE
  /\ UNCHANGED <<systemParentIsRoot, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, merged, usedSystem,
                  unauthorizedSlot, moved, rootCreatorIsUser>>
MergeRoot ==
  /\ ~RequireRootScope \/ sameOrganization
  /\ hydrated /\ rootRole
  /\ ~RequireSessionRoot \/ candidate = acknowledgedRoot
  /\ ~RequireRootCreator \/ rootCreatorIsUser
  /\ merged' = TRUE
  /\ UNCHANGED <<systemParentIsRoot, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>
UseSystem ==
  /\ ~RequireSystemScope \/ sameOrganization
  /\ hydrated /\ systemRole /\ usedSystem' = TRUE
  /\ UNCHANGED <<systemParentIsRoot, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, unauthorizedSlot, moved, rootCreatorIsUser>>
CreateSystem ==
  /\ ~RequireSystemRootParent \/ systemParentIsRoot
  /\ malformedSlot' = ~systemParentIsRoot
  /\ ~RequireSystemAdministrator \/ creatorRole = "admin"
  /\ unauthorizedSlot' = (creatorRole # "admin")
  /\ UNCHANGED <<systemParentIsRoot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, moved, rootCreatorIsUser>>
MoveDestination ==
  /\ ~PreserveDestinationIdentity
  /\ candidate \in {"ownRoot", "foreignRoot", "system"}
  /\ moved' = TRUE
  /\ UNCHANGED <<systemParentIsRoot, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, unauthorizedSlot, rootCreatorIsUser>>
SelectView ==
  /\ acknowledgedRoot' = IF PreserveSessionAcknowledgment THEN acknowledgedRoot ELSE candidate
  /\ UNCHANGED <<systemParentIsRoot, malformedSlot, sameOrganization, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
                  merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>
(* A later unsigned login names the candidate as the organization's root. *)
Login ==
  /\ acknowledgedRoot' = IF RefuseRootSwap /\ candidate # acknowledgedRoot THEN acknowledgedRoot ELSE candidate
  /\ UNCHANGED <<systemParentIsRoot, malformedSlot, sameOrganization, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
                  merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>
Next == SelectView \/ Login \/ Hydrate \/ MergeRoot \/ UseSystem \/ CreateSystem \/ MoveDestination \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ acknowledgedRoot \in Candidates
  /\ candidate \in Candidates /\ creatorRole \in {"write", "admin"}
  /\ {systemParentIsRoot, malformedSlot, sameOrganization, shared, hydrated, rootRole, systemRole, merged, usedSystem,
       unauthorizedSlot, moved, rootCreatorIsUser} \subseteq BOOLEAN
OnlyServerRootsAcknowledged == acknowledgedRoot = "ownRoot"
RootWritesStayInOrganization == merged => sameOrganization
OnlyOwnRootReceivesLocalContent == merged => candidate = "ownRoot"
OnlyUserCreatedRootReceivesLocalContent == merged => rootCreatorIsUser
SystemWritesStayInOrganization == usedSystem => sameOrganization
OnlySignedSlotReceivesSystemWrites == usedSystem => candidate = "system"
OnlyAdministratorsCreateSlots == ~unauthorizedSlot
OnlyRootChildrenHaveSlots == ~malformedSlot
CachedDestinationsNeverMove == (usedSystem \/ merged) => ~moved
SharedSystemRemainsUsable ==
  (hydrated /\ candidate = "system" /\ shared) => systemRole
=============================================================================
