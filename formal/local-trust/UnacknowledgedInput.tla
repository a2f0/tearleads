----------------------- MODULE UnacknowledgedInput -----------------------
EXTENDS FiniteSets

CONSTANTS Identities, Users, Scopes, InitialIdentity, InitialUser,
          IntendedScope, None, DeferDiscoveryAdoption, EnforceLoginBinding
ASSUME /\ InitialIdentity \in Identities /\ InitialUser \in Users
       /\ IntendedScope \in Scopes /\ None \notin Users
       /\ IsFiniteSet(Identities) /\ IsFiniteSet(Users) /\ IsFiniteSet(Scopes)
       /\ {DeferDiscoveryAdoption, EnforceLoginBinding} \subseteq BOOLEAN

VARIABLES pendingCreate, documentScope, verifiedAdoption,
          acknowledged, identity, loginPending, loginIdentity, loginUser
vars == <<pendingCreate, documentScope, verifiedAdoption,
          acknowledged, identity, loginPending, loginIdentity, loginUser>>

Init ==
  /\ pendingCreate = TRUE /\ documentScope = IntendedScope
  /\ verifiedAdoption = FALSE
  /\ acknowledged = [i \in Identities |-> IF i = InitialIdentity THEN InitialUser ELSE None]
  /\ identity = InitialIdentity /\ loginPending = FALSE
  /\ loginIdentity = InitialIdentity /\ loginUser = InitialUser

(* The listing names the pending create's stable ID, but has no signed scope. *)
Discover(scope) ==
  /\ pendingCreate
  /\ IF DeferDiscoveryAdoption
       THEN UNCHANGED <<pendingCreate, documentScope>>
       ELSE /\ pendingCreate' = FALSE /\ documentScope' = scope
  /\ UNCHANGED <<verifiedAdoption, acknowledged, identity,
                  loginPending, loginIdentity, loginUser>>

(* A create retry verifies the signed scope before adopting and releasing edits. *)
VerifyCreate(scope) ==
  /\ pendingCreate /\ scope = IntendedScope
  /\ pendingCreate' = FALSE /\ documentScope' = scope
  /\ verifiedAdoption' = TRUE
  /\ UNCHANGED <<acknowledged, identity, loginPending, loginIdentity, loginUser>>

SwitchIdentity(i) ==
  /\ identity' = i
  /\ UNCHANGED <<pendingCreate, documentScope, verifiedAdoption,
                  acknowledged, loginPending, loginIdentity, loginUser>>

BeginLogin(user) ==
  /\ ~loginPending /\ loginPending' = TRUE
  /\ loginIdentity' = identity /\ loginUser' = user
  /\ UNCHANGED <<pendingCreate, documentScope, verifiedAdoption,
                  acknowledged, identity>>

FinishLogin ==
  /\ loginPending /\ loginPending' = FALSE
  /\ IF identity = loginIdentity /\
          (~EnforceLoginBinding \/ acknowledged[identity] \in {None, loginUser})
       THEN acknowledged' = [acknowledged EXCEPT ![identity] = loginUser]
       ELSE UNCHANGED acknowledged
  /\ UNCHANGED <<pendingCreate, documentScope, verifiedAdoption,
                  identity, loginIdentity, loginUser>>

Next == (\E s \in Scopes : Discover(s) \/ VerifyCreate(s))
        \/ (\E i \in Identities : SwitchIdentity(i))
        \/ (\E u \in Users : BeginLogin(u)) \/ FinishLogin
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ {pendingCreate, verifiedAdoption, loginPending} \subseteq BOOLEAN
  /\ documentScope \in Scopes /\ acknowledged \in [Identities -> Users \cup {None}]
  /\ {identity, loginIdentity} \subseteq Identities /\ loginUser \in Users
AdoptionHasVerifiedScope == ~pendingCreate => verifiedAdoption /\ documentScope = IntendedScope
AcknowledgmentsNeverChange ==
  [][\A i \in Identities : acknowledged[i] # None => acknowledged'[i] = acknowledged[i]]_vars
=============================================================================
