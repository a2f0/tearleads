----------------------- MODULE UnacknowledgedInput -----------------------
EXTENDS FiniteSets

CONSTANTS Identities, Users, Scopes, InitialIdentity, InitialUser,
          IntendedScope, None, DeferDiscoveryAdoption, DeferLinkDiscovery, EnforceLoginBinding, CheckRestoreIdentity,
          VerifyContainerAdoption
ASSUME /\ InitialIdentity \in Identities /\ InitialUser \in Users
       /\ IntendedScope \in Scopes /\ None \notin Users
       /\ IsFiniteSet(Identities) /\ IsFiniteSet(Users) /\ IsFiniteSet(Scopes)
       /\ {DeferDiscoveryAdoption, DeferLinkDiscovery, EnforceLoginBinding, CheckRestoreIdentity,
           VerifyContainerAdoption} \subseteq BOOLEAN

VARIABLES pendingCreate, documentScope, linkedScope, verifiedAdoption,
          acknowledged, identity, loginPending, loginIdentity, loginUser, wrongHostRestore,
          pendingContainerCreate, containerScope, verifiedContainerAdoption
vars == <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
          acknowledged, identity, loginPending, loginIdentity, loginUser, wrongHostRestore,
          pendingContainerCreate, containerScope, verifiedContainerAdoption>>
containerVars == <<pendingContainerCreate, containerScope, verifiedContainerAdoption>>

Init ==
  /\ pendingCreate = TRUE /\ documentScope = IntendedScope /\ linkedScope = IntendedScope
  /\ verifiedAdoption = FALSE
  /\ acknowledged = [i \in Identities |-> IF i = InitialIdentity THEN InitialUser ELSE None]
  /\ identity = InitialIdentity /\ loginPending = FALSE
  /\ loginIdentity = InitialIdentity /\ loginUser = InitialUser /\ wrongHostRestore = FALSE
  /\ pendingContainerCreate = TRUE /\ containerScope = IntendedScope
  /\ verifiedContainerAdoption = FALSE

(* The listing names the pending create's stable ID, but has no signed scope. *)
Discover(scope) ==
  /\ pendingCreate
  /\ IF DeferDiscoveryAdoption
       THEN UNCHANGED <<pendingCreate, documentScope>>
       ELSE /\ pendingCreate' = FALSE /\ documentScope' = scope
  /\ IF DeferLinkDiscovery THEN UNCHANGED linkedScope ELSE linkedScope' = scope
  /\ UNCHANGED <<verifiedAdoption, acknowledged, identity,
                  loginPending, loginIdentity, loginUser, wrongHostRestore, containerVars>>

(* A create retry verifies the signed scope before adopting and releasing edits. *)
VerifyCreate(scope) ==
  /\ pendingCreate /\ scope = IntendedScope
  /\ pendingCreate' = FALSE /\ documentScope' = scope /\ linkedScope' = scope
  /\ verifiedAdoption' = TRUE
  /\ UNCHANGED <<acknowledged, identity, loginPending, loginIdentity, loginUser, wrongHostRestore, containerVars>>

SwitchIdentity(i) ==
  /\ identity' = i
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  acknowledged, loginPending, loginIdentity, loginUser, wrongHostRestore, containerVars>>

BeginLogin(user) ==
  /\ ~loginPending /\ loginPending' = TRUE
  /\ loginIdentity' = identity /\ loginUser' = user
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  acknowledged, identity, wrongHostRestore, containerVars>>

FinishLogin ==
  /\ loginPending /\ loginPending' = FALSE
  /\ IF identity = loginIdentity /\
          (~EnforceLoginBinding \/ acknowledged[identity] \in {None, loginUser})
       THEN acknowledged' = [acknowledged EXCEPT ![identity] = loginUser]
       ELSE UNCHANGED acknowledged
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  identity, loginIdentity, loginUser, wrongHostRestore, containerVars>>

(* A host restore carries the identity under which the trusted record was saved. *)
HostRestore(savedIdentity, user) ==
  /\ acknowledged[savedIdentity] = user
  /\ IF (~CheckRestoreIdentity \/ identity = savedIdentity) /\ acknowledged[identity] \in {None, user}
       THEN /\ acknowledged' = [acknowledged EXCEPT ![identity] = user]
            /\ wrongHostRestore' = (wrongHostRestore \/ identity # savedIdentity)
       ELSE UNCHANGED <<acknowledged, wrongHostRestore>>
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  identity, loginPending, loginIdentity, loginUser, containerVars>>

(* A listing already carries a pending container create's id and metadata, *)
(* which the server alone vouches for (#2365 finding 26). The fixed client *)
(* adopts only through AdoptContainerCreate.                               *)
DiscoverContainer(scope) ==
  /\ pendingContainerCreate /\ ~VerifyContainerAdoption
  /\ pendingContainerCreate' = FALSE /\ containerScope' = scope
  /\ UNCHANGED <<verifiedContainerAdoption, pendingCreate, documentScope, linkedScope,
                  verifiedAdoption, acknowledged, identity, loginPending, loginIdentity,
                  loginUser, wrongHostRestore>>

(* Adoption checks the signed epoch-1 create: this user and the intended   *)
(* organization. A different committed parent is a move the user made      *)
(* while the create was pending, queued rather than refused.               *)
AdoptContainerCreate(scope) ==
  /\ pendingContainerCreate /\ scope = IntendedScope
  /\ pendingContainerCreate' = FALSE /\ containerScope' = scope
  /\ verifiedContainerAdoption' = TRUE
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  acknowledged, identity, loginPending, loginIdentity, loginUser,
                  wrongHostRestore>>

Next == (\E s \in Scopes : Discover(s) \/ VerifyCreate(s))
        \/ (\E s \in Scopes : DiscoverContainer(s) \/ AdoptContainerCreate(s))
        \/ (\E i \in Identities : SwitchIdentity(i))
        \/ (\E u \in Users : BeginLogin(u)) \/ FinishLogin
        \/ (\E i \in Identities, u \in Users : HostRestore(i, u))
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ {pendingCreate, verifiedAdoption, loginPending, wrongHostRestore,
      pendingContainerCreate, verifiedContainerAdoption} \subseteq BOOLEAN
  /\ containerScope \in Scopes
  /\ {documentScope, linkedScope} \subseteq Scopes /\ acknowledged \in [Identities -> Users \cup {None}]
  /\ {identity, loginIdentity} \subseteq Identities /\ loginUser \in Users
AdoptionHasVerifiedScope == ~pendingCreate => verifiedAdoption /\ documentScope = IntendedScope
ContainerAdoptionHasVerifiedScope ==
  ~pendingContainerCreate => verifiedContainerAdoption /\ containerScope = IntendedScope
HostRestoresKeepIdentity == ~wrongHostRestore
PendingLinksKeepIntent == pendingCreate => linkedScope = IntendedScope
AcknowledgmentsNeverChange ==
  [][\A i \in Identities : acknowledged[i] # None => acknowledged'[i] = acknowledged[i]]_vars
=============================================================================
