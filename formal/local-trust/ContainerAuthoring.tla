------------------------ MODULE ContainerAuthoring ------------------------
EXTENDS Naturals

CONSTANTS CheckAuthorAccess, CheckAcknowledgedHead
ASSUME {CheckAuthorAccess, CheckAcknowledgedHead} \subseteq BOOLEAN
Access == {"read", "write", "admin"}
Operations == {"childCreate", "systemCreate", "documentCreate", "share",
               "revoke", "rekey", "move", "documentLink"}
Rank(a) == CASE a = "admin" -> 3 [] a = "write" -> 2 [] OTHER -> 1

(* The manifest head (manifest hash and signed event hash) an accepted     *)
(* acknowledgement names: "none" before one is accepted, "plan" for the     *)
(* head this client signed, "unsigned" for any other head.                 *)
Heads == {"none", "plan", "unsigned"}

VARIABLES sourceAccess, destinationAccess, operation, phase, signedPlan,
          acknowledged, terminalFailure, checkpoint
vars == <<sourceAccess, destinationAccess, operation, phase, signedPlan,
          acknowledged, terminalFailure, checkpoint>>

CanAuthor ==
  /\ Rank(sourceAccess) >=
      (IF operation \in {"childCreate", "documentCreate", "rekey", "documentLink"} THEN 2 ELSE 3)
  /\ (operation \notin {"move", "documentLink"} \/ Rank(destinationAccess) >= 2)

Init ==
  /\ sourceAccess \in Access /\ destinationAccess \in Access
  /\ operation \in Operations /\ phase = "unread"
  /\ signedPlan = FALSE /\ acknowledged = FALSE /\ terminalFailure = 0
  /\ checkpoint = "none"

(* Every role can fetch and decrypt a valid signed read projection. *)
FetchVerifiedProjection ==
  /\ phase = "unread" /\ phase' = "verified"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  acknowledged, terminalFailure, checkpoint>>

SignMutation ==
  /\ phase = "verified" /\ (~CheckAuthorAccess \/ CanAuthor)
  /\ signedPlan' = TRUE /\ phase' = "signed"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, acknowledged,
                  terminalFailure, checkpoint>>

RefuseMutation ==
  /\ phase = "verified" /\ CheckAuthorAccess /\ ~CanAuthor
  /\ phase' = "refused"
  /\ terminalFailure' = IF operation \in {"documentCreate", "documentLink"} THEN 403 ELSE 0
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  acknowledged, checkpoint>>

(* A dishonest server echoes the client's exact plan, without authorization. *)
EchoAcknowledgement ==
  /\ phase = "signed" /\ acknowledged' = TRUE /\ phase' = "acknowledged"
  /\ checkpoint' = "plan"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  terminalFailure>>

(* A dishonest server acknowledges a head the client never signed: another *)
(* manifest hash or event hash. The client compares every returned hash    *)
(* with its signed plan and refuses a mismatch, leaving the mutation       *)
(* unacknowledged; without the comparison it would pin the named head.     *)
ForgedAcknowledgement ==
  /\ phase = "signed"
  /\ IF CheckAcknowledgedHead
       THEN /\ phase' = "ackRefused"
            /\ UNCHANGED <<acknowledged, checkpoint>>
       ELSE /\ phase' = "acknowledged" /\ acknowledged' = TRUE
            /\ checkpoint' = "unsigned"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  terminalFailure>>

AcknowledgementsHaveAuthority == acknowledged => CanAuthor
(* An acknowledged checkpoint is exactly the signed plan's manifest head.  *)
AcknowledgedCheckpointIsSigned ==
  /\ acknowledged => (signedPlan /\ checkpoint = "plan")
  /\ ~acknowledged => checkpoint = "none"
DocumentRefusalsAreVisible ==
  (phase = "refused" /\ operation \in {"documentCreate", "documentLink"}) => terminalFailure = 403
TypeOK ==
  /\ sourceAccess \in Access /\ destinationAccess \in Access
  /\ operation \in Operations
  /\ phase \in {"unread", "verified", "signed", "refused", "ackRefused",
                "acknowledged"}
  /\ signedPlan \in BOOLEAN /\ acknowledged \in BOOLEAN
  /\ terminalFailure \in {0, 403}
  /\ checkpoint \in Heads

Idle == UNCHANGED vars
Next == FetchVerifiedProjection \/ SignMutation \/ RefuseMutation
        \/ EchoAcknowledgement \/ ForgedAcknowledgement \/ Idle
Spec == Init /\ [][Next]_vars
=============================================================================
