--------------------- MODULE AttachmentContentIdentity ---------------------
EXTENDS Naturals
CONSTANTS CheckContentDigest, CheckLiveIntent, CompareStoredCopy
ASSUME {CheckContentDigest, CheckLiveIntent, CompareStoredCopy} \subseteq BOOLEAN
VARIABLES documentContent, viewContent, localContent, viewCopy, pending,
          observedIntent, observedCopy, offeredContent, wrongIntent
vars == <<documentContent, viewContent, localContent, viewCopy, pending,
          observedIntent, observedCopy, offeredContent, wrongIntent>>
Init ==
  /\ documentContent = 1 /\ viewContent = 1 /\ localContent = 1 /\ viewCopy = 1
  /\ pending = FALSE /\ observedIntent = 1 /\ observedCopy = 1
  /\ offeredContent = 1 /\ wrongIntent = FALSE
BeginHydration(content) ==
  /\ ~pending
  /\ ~CheckContentDigest \/ content = viewContent
  /\ pending' = TRUE /\ observedIntent' = viewContent
  /\ observedCopy' = viewCopy /\ offeredContent' = content
  /\ UNCHANGED <<documentContent, viewContent, localContent, viewCopy, wrongIntent>>
(* A competing facade installs a newer authenticated document and its bytes. *)
OtherFacadeInstalls ==
  /\ documentContent = 1 /\ documentContent' = 2 /\ localContent' = 2
  /\ UNCHANGED <<viewContent, viewCopy, pending, observedIntent, observedCopy,
                  offeredContent, wrongIntent>>
(* The active view can advance before its new attachment bytes are available. *)
AdvanceView ==
  /\ viewContent = 1 /\ documentContent' = 2 /\ viewContent' = 2
  /\ UNCHANGED <<localContent, viewCopy, pending, observedIntent, observedCopy,
                  offeredContent, wrongIntent>>
CommitHydration ==
  /\ pending
  /\ ~CheckLiveIntent \/ observedIntent = viewContent
  /\ ~CompareStoredCopy \/ observedCopy = localContent
  /\ localContent' = offeredContent /\ viewCopy' = offeredContent /\ pending' = FALSE
  /\ wrongIntent' = (wrongIntent \/ offeredContent # viewContent)
  /\ UNCHANGED <<documentContent, viewContent, observedIntent,
                  observedCopy, offeredContent>>
Cancel ==
  /\ pending /\ pending' = FALSE
  /\ UNCHANGED <<documentContent, viewContent, localContent, viewCopy, observedIntent,
                  observedCopy, offeredContent, wrongIntent>>
Next == (\E content \in {1, 2} : BeginHydration(content))
        \/ OtherFacadeInstalls \/ AdvanceView \/ CommitHydration \/ Cancel
Spec == Init /\ [][Next]_vars
TypeOK == /\ {documentContent, viewContent, localContent, viewCopy, observedIntent,
              observedCopy, offeredContent} \subseteq {1, 2}
          /\ {pending, wrongIntent} \subseteq BOOLEAN
InstalledBytesMatchIntent == ~wrongIntent
HeldCopyNeverRegresses == [][localContent' >= localContent]_vars
=============================================================================
