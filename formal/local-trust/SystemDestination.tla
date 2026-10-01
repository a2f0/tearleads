------------------------- MODULE SystemDestination -------------------------
EXTENDS Naturals
CONSTANTS VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
          PreserveDestinationIdentity, PreserveSessionAcknowledgment, RejectSharedSystem, RequireSystemScope, RequireRootScope, RequireSystemTopology,
          RequireRootCreator, RefuseRootSwap, PreserveAcknowledgmentsOnRestore
ASSUME {VerifyDestination, RequireSessionRoot, RequireSystemAdministrator,
        PreserveDestinationIdentity, PreserveSessionAcknowledgment, RejectSharedSystem, RequireSystemScope, RequireRootScope, RequireSystemTopology,
        RequireRootCreator, RefuseRootSwap, PreserveAcknowledgmentsOnRestore}
       \subseteq BOOLEAN
Candidates == {"ownRoot", "foreignRoot", "ordinary", "system"}
VARIABLES systemLocation, systemSlotRole, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser
vars == <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
          merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>

ValidSystemTopology ==
  IF systemSlotRole = "metadata" THEN systemLocation = "root"
  ELSE systemLocation = "rootChild"

Init ==
  /\ systemLocation \in {"root", "rootChild", "nestedChild"}
  /\ systemSlotRole \in {"metadata", "other"}
  /\ malformedSlot = FALSE
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
  /\ systemRole' = IF VerifyDestination THEN candidate = "system" /\ (~RequireSystemTopology \/ ValidSystemTopology) /\ (~RejectSharedSystem \/ ~shared) ELSE TRUE
  /\ UNCHANGED <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, merged, usedSystem,
                  unauthorizedSlot, moved, rootCreatorIsUser>>
MergeRoot ==
  /\ ~RequireRootScope \/ sameOrganization
  /\ hydrated /\ rootRole
  /\ ~RequireSessionRoot \/ candidate = acknowledgedRoot
  /\ ~RequireRootCreator \/ rootCreatorIsUser
  /\ merged' = TRUE
  /\ UNCHANGED <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>
UseSystem ==
  /\ ~RequireSystemScope \/ sameOrganization
  /\ hydrated /\ systemRole /\ usedSystem' = TRUE
  /\ UNCHANGED <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, unauthorizedSlot, moved, rootCreatorIsUser>>
CreateSystem ==
  /\ ~RequireSystemTopology \/ ValidSystemTopology
  /\ malformedSlot' = ~ValidSystemTopology
  /\ ~RequireSystemAdministrator \/ creatorRole = "admin"
  /\ unauthorizedSlot' = (creatorRole # "admin")
  /\ UNCHANGED <<systemLocation, systemSlotRole, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, moved, rootCreatorIsUser>>
MoveDestination ==
  /\ ~PreserveDestinationIdentity
  /\ candidate \in {"ownRoot", "foreignRoot", "system"}
  /\ moved' = TRUE
  /\ UNCHANGED <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, acknowledgedRoot, candidate, shared, creatorRole, hydrated, rootRole,
                  systemRole, merged, usedSystem, unauthorizedSlot, rootCreatorIsUser>>
SelectView ==
  /\ acknowledgedRoot' = IF PreserveSessionAcknowledgment THEN acknowledgedRoot ELSE candidate
  /\ UNCHANGED <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
                  merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>
(* A later unsigned login names the candidate as the organization's root. *)
(* With no acknowledgement yet, the login's root is taken as given.        *)
Login ==
  /\ acknowledgedRoot' =
       IF RefuseRootSwap /\ acknowledgedRoot # "none" /\ candidate # acknowledgedRoot
         THEN acknowledgedRoot ELSE candidate
  /\ UNCHANGED <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
                  merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>
(* A backup restore reloads the app into a signed-out session. The fixed    *)
(* restore keeps the identity's root acknowledgements (#2365 finding 24);   *)
(* clearing them lets the next login acknowledge any root.                  *)
RestoreBackup ==
  /\ acknowledgedRoot' = IF PreserveAcknowledgmentsOnRestore THEN acknowledgedRoot ELSE "none"
  /\ UNCHANGED <<systemLocation, systemSlotRole, malformedSlot, sameOrganization, candidate, shared, creatorRole, hydrated, rootRole, systemRole,
                  merged, usedSystem, unauthorizedSlot, moved, rootCreatorIsUser>>
Next == SelectView \/ Login \/ RestoreBackup \/ Hydrate \/ MergeRoot \/ UseSystem \/ CreateSystem \/ MoveDestination \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ acknowledgedRoot \in Candidates \cup {"none"}
  /\ candidate \in Candidates /\ creatorRole \in {"write", "admin"}
  /\ systemLocation \in {"root", "rootChild", "nestedChild"}
  /\ systemSlotRole \in {"metadata", "other"}
  /\ {malformedSlot, sameOrganization, shared, hydrated, rootRole, systemRole, merged, usedSystem,
       unauthorizedSlot, moved, rootCreatorIsUser} \subseteq BOOLEAN
(* "none" is a cleared acknowledgement, harmless until a login fills it.   *)
OnlyServerRootsAcknowledged == acknowledgedRoot \in {"ownRoot", "none"}
RootWritesStayInOrganization == merged => sameOrganization
OnlyOwnRootReceivesLocalContent == merged => candidate = "ownRoot"
OnlyUserCreatedRootReceivesLocalContent == merged => rootCreatorIsUser
SystemWritesStayInOrganization == usedSystem => sameOrganization
OnlySignedSlotReceivesSystemWrites == usedSystem => candidate = "system"
OnlyAdministratorsCreateSlots == ~unauthorizedSlot
OnlyValidSystemTopology == ~malformedSlot
SystemWritesUseValidTopology == usedSystem => ValidSystemTopology
MetadataRootCreationAllowed ==
  (systemSlotRole = "metadata" /\ systemLocation = "root" /\ creatorRole = "admin")
    => ENABLED CreateSystem
CachedDestinationsNeverMove == (usedSystem \/ merged) => ~moved
SharedSystemRemainsUsable ==
  (hydrated /\ candidate = "system" /\ ValidSystemTopology /\ shared) => systemRole
=============================================================================
