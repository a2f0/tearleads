------------------------ MODULE RootDocumentPriming ------------------------
EXTENDS Naturals
CONSTANT ReprimeAfterRemoteAcknowledgment
ASSUME ReprimeAfterRemoteAcknowledgment \in BOOLEAN
VARIABLES rootRemote, primeRequested, documentSynced
vars == <<rootRemote, primeRequested, documentSynced>>

Init ==
  /\ rootRemote = FALSE
  /\ primeRequested = TRUE
  /\ documentSynced = FALSE

(* A document pass can run while the root's signed role proof is in flight. *)
Prime ==
  /\ primeRequested
  /\ primeRequested' = FALSE
  /\ documentSynced' = rootRemote
  /\ UNCHANGED rootRemote

(* Only the successful, durable acknowledgement releases pending creates. *)
AcknowledgeRoot ==
  /\ ~rootRemote
  /\ rootRemote' = TRUE
  /\ primeRequested' = primeRequested \/ ReprimeAfterRemoteAcknowledgment
  /\ UNCHANGED documentSynced

Next == Prime \/ AcknowledgeRoot
Spec == Init /\ [][Next]_vars /\ WF_vars(Prime) /\ WF_vars(AcknowledgeRoot)
TypeOK == {rootRemote, primeRequested, documentSynced} \subseteq BOOLEAN
DeferredDocumentsAreScheduled == (rootRemote /\ ~documentSynced) => primeRequested
DocumentsWaitForRemoteRoot == documentSynced => rootRemote
DocumentEventuallySyncs == <>documentSynced
=============================================================================
