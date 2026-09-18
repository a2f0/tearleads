----------------------- MODULE DocumentMovePlacement -----------------------
EXTENDS Naturals, FiniteSets

CONSTANTS ProtectPending, CheckEpoch, CheckRevision, CheckReadPlacement
ASSUME {ProtectPending, CheckEpoch, CheckRevision, CheckReadPlacement}
       \subseteq BOOLEAN

VARIABLES revision, pending, desired, localLinks, localEpoch, visible,
          remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
          pageLinks, pageEpoch, pageReady, readLinks, readReady
vars == <<revision, pending, desired, localLinks, localEpoch, visible,
          remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
          pageLinks, pageEpoch, pageReady, readLinks, readReady>>

Init ==
  /\ revision = 0 /\ pending = FALSE /\ desired = "root"
  /\ localLinks = {"root"} /\ localEpoch = 0 /\ visible = {"root"}
  /\ remoteLinks = {"root"} /\ remoteEpoch = 0
  /\ attempt = 0 /\ attemptTarget = "root" /\ phase = "idle"
  /\ pageLinks = {"root"} /\ pageEpoch = 0 /\ pageReady = FALSE
  /\ readLinks = {"root"} /\ readReady = FALSE

(* Local placement, links and intent commit atomically. Two distinct intents
   model trash followed by a move elsewhere while the first replay is active. *)
QueueMove ==
  /\ revision < 2 /\ revision' = revision + 1 /\ pending' = TRUE
  /\ desired' = IF revision = 0 THEN "trash" ELSE "other"
  /\ localLinks' = {desired'} /\ visible' = {desired'}
  /\ UNCHANGED <<localEpoch, remoteLinks, remoteEpoch, attempt, attemptTarget,
                  phase, pageLinks, pageEpoch, pageReady, readLinks, readReady>>

StartReplay ==
  /\ pending /\ phase = "idle"
  /\ attempt' = revision /\ attemptTarget' = desired /\ phase' = "link"
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, pageLinks, pageEpoch, pageReady,
                  readLinks, readReady>>

Link ==
  /\ phase = "link" /\ phase' = "unlink"
  /\ remoteLinks' = remoteLinks \cup {attemptTarget}
  /\ remoteEpoch' = remoteEpoch + 1
  /\ localLinks' = IF ProtectPending /\ pending THEN localLinks ELSE remoteLinks'
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible, attempt,
                  attemptTarget, pageLinks, pageEpoch, pageReady, readLinks, readReady>>

Unlink ==
  /\ phase = "unlink" /\ phase' = "settle"
  /\ remoteLinks' = {attemptTarget} /\ remoteEpoch' = remoteEpoch + 1
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  attempt, attemptTarget, pageLinks, pageEpoch, pageReady,
                  readLinks, readReady>>

Settle ==
  /\ phase = "settle" /\ phase' = "idle"
  /\ LET current == ~CheckRevision \/ attempt = revision IN
       /\ pending' = IF current THEN FALSE ELSE pending
       /\ localLinks' = IF current THEN remoteLinks ELSE localLinks
       /\ localEpoch' = IF current THEN remoteEpoch ELSE localEpoch
  /\ UNCHANGED <<revision, desired, visible, remoteLinks, remoteEpoch, attempt,
                  attemptTarget, pageLinks, pageEpoch, pageReady, readLinks, readReady>>

CapturePage ==
  /\ ~pageReady /\ pageReady' = TRUE
  /\ pageLinks' = remoteLinks /\ pageEpoch' = remoteEpoch
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  readLinks, readReady>>

ApplyPage ==
  /\ pageReady /\ pageReady' = FALSE
  /\ LET allowed == (~ProtectPending \/ ~pending)
                    /\ (~CheckEpoch \/ pageEpoch >= localEpoch) IN
       localLinks' = IF allowed THEN pageLinks ELSE localLinks
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible, remoteLinks,
                  remoteEpoch, attempt, attemptTarget, phase, pageLinks, pageEpoch,
                  readLinks, readReady>>

StartRead ==
  /\ ~readReady /\ readReady' = TRUE /\ readLinks' = localLinks
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady>>

FinishRead ==
  /\ readReady /\ readReady' = FALSE
  /\ visible' = IF ~CheckReadPlacement \/ readLinks = localLinks
                 THEN readLinks ELSE visible
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady, readLinks>>

TypeOK ==
  /\ revision \in 0..2 /\ attempt \in 0..2
  /\ {desired, attemptTarget} \subseteq {"root", "trash", "other"}
  /\ {localLinks, remoteLinks, visible, pageLinks, readLinks}
       \subseteq SUBSET {"root", "trash", "other"}
  /\ {localEpoch, remoteEpoch, pageEpoch} \subseteq 0..4
  /\ {pending, pageReady, readReady} \subseteq BOOLEAN
  /\ phase \in {"idle", "link", "unlink", "settle"}
StablePlacement == localLinks = {desired}
StableView == visible = {desired}

Next == QueueMove \/ StartReplay \/ Link \/ Unlink \/ Settle
        \/ CapturePage \/ ApplyPage \/ StartRead \/ FinishRead
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
=============================================================================
