------------------------ MODULE RootDocumentPriming ------------------------
EXTENDS Naturals
CONSTANTS ReprimeAfterRemoteAcknowledgment, AcknowledgeOnlyOnSuccess
ASSUME {ReprimeAfterRemoteAcknowledgment, AcknowledgeOnlyOnSuccess} \subseteq BOOLEAN
(* serverHasRoot: the server durably holds the root, which only a           *)
(* successful acknowledgement proves.                                       *)
VARIABLES rootRemote, primeRequested, documentSynced, serverHasRoot
vars == <<rootRemote, primeRequested, documentSynced, serverHasRoot>>

Init ==
  /\ rootRemote = FALSE
  /\ primeRequested = TRUE
  /\ documentSynced = FALSE
  /\ serverHasRoot = FALSE

(* A document pass can run while the root's signed role proof is in flight. *)
Prime ==
  /\ primeRequested
  /\ primeRequested' = FALSE
  /\ documentSynced' = rootRemote
  /\ UNCHANGED <<rootRemote, serverHasRoot>>

(* Only the successful, durable acknowledgement releases pending creates. *)
AcknowledgeRoot ==
  /\ ~rootRemote
  /\ rootRemote' = TRUE
  /\ serverHasRoot' = TRUE
  /\ primeRequested' = (primeRequested \/ ReprimeAfterRemoteAcknowledgment)
  /\ UNCHANGED documentSynced

(* The acknowledgement request fails or is refused; it is retried later. A  *)
(* failure must not count as the remote acknowledgement.                     *)
FailAcknowledgement ==
  /\ ~rootRemote
  /\ rootRemote' = ~AcknowledgeOnlyOnSuccess
  /\ primeRequested' = (primeRequested \/ (~AcknowledgeOnlyOnSuccess /\ ReprimeAfterRemoteAcknowledgment))
  /\ UNCHANGED <<documentSynced, serverHasRoot>>

Next == Prime \/ AcknowledgeRoot \/ FailAcknowledgement \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars /\ WF_vars(Prime) /\ WF_vars(AcknowledgeRoot)
TypeOK == {rootRemote, primeRequested, documentSynced, serverHasRoot} \subseteq BOOLEAN
(* The device treats the root as remote only once the server holds it. *)
RemoteRootIsAcknowledged == rootRemote => serverHasRoot
DeferredDocumentsAreScheduled == (rootRemote /\ ~documentSynced) => primeRequested
DocumentsWaitForRemoteRoot == documentSynced => rootRemote
DocumentEventuallySyncs == <>documentSynced
=============================================================================
