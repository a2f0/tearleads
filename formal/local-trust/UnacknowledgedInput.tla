----------------------- MODULE UnacknowledgedInput -----------------------
EXTENDS FiniteSets

CONSTANTS Identities, Users, Scopes, InitialIdentity, InitialUser,
          IntendedScope, None, DeferDiscoveryAdoption, DeferLinkDiscovery, EnforceLoginBinding, CheckRestoreIdentity,
          DurablePinRebindCheck
ASSUME /\ InitialIdentity \in Identities /\ InitialUser \in Users
       /\ IntendedScope \in Scopes /\ None \notin Users
       /\ IsFiniteSet(Identities) /\ IsFiniteSet(Users) /\ IsFiniteSet(Scopes)
       /\ {DeferDiscoveryAdoption, DeferLinkDiscovery, EnforceLoginBinding, CheckRestoreIdentity,
           DurablePinRebindCheck} \subseteq BOOLEAN

VARIABLES pendingCreate, documentScope, linkedScope, verifiedAdoption,
          acknowledged, pinned, identity, loginPending, loginIdentity, loginUser, wrongHostRestore
vars == <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
          acknowledged, pinned, identity, loginPending, loginIdentity, loginUser, wrongHostRestore>>

Init ==
  /\ pendingCreate = TRUE /\ documentScope = IntendedScope /\ linkedScope = IntendedScope
  /\ verifiedAdoption = FALSE
  /\ acknowledged = [i \in Identities |-> IF i = InitialIdentity THEN InitialUser ELSE None]
  /\ pinned = acknowledged
  /\ identity = InitialIdentity /\ loginPending = FALSE
  /\ loginIdentity = InitialIdentity /\ loginUser = InitialUser /\ wrongHostRestore = FALSE

(* The listing names the pending create's stable ID, but has no signed scope. *)
Discover(scope) ==
  /\ pendingCreate
  /\ IF DeferDiscoveryAdoption
       THEN UNCHANGED <<pendingCreate, documentScope>>
       ELSE /\ pendingCreate' = FALSE /\ documentScope' = scope
  /\ IF DeferLinkDiscovery THEN UNCHANGED linkedScope ELSE linkedScope' = scope
  /\ UNCHANGED <<verifiedAdoption, acknowledged, pinned, identity,
                  loginPending, loginIdentity, loginUser, wrongHostRestore>>

(* A create retry verifies the signed scope before adopting and releasing edits. *)
VerifyCreate(scope) ==
  /\ pendingCreate /\ scope = IntendedScope
  /\ pendingCreate' = FALSE /\ documentScope' = scope /\ linkedScope' = scope
  /\ verifiedAdoption' = TRUE
  /\ UNCHANGED <<acknowledged, pinned, identity, loginPending, loginIdentity, loginUser, wrongHostRestore>>

SwitchIdentity(i) ==
  /\ identity' = i
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  acknowledged, pinned, loginPending, loginIdentity, loginUser, wrongHostRestore>>

BeginLogin(user) ==
  /\ ~loginPending /\ loginPending' = TRUE
  /\ loginIdentity' = identity /\ loginUser' = user
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  acknowledged, pinned, identity, wrongHostRestore>>

(* The in-memory acknowledgment map is empty after a boot that restores no   *)
(* persisted session; the durable pin rows (keyed by trust domain and user)  *)
(* survive. DurablePinRebindCheck consults them when the volatile map is     *)
(* empty: the same signing identity may not be rebound to a different user   *)
(* ID once pinned, so a dishonest auth response naming a different user is   *)
(* refused instead of poisoning the pin table. In-session rebinds are        *)
(* EnforceLoginBinding's job. An honest server keeps fingerprint-user pairs  *)
(* 1:1.                                                                      *)
FinishLogin ==
  /\ loginPending /\ loginPending' = FALSE
  /\ IF identity = loginIdentity /\
          (~EnforceLoginBinding \/ acknowledged[identity] \in {None, loginUser}) /\
          (~DurablePinRebindCheck \/ acknowledged[identity] # None \/
             pinned[identity] \in {None, loginUser})
       THEN /\ acknowledged' = [acknowledged EXCEPT ![identity] = loginUser]
            /\ pinned' = [pinned EXCEPT ![identity] = loginUser]
       ELSE UNCHANGED <<acknowledged, pinned>>
  /\ UNCHANGED <<pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  identity, loginIdentity, loginUser, wrongHostRestore>>

(* A reboot clears the in-memory acknowledgment (a fresh SessionService has *)
(* no remembered bindings) while the durable pins persist.                  *)
Reboot ==
  /\ acknowledged' = [i \in Identities |-> None]
  /\ UNCHANGED <<pinned, pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  identity, loginPending, loginIdentity, loginUser, wrongHostRestore>>

(* A host restore carries the identity under which the trusted record was saved. *)
HostRestore(savedIdentity, user) ==
  /\ acknowledged[savedIdentity] = user
  /\ IF (~CheckRestoreIdentity \/ identity = savedIdentity) /\ acknowledged[identity] \in {None, user}
       THEN /\ acknowledged' = [acknowledged EXCEPT ![identity] = user]
            /\ wrongHostRestore' = (wrongHostRestore \/ identity # savedIdentity)
       ELSE UNCHANGED <<acknowledged, wrongHostRestore>>
  /\ UNCHANGED <<pinned, pendingCreate, documentScope, linkedScope, verifiedAdoption,
                  identity, loginPending, loginIdentity, loginUser>>

Next == (\E s \in Scopes : Discover(s) \/ VerifyCreate(s))
        \/ (\E i \in Identities : SwitchIdentity(i))
        \/ (\E u \in Users : BeginLogin(u)) \/ FinishLogin \/ Reboot
        \/ (\E i \in Identities, u \in Users : HostRestore(i, u))
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ {pendingCreate, verifiedAdoption, loginPending, wrongHostRestore} \subseteq BOOLEAN
  /\ {documentScope, linkedScope} \subseteq Scopes /\ acknowledged \in [Identities -> Users \cup {None}]
  /\ pinned \in [Identities -> Users \cup {None}]
  /\ {identity, loginIdentity} \subseteq Identities /\ loginUser \in Users
AdoptionHasVerifiedScope == ~pendingCreate => verifiedAdoption /\ documentScope = IntendedScope
HostRestoresKeepIdentity == ~wrongHostRestore
PendingLinksKeepIntent == pendingCreate => linkedScope = IntendedScope
(* An established acknowledgment may be cleared (reboot, logout) but never   *)
(* changed to a different user for the same signing identity.                *)
AcknowledgmentsNeverChange ==
  [][\A i \in Identities :
      acknowledged[i] # None /\ acknowledged'[i] # None
        => acknowledged'[i] = acknowledged[i]]_vars
(* The durable pin, which survives reboots, never changes user once set:     *)
(* a login that would rebind a pinned fingerprint to another user ID must    *)
(* be refused instead of rewriting (and poisoning) the pin.                  *)
PinsNeverChange ==
  [][\A i \in Identities : pinned[i] # None => pinned'[i] = pinned[i]]_vars
=============================================================================
