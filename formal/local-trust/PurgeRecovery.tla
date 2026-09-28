--------------------------- MODULE PurgeRecovery ---------------------------
EXTENDS Naturals
CONSTANTS VerifyReplacement, VerifyProvisioning, PreserveCheckpoints, ScopeDiscovery, PinBeforeAdoption
ASSUME {VerifyReplacement, VerifyProvisioning, PreserveCheckpoints, ScopeDiscovery, PinBeforeAdoption}
       \subseteq BOOLEAN
Devices == {"left", "right"}
VARIABLES signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
          winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
          provisioned, discoveryOrganization, discovered
vars == <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
          winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
          provisioned, discoveryOrganization, discovered>>

Authorized == signerIsSelf /\ sameOldOrganization /\ responseMatchesProof
Init ==
  /\ signerIsSelf \in BOOLEAN /\ sameOldOrganization \in BOOLEAN
  /\ responseMatchesProof \in BOOLEAN /\ freshPrivateGenesis \in BOOLEAN
  /\ winner \in Devices
  /\ phase = "pending" /\ corpusTarget = "old"
  /\ oldCheckpoint = 2 /\ newCheckpoint = 0
  /\ provisioned = FALSE
  /\ discoveryOrganization \in {"old", "new"} /\ discovered = FALSE

(* The API checks the submitted authorization even when returning a stored winner. *)
Provision ==
  /\ ~VerifyProvisioning \/ (Authorized /\ freshPrivateGenesis)
  /\ provisioned' = TRUE
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, phase, corpusTarget, oldCheckpoint, newCheckpoint,
                  discoveryOrganization, discovered>>

(* Either device's identity-signed winner can be adopted; the API may lie. *)
Authenticate ==
  /\ phase = "pending"
  /\ ~VerifyReplacement \/ Authorized
  /\ phase' = "authenticated" /\ newCheckpoint' = IF PinBeforeAdoption THEN 1 ELSE 0
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, corpusTarget, oldCheckpoint, provisioned, discoveryOrganization, discovered>>
Reset ==
  /\ phase = "authenticated"
  /\ phase' = "reset" /\ corpusTarget' = winner
  /\ oldCheckpoint' = IF PreserveCheckpoints THEN oldCheckpoint ELSE 0
  /\ newCheckpoint' = IF PreserveCheckpoints THEN newCheckpoint ELSE 0
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, provisioned, discoveryOrganization, discovered>>
Discover ==
  /\ phase = "reset"
  /\ ~ScopeDiscovery \/ discoveryOrganization = "new"
  /\ discovered' = TRUE
  /\ UNCHANGED <<signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
                  winner, phase, corpusTarget, oldCheckpoint, newCheckpoint, provisioned, discoveryOrganization>>
Next == Provision \/ Authenticate \/ Reset \/ Discover \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ {signerIsSelf, sameOldOrganization, responseMatchesProof, freshPrivateGenesis,
       provisioned, discovered} \subseteq BOOLEAN
  /\ winner \in Devices /\ phase \in {"pending", "authenticated", "reset"}
  /\ corpusTarget \in Devices \cup {"old"}
  /\ oldCheckpoint \in {0, 2} /\ newCheckpoint \in {0, 1}
  /\ discoveryOrganization \in {"old", "new"}
OnlyAuthorizedAdoption == phase # "pending" => Authorized
OnlyAuthorizedProvisioning == provisioned => Authorized /\ freshPrivateGenesis
RetainOldCheckpoint == oldCheckpoint = 2
RetainWinningGenesis == phase # "pending" => newCheckpoint = 1
DiscoveryStaysInReplacement == discovered => discoveryOrganization = "new"
EitherDeviceCanRecover == (phase = "pending" /\ Authorized) => ENABLED Authenticate
AuthenticatedResetCanProceed == phase = "authenticated" => ENABLED Reset
=============================================================================
