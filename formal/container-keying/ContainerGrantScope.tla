-------------------- MODULE ContainerGrantScope --------------------
EXTENDS FiniteSets

(* Container grants admit only direct users and groups in the owning       *)
(* organization. Organizations remain signed policy principals, but are   *)
(* deliberately absent from the container grant domain. A direct user may *)
(* be granted only while active in the owning organization's roster, and  *)
(* roster removal is refused until that user's direct grants are revoked.  *)

CONSTANTS Users, Groups, OrganizationPrincipals,
          ContainerUsers, ContainerGroups, InitialActiveUsers

Principals == Users \cup Groups \cup OrganizationPrincipals

ASSUME /\ Users # {}
       /\ Groups # {}
       /\ OrganizationPrincipals # {}
       /\ IsFiniteSet(Principals)
       /\ Users \cap Groups = {}
       /\ Users \cap OrganizationPrincipals = {}
       /\ Groups \cap OrganizationPrincipals = {}
       /\ ContainerUsers \subseteq Users
       /\ ContainerGroups \subseteq Groups
       /\ InitialActiveUsers \subseteq ContainerUsers

VARIABLES grants, activeUsers

vars == <<grants, activeUsers>>

TypeOK ==
  /\ grants \subseteq Principals
  /\ activeUsers \subseteq Users

Grantable(p) ==
  /\ \/ p \in ContainerGroups
     \/ /\ p \in ContainerUsers
        /\ p \in activeUsers

Init ==
  /\ grants = {}
  /\ activeUsers = InitialActiveUsers

Grant(p) ==
  /\ Grantable(p)
  /\ grants' = grants \cup {p}
  /\ UNCHANGED activeUsers

Revoke(p) ==
  /\ p \in grants
  /\ grants' = grants \ {p}
  /\ UNCHANGED activeUsers

EnableUser(u) ==
  /\ u \in ContainerUsers
  /\ u \notin activeUsers
  /\ activeUsers' = activeUsers \cup {u}
  /\ UNCHANGED grants

DisableUser(u) ==
  /\ u \in activeUsers
  (* The backend rejects the Members transition while a current direct     *)
  (* container grant still names u. Revocation/rekey must commit first.    *)
  /\ u \notin grants
  /\ activeUsers' = activeUsers \ {u}
  /\ UNCHANGED grants

Next ==
  \/ \E p \in Principals : Grant(p)
  \/ \E p \in Principals : Revoke(p)
  \/ \E u \in Users : EnableUser(u)
  \/ \E u \in Users : DisableUser(u)
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars

NoOrganizationGrants ==
  grants \cap OrganizationPrincipals = {}

GrantsStayWithinOrganization ==
  grants \subseteq (ContainerUsers \cup ContainerGroups)

DirectUserGrantsRequireActiveRoster ==
  \A u \in grants \cap Users : u \in activeUsers

=====================================================================
