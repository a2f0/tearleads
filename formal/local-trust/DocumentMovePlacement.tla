----------------------- MODULE DocumentMovePlacement -----------------------
EXTENDS Naturals, FiniteSets

CONSTANTS ProtectPending, CheckEpoch, CheckRevision, CheckReadPlacement,
          CheckReadMembership, CaptureSettledEpoch, KeepNewestPageLinks,
          ProtectPendingTombstones, TombstonesRequireSignedEvidence
ASSUME {ProtectPending, CheckEpoch, CheckRevision, CheckReadPlacement,
        CheckReadMembership, CaptureSettledEpoch, KeepNewestPageLinks,
        ProtectPendingTombstones, TombstonesRequireSignedEvidence}
       \subseteq BOOLEAN

VARIABLES revision, pending, desired, localLinks, localEpoch, visible,
          remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
          pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering
vars == <<revision, pending, desired, localLinks, localEpoch, visible,
          remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
          pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering>>

Init ==
  /\ revision = 0 /\ pending = FALSE /\ desired = "root"
  /\ localLinks = {"root"} /\ localEpoch = 0 /\ visible = {"root"}
  /\ remoteLinks = {"root"} /\ remoteEpoch = 0
  /\ recovering = FALSE
  /\ attempt = 0 /\ attemptTarget = "root" /\ phase = "idle"
  /\ pageLinks = {"root"} /\ pageEpoch = 0 /\ pageReady = FALSE
  /\ readLinks = {"root"} /\ readReady = FALSE /\ readSummary = "root"

(* Local placement, links and intent commit atomically. Two distinct intents
   model trash followed by a move elsewhere while the first replay is active. *)
QueueMove ==
  /\ remoteLinks # {}
  /\ revision < 2 /\ revision' = revision + 1 /\ pending' = TRUE
  /\ desired' = IF revision = 0 THEN "trash" ELSE "other"
  /\ localLinks' = {desired'} /\ visible' = {desired'}
  /\ UNCHANGED <<localEpoch, remoteLinks, remoteEpoch, attempt, attemptTarget,
                  phase, pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering>>

StartReplay ==
  /\ pending /\ phase = "idle"
  /\ attempt' = revision /\ attemptTarget' = desired
  /\ recovering' = (remoteLinks = {desired})
  /\ phase' = IF recovering' THEN "settle" ELSE "link"
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, pageLinks, pageEpoch, pageReady,
                  readLinks, readReady, readSummary>>

Link ==
  /\ phase = "link" /\ phase' = "unlink"
  /\ remoteLinks' = remoteLinks \cup {attemptTarget}
  /\ remoteEpoch' = remoteEpoch + 1
  /\ localLinks' = IF ProtectPending /\ pending THEN localLinks ELSE remoteLinks'
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible, attempt,
                  attemptTarget, pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering>>

Unlink ==
  /\ phase = "unlink" /\ phase' = "settle"
  /\ remoteLinks' = {attemptTarget} /\ remoteEpoch' = remoteEpoch + 1
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  attempt, attemptTarget, pageLinks, pageEpoch, pageReady,
                  readLinks, readReady, readSummary, recovering>>

Settle ==
  /\ phase = "settle" /\ phase' = "idle"
  /\ LET current == ~CheckRevision \/ attempt = revision IN
       /\ pending' = IF current THEN FALSE ELSE pending
       /\ localLinks' = IF current THEN remoteLinks ELSE localLinks
       /\ localEpoch' = IF current /\ (CaptureSettledEpoch \/ ~recovering)
                         THEN remoteEpoch ELSE localEpoch
  /\ UNCHANGED <<revision, desired, visible, remoteLinks, remoteEpoch, attempt,
                  attemptTarget, pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering>>

(* The server committed unlink, but its reply never reached this device. *)
LoseResponse ==
  /\ phase = "settle" /\ phase' = "idle"
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, recovering,
                  pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary>>

CapturePage ==
  /\ ~pageReady /\ pageReady' = TRUE
  /\ pageLinks' = remoteLinks /\ pageEpoch' = remoteEpoch
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  readLinks, readReady, readSummary, recovering>>

(* All-container discovery merges a previously captured lane with a fresh one. *)
MergeCurrentPage ==
  /\ pageReady
  /\ pageLinks' = IF KeepNewestPageLinks /\ remoteEpoch > pageEpoch
                     THEN remoteLinks ELSE pageLinks \cup remoteLinks
  /\ pageEpoch' = IF remoteEpoch > pageEpoch THEN remoteEpoch ELSE pageEpoch
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase, recovering,
                  pageReady, readLinks, readReady, readSummary>>

(* A buffered unlink from an earlier restore must not erase a new trash move. *)
ApplyTombstone ==
  /\ pending
  /\ localLinks' = IF ProtectPendingTombstones THEN localLinks ELSE {}
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase, recovering,
                  pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary>>

(* A peer purges the document before any local move. The local link remains
   until a listing tombstone supplies the verified terminal purge proof.
   This makes the guarded apply reachable in the positive configuration. *)
PeerPurge ==
  /\ revision = 0 /\ ~pending /\ phase = "idle" /\ remoteEpoch = 0
  /\ remoteLinks' = {} /\ remoteEpoch' = 1
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  attempt, attemptTarget, phase, recovering, pageLinks, pageEpoch,
                  pageReady, readLinks, readReady, readSummary>>

(* A listing tombstone names a container to remove from the local link rows. *)
(* The listing is an environment input the server controls, so the action    *)
(* is always enabled for any local link; the signed-evidence gate admits the *)
(* removal only when the committed (signed) link set no longer contains that *)
(* container. Without the gate a dishonest listing deletes a link the signed *)
(* head still has, which StablePlacement and StableView catch directly.      *)
ApplyListingTombstone ==
  /\ ~pending
  /\ \E removed \in localLinks :
       /\ IF TombstonesRequireSignedEvidence
            THEN removed \notin remoteLinks
            ELSE TRUE
       /\ localLinks' = localLinks \ {removed}
       /\ visible' = localLinks'
       /\ UNCHANGED <<revision, pending, desired, localEpoch, remoteLinks,
                       remoteEpoch, attempt, attemptTarget, phase, recovering,
                       pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary>>

ApplyPage ==
  /\ pageReady /\ pageReady' = FALSE
  /\ LET allowed == (~ProtectPending \/ ~pending)
                    /\ (~CheckEpoch \/ pageEpoch >= localEpoch) IN
       localLinks' = IF allowed THEN pageLinks ELSE localLinks
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible, remoteLinks,
                  remoteEpoch, attempt, attemptTarget, phase, pageLinks, pageEpoch,
                  readLinks, readReady, readSummary, recovering>>

StartRead ==
  /\ ~readReady /\ readReady' = TRUE /\ readLinks' = localLinks /\ readSummary' = desired
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady, recovering>>

(* A later summary query may see the new placement after link ids were read. *)
RefreshReadSummary ==
  /\ readReady /\ readSummary' = desired
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady, readLinks, readReady, recovering>>

FinishRead ==
  /\ readReady /\ readReady' = FALSE
  /\ visible' = IF (~CheckReadPlacement \/ readSummary = desired)
                    /\ (~CheckReadMembership \/ readLinks = {readSummary})
                 THEN readLinks ELSE visible
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady, readLinks, readSummary, recovering>>

TypeOK ==
  /\ revision \in 0..2 /\ attempt \in 0..2
  /\ {desired, attemptTarget, readSummary} \subseteq {"root", "trash", "other"}
  /\ {localLinks, remoteLinks, visible, pageLinks, readLinks}
       \subseteq SUBSET {"root", "trash", "other"}
  /\ {localEpoch, remoteEpoch, pageEpoch} \subseteq 0..5
  /\ {pending, pageReady, readReady, recovering} \subseteq BOOLEAN
  /\ phase \in {"idle", "link", "unlink", "settle"}
StablePlacement == localLinks = {desired} \/ (~pending /\ remoteLinks = {} /\ localLinks = {})
StableView == visible = {desired} \/ (~pending /\ remoteLinks = {} /\ visible = {})

Next == PeerPurge \/ QueueMove \/ StartReplay \/ Link \/ Unlink \/ Settle \/ LoseResponse
        \/ CapturePage \/ MergeCurrentPage \/ ApplyPage \/ ApplyTombstone \/ ApplyListingTombstone
        \/ StartRead \/ RefreshReadSummary \/ FinishRead
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
=============================================================================
