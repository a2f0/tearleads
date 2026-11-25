--------------------------- MODULE PurgeRecovery ---------------------------
EXTENDS Naturals
CONSTANTS VerifyReplacement, VerifyProvisioning, PreserveCheckpoints, ScopeDiscovery, PinBeforeAdoption,
          RequirePersonalOrganization, ReserveFreedIds, ReserveForOwner
ASSUME {VerifyReplacement, VerifyProvisioning, PreserveCheckpoints, ScopeDiscovery, PinBeforeAdoption,
        RequirePersonalOrganization, ReserveFreedIds, ReserveForOwner}
       \subseteq BOOLEAN
Devices == {"left", "right"}
(* `personal` is whether the organization is the user's own personal one;  *)
(* `reportedPurged` is the API's unsigned billing status, which a dishonest *)
(* API may report at any time.                                              *)
VARIABLES signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
          winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
          provisioned, discoveryOrganization, discovered, personal, reportedPurged,
          purged, idHolder, reserved, recreated
recoveryVars == <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
          winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
          provisioned, discoveryOrganization, discovered>>
idVars == <<purged, idHolder, reserved, recreated>>
vars == <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
          winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
          provisioned, discoveryOrganization, discovered, personal, reportedPurged,
          purged, idHolder, reserved, recreated>>
triggerVars == <<personal, reportedPurged>>

Authorized == signerIsSelf /\ sameOldOrganization /\ responseMatchesProof
Init ==
  /\ signerIsSelf \in BOOLEAN /\ sameOldOrganization \in BOOLEAN
  /\ responseMatchesProof \in BOOLEAN /\ freshPrivateGenesis \in BOOLEAN
  /\ winner \in Devices
  /\ personal \in BOOLEAN /\ reportedPurged = FALSE
  /\ phase = "active" /\ corpusTarget = "old"
  /\ oldCheckpoint = 2 /\ newCheckpoint = 0
  /\ provisioned = FALSE
  /\ discoveryOrganization \in {"old", "new"} /\ discovered = FALSE
  /\ purged = FALSE /\ idHolder = "old" /\ reserved = FALSE /\ recreated = FALSE

(* The API's purged status is unsigned: a dishonest API reports it for an  *)
(* organization that was never purged.                                     *)
ServerReportsPurged ==
  /\ ~reportedPurged /\ reportedPurged' = TRUE
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
                  provisioned, discoveryOrganization, discovered, personal>>

(* An administrator's device starts recovery on that status, but only for  *)
(* the user's own personal organization: a shared organization's members   *)
(* never re-home on the server's word. Adoption still needs signed intent. *)
StartRecovery ==
  /\ phase = "active" /\ reportedPurged
  /\ RequirePersonalOrganization => personal
  /\ phase' = "pending"
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, corpusTarget, oldCheckpoint, newCheckpoint,
                  provisioned, discoveryOrganization, discovered, triggerVars>>

(* The API checks the submitted authorization even when returning a stored winner. *)
Provision ==
  /\ ~VerifyProvisioning \/ (Authorized /\ freshPrivateGenesis)
  /\ provisioned' = TRUE
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
                  discoveryOrganization, discovered, triggerVars>>

(* Either device's identity-signed winner can be adopted; the API may lie. *)
Authenticate ==
  /\ phase = "pending"
  /\ ~VerifyReplacement \/ Authorized
  /\ phase' = "authenticated" /\ newCheckpoint' = IF PinBeforeAdoption THEN 1 ELSE 0
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, corpusTarget, oldCheckpoint, provisioned, discoveryOrganization, discovered,
                  triggerVars>>
Reset ==
  /\ phase = "authenticated"
  /\ phase' = "reset" /\ corpusTarget' = winner
  /\ oldCheckpoint' = IF PreserveCheckpoints THEN oldCheckpoint ELSE 0
  /\ newCheckpoint' = IF PreserveCheckpoints THEN newCheckpoint ELSE 0
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, provisioned, discoveryOrganization, discovered, triggerVars>>
Discover ==
  /\ phase = "reset"
  /\ ~ScopeDiscovery \/ discoveryOrganization = "new"
  /\ discovered' = TRUE
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, phase, corpusTarget, oldCheckpoint, newCheckpoint, provisioned, discoveryOrganization,
                  triggerVars>>
(* One container or document id of the purged organization. The honest   *)
(* purge job deletes its rows, freeing the id, and in the same transaction *)
(* reserves it for the user whose personal organization it was: the only  *)
(* user who may replace it. A shared organization has no such user, and    *)
(* its purge reserves nothing.                                             *)
PurgeJob ==
  /\ ~purged
  /\ purged' = TRUE /\ reportedPurged' = TRUE
  /\ idHolder' = "free" /\ reserved' = (ReserveFreedIds /\ personal)
  /\ UNCHANGED <<recoveryVars, personal, recreated>>
(* Another user who learned the id creates it in its own organization.    *)
OutsiderCreate ==
  /\ idHolder = "free" /\ ~reserved
  /\ idHolder' = "outsider"
  /\ UNCHANGED <<recoveryVars, triggerVars, purged, reserved, recreated>>
(* A member the owner re-invited writes into the replacement organization; *)
(* a reservation keyed by that organization, not by the owner, admits it.  *)
MemberCreate ==
  /\ phase = "reset" /\ idHolder = "free" /\ (~reserved \/ ~ReserveForOwner)
  /\ idHolder' = "member"
  /\ UNCHANGED <<recoveryVars, triggerVars, purged, reserved, recreated>>
(* The owner's device republishes the id under the replacement, consuming  *)
(* the reservation; another owner device's create then adopts that copy.   *)
Recreate ==
  /\ phase = "reset" /\ idHolder \in {"free", "owner"}
  /\ idHolder' = "owner" /\ reserved' = FALSE /\ recreated' = TRUE
  /\ UNCHANGED <<recoveryVars, triggerVars, purged>>
RecoveryStep == ServerReportsPurged \/ StartRecovery \/ Provision \/ Authenticate \/ Reset \/ Discover
Next == (RecoveryStep /\ UNCHANGED idVars)
        \/ PurgeJob \/ OutsiderCreate \/ MemberCreate \/ Recreate
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ {signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
       provisioned, discovered} \subseteq BOOLEAN
  /\ {personal, reportedPurged} \subseteq BOOLEAN
  /\ winner \in Devices /\ phase \in {"active", "pending", "authenticated", "reset"}
  /\ corpusTarget \in Devices \cup {"old"}
  /\ oldCheckpoint \in {0, 2} /\ newCheckpoint \in {0, 1}
  /\ discoveryOrganization \in {"old", "new"}
  /\ purged \in BOOLEAN /\ reserved \in BOOLEAN /\ recreated \in BOOLEAN
  /\ idHolder \in {"old", "free", "owner", "member", "outsider"}
Adopted == phase \in {"authenticated", "reset"}
OnlyAuthorizedAdoption == Adopted => Authorized
OnlyAuthorizedProvisioning == provisioned => Authorized /\ freshPrivateGenesis
RetainOldCheckpoint == oldCheckpoint = 2
RetainWinningGenesis == Adopted => newCheckpoint = 1
(* The purged status alone never moves a shared organization's members. *)
RecoveryOnlyForPersonalOrganization == phase # "active" => personal
DiscoveryStaysInReplacement == discovered => discoveryOrganization = "new"
EitherDeviceCanRecover == (phase = "pending" /\ Authorized) => ENABLED Authenticate
AuthenticatedResetCanProceed == phase = "authenticated" => ENABLED Reset
(* No other user's create can stop the owner's recreation of a purged id: *)
(* other users' writes are not fair steps under the no-brick invariant.    *)
RecreateCanProceed == (phase = "reset" /\ purged /\ ~recreated) => ENABLED Recreate
=============================================================================
