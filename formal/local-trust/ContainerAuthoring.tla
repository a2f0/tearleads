------------------------ MODULE ContainerAuthoring ------------------------
EXTENDS Naturals

CONSTANTS CheckAuthorAccess, CheckAcknowledgedHead
ASSUME {CheckAuthorAccess, CheckAcknowledgedHead} \subseteq BOOLEAN
Access == {"read", "write", "admin"}
Operations == {"childCreate", "systemCreate", "documentCreate", "share",
               "revoke", "rekey", "move", "documentLink"}
Rank(a) == CASE a = "admin" -> 3 [] a = "write" -> 2 [] OTHER -> 1

(* A manifest head (manifest hash and signed event hash): "none" before an *)
(* acknowledgement is accepted, "plan" for the head this client signed,    *)
(* "unsigned" for any other head. checkpoint is the head the client pins,  *)
(* which production builds from the signed plan alone; ackHead is the head *)
(* the accepted response says the server committed.                        *)
Heads == {"none", "plan", "unsigned"}

VARIABLES sourceAccess, destinationAccess, operation, phase, signedPlan,
          acknowledged, terminalFailure, checkpoint, ackHead
vars == <<sourceAccess, destinationAccess, operation, phase, signedPlan,
          acknowledged, terminalFailure, checkpoint, ackHead>>

CanAuthor ==
  /\ Rank(sourceAccess) >=
      (IF operation \in {"childCreate", "documentCreate", "rekey", "documentLink"} THEN 2 ELSE 3)
  /\ (operation \notin {"move", "documentLink"} \/ Rank(destinationAccess) >= 2)

Init ==
  /\ sourceAccess \in Access /\ destinationAccess \in Access
  /\ operation \in Operations /\ phase = "unread"
  /\ signedPlan = FALSE /\ acknowledged = FALSE /\ terminalFailure = 0
  /\ checkpoint = "none" /\ ackHead = "none"

(* Every role can fetch and decrypt a valid signed read projection. *)
FetchVerifiedProjection ==
  /\ phase = "unread" /\ phase' = "verified"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  acknowledged, terminalFailure, checkpoint, ackHead>>

SignMutation ==
  /\ phase = "verified" /\ (~CheckAuthorAccess \/ CanAuthor)
  /\ signedPlan' = TRUE /\ phase' = "signed"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, acknowledged,
                  terminalFailure, checkpoint, ackHead>>

RefuseMutation ==
  /\ phase = "verified" /\ CheckAuthorAccess /\ ~CanAuthor
  /\ phase' = "refused"
  /\ terminalFailure' = IF operation \in {"documentCreate", "documentLink"} THEN 403 ELSE 0
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  acknowledged, checkpoint, ackHead>>

(* A dishonest server echoes the client's exact plan, without authorization. *)
EchoAcknowledgement ==
  /\ phase = "signed" /\ acknowledged' = TRUE /\ phase' = "acknowledged"
  /\ checkpoint' = "plan" /\ ackHead' = "plan"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  terminalFailure>>

(* A dishonest server acknowledges a head the client never signed: another *)
(* manifest hash or event hash. The client compares every returned hash    *)
(* with its signed plan and refuses a mismatch, leaving the mutation       *)
(* unacknowledged. Without the comparison it still pins its own plan, so   *)
(* it records as committed a head the server says it did not commit.       *)
ForgedAcknowledgement ==
  /\ phase = "signed"
  /\ IF CheckAcknowledgedHead
       THEN /\ phase' = "ackRefused"
            /\ UNCHANGED <<acknowledged, checkpoint, ackHead>>
       ELSE /\ phase' = "acknowledged" /\ acknowledged' = TRUE
            /\ checkpoint' = "plan" /\ ackHead' = "unsigned"
  /\ UNCHANGED <<sourceAccess, destinationAccess, operation, signedPlan,
                  terminalFailure>>

AcknowledgementsHaveAuthority == acknowledged => CanAuthor
(* An acknowledged checkpoint is the signed plan's manifest head, and it is *)
(* the head the server acknowledged committing.                            *)
AcknowledgedCheckpointIsSigned ==
  /\ acknowledged => (signedPlan /\ checkpoint = "plan" /\ ackHead = checkpoint)
  /\ ~acknowledged => (checkpoint = "none" /\ ackHead = "none")
DocumentRefusalsAreVisible ==
  (phase = "refused" /\ operation \in {"documentCreate", "documentLink"}) => terminalFailure = 403
TypeOK ==
  /\ sourceAccess \in Access /\ destinationAccess \in Access
  /\ operation \in Operations
  /\ phase \in {"unread", "verified", "signed", "refused", "ackRefused",
                "acknowledged"}
  /\ signedPlan \in BOOLEAN /\ acknowledged \in BOOLEAN
  /\ terminalFailure \in {0, 403}
  /\ checkpoint \in Heads /\ ackHead \in Heads

Idle == UNCHANGED vars
Next == FetchVerifiedProjection \/ SignMutation \/ RefuseMutation
        \/ EchoAcknowledgement \/ ForgedAcknowledgement \/ Idle
Spec == Init /\ [][Next]_vars
=============================================================================
