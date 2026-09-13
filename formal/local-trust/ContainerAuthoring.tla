------------------------ MODULE ContainerAuthoring ------------------------
EXTENDS Naturals

CONSTANT CheckAuthorAccess
ASSUME CheckAuthorAccess \in BOOLEAN
Access == {"read", "write", "admin"}
Operations == {"childCreate", "systemCreate", "documentCreate", "share",
               "revoke", "rekey", "move", "documentLink"}
Rank(a) == CASE a = "admin" -> 3 [] a = "write" -> 2 [] OTHER -> 1

VARIABLES sourceAccess, destinationAccess, operation, phase, signedPlan,
          acknowledged, terminalFailure
vars == <<sourceAccess, destinationAccess, operation, phase, signedPlan,
          acknowledged, terminalFailure>>

CanAuthor ==
  /\ Rank(sourceAccess) >=
      (IF operation \in {"childCreate", "documentCreate", "rekey", "documentLink"} THEN 2 ELSE 3)
  /\ (operation \notin {"move", "documentLink"} \/ Rank(destinationAccess) >= 2)

Init ==
  /\ sourceAccess \in Access /\ destinationAccess \in Access
  /\ operation \in Operations /\ phase = "unread"
  /\ signedPlan = FALSE /\ acknowledged = FALSE /\ terminalFailure = 0

(* Every role can fetch and decrypt a valid signed read projection. *)
FetchVerifiedProjection ==
  /\ phase = "unread" /\ phase' = "verified"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  acknowledged, terminalFailure>>

SignMutation ==
  /\ phase = "verified" /\ (~CheckAuthorAccess \/ CanAuthor)
  /\ signedPlan' = TRUE /\ phase' = "signed"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, acknowledged,
                  terminalFailure>>

RefuseMutation ==
  /\ phase = "verified" /\ CheckAuthorAccess /\ ~CanAuthor
  /\ phase' = "refused"
  /\ terminalFailure' = IF operation \in {"documentCreate", "documentLink"} THEN 403 ELSE 0
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  acknowledged>>

(* A dishonest server echoes the client's exact plan, without authorization. *)
EchoAcknowledgement ==
  /\ phase = "signed" /\ acknowledged' = TRUE /\ phase' = "acknowledged"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  terminalFailure>>

AcknowledgementsHaveAuthority == acknowledged => CanAuthor
DocumentRefusalsAreVisible ==
  (phase = "refused" /\ operation \in {"documentCreate", "documentLink"}) => terminalFailure = 403
TypeOK ==
  /\ sourceAccess \in Access /\ destinationAccess \in Access
  /\ operation \in Operations
  /\ phase \in {"unread", "verified", "signed", "refused", "acknowledged"}
  /\ signedPlan \in BOOLEAN /\ acknowledged \in BOOLEAN
  /\ terminalFailure \in {0, 403}

Idle == UNCHANGED vars
Next == FetchVerifiedProjection \/ SignMutation \/ RefuseMutation
        \/ EchoAcknowledgement \/ Idle
Spec == Init /\ [][Next]_vars
=============================================================================
