--------------------- MODULE AttachmentContentIdentity ---------------------
EXTENDS Naturals
CONSTANTS CheckContentDigest, CheckLiveIntent, CompareStoredCopy,
          RefreshRefusedCopy, CheckStoredIntent
ASSUME {CheckContentDigest, CheckLiveIntent, CompareStoredCopy,
        RefreshRefusedCopy, CheckStoredIntent} \subseteq BOOLEAN
VARIABLES documentContent, viewContent, localContent, localCopy, viewCopy, pending,
          observedIntent, observedCopy, offeredContent, wrongIntent
vars == <<documentContent, viewContent, localContent, localCopy, viewCopy, pending,
          observedIntent, observedCopy, offeredContent, wrongIntent>>
Init ==
  /\ documentContent = 1 /\ viewContent = 1 /\ localContent = 1 /\ localCopy = 1 /\ viewCopy = 1
  /\ pending = FALSE /\ observedIntent = 1 /\ observedCopy = 1
  /\ offeredContent = 1 /\ wrongIntent = FALSE
BeginHydration(content) ==
  /\ ~pending
  /\ ~CheckContentDigest \/ content = viewContent
  /\ pending' = TRUE /\ observedIntent' = viewContent
  /\ observedCopy' = viewCopy /\ offeredContent' = content
  /\ UNCHANGED <<documentContent, viewContent, localContent, localCopy, viewCopy, wrongIntent>>
(* A competing facade installs a newer authenticated document and its bytes. *)
OtherFacadeInstalls ==
  /\ documentContent = 1 /\ documentContent' = 2 /\ localContent' = 2
  /\ localCopy' = 2
  /\ UNCHANGED <<viewContent, viewCopy, pending, observedIntent, observedCopy,
                  offeredContent, wrongIntent>>
OtherFacadeInstallsSameIntent ==
  /\ localCopy = 1 /\ localCopy' = 2
  /\ UNCHANGED <<documentContent, viewContent, localContent, viewCopy, pending,
                  observedIntent, observedCopy, offeredContent, wrongIntent>>
(* The active view can advance before its new attachment bytes are available. *)
AdvanceView ==
  /\ viewContent = 1 /\ viewContent' = 2
  /\ UNCHANGED <<documentContent, localContent, localCopy, viewCopy, pending, observedIntent, observedCopy,
                  offeredContent, wrongIntent>>
PersistView ==
  /\ viewContent = 2 /\ documentContent = 1 /\ documentContent' = 2
  /\ UNCHANGED <<viewContent, localContent, localCopy, viewCopy, pending,
                  observedIntent, observedCopy, offeredContent, wrongIntent>>
CommitHydration ==
  /\ pending
  /\ ~CheckLiveIntent \/ observedIntent = viewContent
  /\ ~CheckStoredIntent \/ observedIntent = documentContent
  /\ ~CompareStoredCopy \/ observedCopy = localCopy
  /\ localContent' = offeredContent /\ localCopy' = 3 /\ viewCopy' = 3
  /\ pending' = FALSE
  /\ wrongIntent' = (wrongIntent \/ offeredContent # viewContent)
  /\ UNCHANGED <<documentContent, viewContent, observedIntent,
                  observedCopy, offeredContent>>
Cancel ==
  /\ pending /\ pending' = FALSE
  /\ viewCopy' = IF RefreshRefusedCopy /\ observedIntent = viewContent
                   THEN localCopy ELSE viewCopy
  /\ UNCHANGED <<documentContent, viewContent, localContent, localCopy, observedIntent,
                  observedCopy, offeredContent, wrongIntent>>
Next == (\E content \in {1, 2} : BeginHydration(content))
        \/ OtherFacadeInstalls \/ OtherFacadeInstallsSameIntent \/ AdvanceView
        \/ PersistView \/ CommitHydration \/ Cancel
Spec == Init /\ [][Next]_vars
TypeOK == /\ {documentContent, viewContent, localContent, observedIntent,
              offeredContent} \subseteq {1, 2}
          /\ {localCopy, viewCopy, observedCopy} \subseteq {1, 2, 3}
          /\ {pending, wrongIntent} \subseteq BOOLEAN
InstalledBytesMatchIntent == ~wrongIntent
HeldCopyNeverRegresses == [][localContent' >= localContent]_vars
RefusedCopyReloaded == [][(pending /\ ~pending' /\ observedIntent = viewContent
    /\ observedCopy # localCopy /\ localCopy' = localCopy)
    => viewCopy' = localCopy]_vars
StaleCopyCannotReplaceWinner == [][(pending /\ observedCopy # localCopy
    /\ localCopy = 2) => localCopy' # 3]_vars
=============================================================================
