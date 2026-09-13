----------------------- MODULE UnacknowledgedInput -----------------------
EXTENDS FiniteSets

CONSTANTS Identities, Users, Scopes, InitialIdentity, InitialUser,
          IntendedScope, None, DeferDiscoveryAdoption, DeferLinkDiscovery, EnforceLoginBinding, CheckRestoreIdentity
ASSUME /\ InitialIdentity \in Identities /\ InitialUser \in Users
       /\ IntendedScope \in Scopes /\ None \notin Users
       /\ IsFiniteSet(Identities) /\ IsFiniteSet(Users) /\ IsFiniteSet(Scopes)
       /\ {DeferDiscoveryAdoption, DeferLinkDiscovery, EnforceLoginBinding, CheckRestoreIdentity} \subseteq BOOLEAN

VARIABLES pendingCreate, documentScope, linkedScope, verifiedAdoption,
          acknowledged, identity, loginPending, loginIdentity, loginUser, wrongHostRestore
vars == <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
          acknowledged, identity, loginPending, loginIdentity, loginUser, wrongHostRestore>>

Init ==
  /\ pendingCreate = TRUE /\ documentScope = IntendedScope /\ linkedScope = IntendedScope
  /\ verifiedAdoption = FALSE
  /\ acknowledged = [i \in Identities |-> IF i = InitialIdentity THEN InitialUser ELSE None]
  /\ identity = InitialIdentity /\ loginPending = FALSE
  /\ loginIdentity = InitialIdentity /\ loginUser = InitialUser /\ wrongHostRestore = FALSE

(* The listing names the pending create's stable ID, but has no signed scope. *)
Discover(scope) ==
  /\ pendingCreate
  /\ IF DeferDiscoveryAdoption
       THEN UNCHANGED <<pendingCreate, documentScope>>
       ELSE /\ pendingCreate' = FALSE /\ documentScope' = scope
  /\ IF DeferLinkDiscovery THEN UNCHANGED linkedScope ELSE linkedScope' = scope
  /\ UNCHANGED <<verifiedAdoption, acknowledged, identity,
                  loginPending, loginIdentity, loginUser, wrongHostRestore>>

(* A create retry verifies the signed scope before adopting and releasing edits. *)
VerifyCreate(scope) ==
  /\ pendingCreate /\ scope = IntendedScope
  /\ pendingCreate' = FALSE /\ documentScope' = scope /\ linkedScope' = scope
  /\ verifiedAdoption' = TRUE
  /\ UNCHANGED <<acknowledged, identity, loginPending, loginIdentity, loginUser, wrongHostRestore>>

SwitchIdentity(i) ==
  /\ identity' = i
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  acknowledged, loginPending, loginIdentity, loginUser, wrongHostRestore>>

BeginLogin(user) ==
  /\ ~loginPending /\ loginPending' = TRUE
  /\ loginIdentity' = identity /\ loginUser' = user
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  acknowledged, identity, wrongHostRestore>>

FinishLogin ==
  /\ loginPending /\ loginPending' = FALSE
  /\ IF identity = loginIdentity /\
          (~EnforceLoginBinding \/ acknowledged[identity] \in {None, loginUser})
       THEN acknowledged' = [acknowledged EXCEPT ![identity] = loginUser]
       ELSE UNCHANGED acknowledged
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  identity, loginIdentity, loginUser, wrongHostRestore>>

(* A host restore carries the identity under which the trusted record was saved. *)
HostRestore(savedIdentity, user) ==
  /\ acknowledged[savedIdentity] = user
  /\ IF (~CheckRestoreIdentity \/ identity = savedIdentity) /\ acknowledged[identity] \in {None, user}
       THEN /\ acknowledged' = [acknowledged EXCEPT ![identity] = user]
            /\ wrongHostRestore' = (wrongHostRestore \/ identity # savedIdentity)
       ELSE UNCHANGED <<acknowledged, wrongHostRestore>>
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  identity, loginPending, loginIdentity, loginUser>>

Next == (\E s \in Scopes : Discover(s) \/ VerifyCreate(s))
        \/ (\E i \in Identities : SwitchIdentity(i))
        \/ (\E u \in Users : BeginLogin(u)) \/ FinishLogin
        \/ (\E i \in Identities, u \in Users : HostRestore(i, u))
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ {pendingCreate, verifiedAdoption, loginPending, wrongHostRestore} \subseteq BOOLEAN
  /\ {documentScope, linkedScope} \subseteq Scopes /\ acknowledged \in [Identities -> Users \cup {None}]
  /\ {identity, loginIdentity} \subseteq Identities /\ loginUser \in Users
AdoptionHasVerifiedScope == ~pendingCreate => verifiedAdoption /\ documentScope = IntendedScope
HostRestoresKeepIdentity == ~wrongHostRestore
PendingLinksKeepIntent == pendingCreate => linkedScope = IntendedScope
AcknowledgmentsNeverChange ==
  [][\A i \in Identities : acknowledged[i] # None => acknowledged'[i] = acknowledged[i]]_vars
=============================================================================
