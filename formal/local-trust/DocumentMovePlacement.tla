----------------------- MODULE DocumentMovePlacement -----------------------
EXTENDS Naturals, FiniteSets

CONSTANTS ProtectPending, CheckEpoch, CheckRevision, CheckReadPlacement,
          CheckReadMembership, CaptureSettledEpoch, KeepNewestPageLinks,
          ProtectPendingTombstones, TombstonesRequireSignedEvidence,
          CheckPageSignature, CheckTombstoneEvidenceEpoch
ASSUME {ProtectPending, CheckEpoch, CheckRevision, CheckReadPlacement,
        CheckReadMembership, CaptureSettledEpoch, KeepNewestPageLinks,
        ProtectPendingTombstones, TombstonesRequireSignedEvidence,
        CheckPageSignature, CheckTombstoneEvidenceEpoch}
       \subseteq BOOLEAN

Places == {"root", "trash", "other"}
Epochs == 0..5
(* A link-set head: the containers a signed manifest at that epoch links. *)
Heads == [links: SUBSET Places, epoch: Epochs]

(* `signed` holds every link-set head the document's signers committed; a *)
(* served page or tombstone is evidence only when it is one of them.      *)
VARIABLES revision, pending, desired, localLinks, localEpoch, visible,
          remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
          pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering,
          signed
vars == <<revision, pending, desired, localLinks, localEpoch, visible,
          remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
          pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering,
          signed>>

Init ==
  /\ revision = 0 /\ pending = FALSE /\ desired = "root"
  /\ localLinks = {"root"} /\ localEpoch = 0 /\ visible = {"root"}
  /\ remoteLinks = {"root"} /\ remoteEpoch = 0
  /\ recovering = FALSE
  /\ attempt = 0 /\ attemptTarget = "root" /\ phase = "idle"
  /\ pageLinks = {"root"} /\ pageEpoch = 0 /\ pageReady = FALSE
  /\ readLinks = {"root"} /\ readReady = FALSE /\ readSummary = "root"
  /\ signed = {[links |-> {"root"}, epoch |-> 0]}

(* Local placement, links and intent commit atomically. Two distinct intents
   model trash followed by a move elsewhere while the first replay is active. *)
QueueMove ==
  /\ remoteLinks # {}
  /\ revision < 2 /\ revision' = revision + 1 /\ pending' = TRUE
  /\ desired' = IF revision = 0 THEN "trash" ELSE "other"
  /\ localLinks' = {desired'} /\ visible' = {desired'}
  /\ UNCHANGED <<localEpoch, remoteLinks, remoteEpoch, attempt, attemptTarget,
                  phase, pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering>>
  /\ UNCHANGED signed

StartReplay ==
  /\ pending /\ phase = "idle"
  /\ attempt' = revision /\ attemptTarget' = desired
  /\ recovering' = (remoteLinks = {desired})
  /\ phase' = IF recovering' THEN "settle" ELSE "link"
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, pageLinks, pageEpoch, pageReady,
                  readLinks, readReady, readSummary>>
  /\ UNCHANGED signed

Link ==
  /\ phase = "link" /\ phase' = "unlink"
  /\ remoteLinks' = remoteLinks \cup {attemptTarget}
  /\ remoteEpoch' = remoteEpoch + 1
  /\ signed' = signed \cup {[links |-> remoteLinks', epoch |-> remoteEpoch']}
  /\ localLinks' = IF ProtectPending /\ pending THEN localLinks ELSE remoteLinks'
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible, attempt,
                  attemptTarget, pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary, recovering>>

Unlink ==
  /\ phase = "unlink" /\ phase' = "settle"
  /\ remoteLinks' = {attemptTarget} /\ remoteEpoch' = remoteEpoch + 1
  /\ signed' = signed \cup {[links |-> remoteLinks', epoch |-> remoteEpoch']}
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
  /\ UNCHANGED signed

(* The server committed unlink, but its reply never reached this device. *)
LoseResponse ==
  /\ phase = "settle" /\ phase' = "idle"
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, recovering,
                  pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary>>
  /\ UNCHANGED signed

(* Discovery serves a page carrying any head: the current one, an older   *)
(* signed one, or one the server made up. The device keeps a page only    *)
(* when the head's signature verifies, so a made-up page never lands.     *)
CapturePage ==
  /\ ~pageReady /\ pageReady' = TRUE
  /\ \E head \in Heads :
       /\ CheckPageSignature => head \in signed
       /\ pageLinks' = head.links /\ pageEpoch' = head.epoch
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  readLinks, readReady, readSummary, recovering, signed>>

(* All-container discovery merges a previously captured lane with a fresh one. *)
MergeCurrentPage ==
  /\ pageReady
  /\ pageLinks' = IF KeepNewestPageLinks /\ remoteEpoch > pageEpoch
                     THEN remoteLinks ELSE pageLinks \cup remoteLinks
  /\ pageEpoch' = IF remoteEpoch > pageEpoch THEN remoteEpoch ELSE pageEpoch
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase, recovering,
                  pageReady, readLinks, readReady, readSummary>>
  /\ UNCHANGED signed

(* A buffered unlink from an earlier restore must not erase a new trash move. *)
ApplyTombstone ==
  /\ pending
  /\ localLinks' = IF ProtectPendingTombstones THEN localLinks ELSE {}
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase, recovering,
                  pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary>>
  /\ UNCHANGED signed

(* A peer purges the document before any local move. The local link remains
   until a listing tombstone supplies the verified terminal purge proof.
   This makes the guarded apply reachable in the positive configuration. *)
PeerPurge ==
  /\ revision = 0 /\ ~pending /\ phase = "idle" /\ remoteEpoch = 0
  /\ remoteLinks' = {} /\ remoteEpoch' = 1
  /\ signed' = signed \cup {[links |-> {}, epoch |-> 1]}
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  attempt, attemptTarget, phase, recovering, pageLinks, pageEpoch,
                  pageReady, readLinks, readReady, readSummary>>

(* A listing tombstone names a container to remove from the local link rows. *)
(* The listing is an environment input the server controls, so the action    *)
(* is always enabled for any local link. The tombstone carries a head as     *)
(* evidence; the signed-evidence gate admits the removal only when that head *)
(* is signed, no older than the head the device holds, and no longer links   *)
(* the container. Without the gate a dishonest listing deletes a link the    *)
(* signed head still has, and with an older head as evidence it deletes a    *)
(* link a later move restored; StablePlacement and StableView catch both.   *)
ApplyListingTombstone ==
  /\ ~pending
  /\ \E removed \in localLinks, evidence \in Heads :
       /\ IF TombstonesRequireSignedEvidence
            THEN /\ evidence \in signed
                 /\ removed \notin evidence.links
                 /\ CheckTombstoneEvidenceEpoch => evidence.epoch >= localEpoch
            ELSE TRUE
       /\ localLinks' = localLinks \ {removed}
       /\ visible' = localLinks'
       /\ UNCHANGED <<revision, pending, desired, localEpoch, remoteLinks,
                       remoteEpoch, attempt, attemptTarget, phase, recovering,
                       pageLinks, pageEpoch, pageReady, readLinks, readReady, readSummary>>
  /\ UNCHANGED signed

ApplyPage ==
  /\ pageReady /\ pageReady' = FALSE
  /\ LET allowed == (~ProtectPending \/ ~pending)
                    /\ (~CheckEpoch \/ pageEpoch >= localEpoch) IN
       localLinks' = IF allowed THEN pageLinks ELSE localLinks
  /\ UNCHANGED <<revision, pending, desired, localEpoch, visible, remoteLinks,
                  remoteEpoch, attempt, attemptTarget, phase, pageLinks, pageEpoch,
                  readLinks, readReady, readSummary, recovering>>
  /\ UNCHANGED signed

StartRead ==
  /\ ~readReady /\ readReady' = TRUE /\ readLinks' = localLinks /\ readSummary' = desired
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady, recovering>>
  /\ UNCHANGED signed

(* A later summary query may see the new placement after link ids were read. *)
RefreshReadSummary ==
  /\ readReady /\ readSummary' = desired
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch, visible,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady, readLinks, readReady, recovering>>
  /\ UNCHANGED signed

FinishRead ==
  /\ readReady /\ readReady' = FALSE
  /\ visible' = IF (~CheckReadPlacement \/ readSummary = desired)
                    /\ (~CheckReadMembership \/ readLinks = {readSummary})
                 THEN readLinks ELSE visible
  /\ UNCHANGED <<revision, pending, desired, localLinks, localEpoch,
                  remoteLinks, remoteEpoch, attempt, attemptTarget, phase,
                  pageLinks, pageEpoch, pageReady, readLinks, readSummary, recovering>>
  /\ UNCHANGED signed

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
