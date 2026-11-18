---- MODULE MetadataListingConvergence ----
(***************************************************************************)
(* A client that holds a container metadata document catches up with a    *)
(* peer's edit whose realtime hint was lost.                               *)
(*                                                                         *)
(* The server's metadata version is the version vector of every update it *)
(* holds; the listing reports it with each container row. A write to the  *)
(* metadata document, or any other write that touches the container, such *)
(* as a write into the folder or a move, leaves the row past its lane     *)
(* watermark, so the next delta listing returns it. A hint reaches the    *)
(* client only while it is up and its interest is acknowledged. Each      *)
(* acknowledged connection owes a re-list of the client's lanes from their *)
(* watermarks. A listing whose version the local copy does not cover owes *)
(* the document a read, in memory and durably, before the watermark       *)
(* advances past the row. A read captures the server version and the      *)
(* signal sequence; finishing it settles the debt only if no newer signal *)
(* arrived and it did not resume an earlier pull. A crash loses memory,   *)
(* the socket and in-flight work; the watermark, the durable debt and the *)
(* local copy survive, and the store's first pass reloads the debt.       *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxEdits,
  MaxTouches,
  MaxRestarts,
  MaxDisconnects,
  MaxResumes,
  \* Production owes the read before the lane watermark passes the row.
  OweBeforeWatermark,
  \* Production settles only when no newer signal arrived during the read.
  SettleOnlyIfUnchanged,
  \* Production never settles from a pass that resumed an earlier pull.
  SettleResumedPull,
  \* Production requeues the durable debts on a store's first pass.
  RestoreOnStart,
  \* Production re-lists after every acknowledged connection.
  RelistOnAcknowledge

ASSUME /\ MaxEdits \in Nat /\ MaxTouches \in Nat
       /\ MaxRestarts \in Nat /\ MaxDisconnects \in Nat
       /\ MaxResumes \in Nat
       /\ OweBeforeWatermark \in BOOLEAN
       /\ SettleOnlyIfUnchanged \in BOOLEAN
       /\ SettleResumedPull \in BOOLEAN
       /\ RestoreOnStart \in BOOLEAN
       /\ RelistOnAcknowledge \in BOOLEAN

VARIABLES
  remoteVer,     \* server metadata version
  watermark,     \* last applied publication position
  listedOrder,   \* publication position captured by the listing snapshot
  edits, touches, restarts, disconnects, resumes,
  up,            \* the client process is running
  connected,     \* its interest declaration is acknowledged
  relistDue,     \* an acknowledged connection still owes its re-list
  listing,       \* a re-list is applying this row
  listedVer,     \* the metadata version that re-list read
  listBehind,    \* the local copy did not cover it
  listOwed,      \* that re-list already owed the read
  listPassed,    \* that re-list already advanced the watermark past the row
  owedMem,       \* the in-memory needs-sync queue holds the document
  owedDurable,   \* durable: container_metadata_revalidations holds it
  seq,           \* in-memory signal sequence for the document
  localVer,      \* durable: the metadata version the local copy covers
  reading, readVer, readSeq,
  readResumed    \* the read resumes an earlier pull's pages and bound

vars == <<remoteVer, watermark, edits, touches, restarts, disconnects,
          resumes, up, connected, relistDue, listing, listedOrder, listedVer, listBehind,
          listOwed, listPassed, owedMem, owedDurable, seq, localVer, reading,
          readVer, readSeq, readResumed>>

listingVars == <<listing, listedOrder, listedVer, listBehind, listOwed, listPassed>>
readVars == <<reading, readVer, readSeq, readResumed>>
boundVars == <<edits, touches, restarts, disconnects, resumes>>

MaxSeq == MaxEdits * 2 + MaxTouches + MaxRestarts + MaxDisconnects + 2

TypeOK ==
  /\ remoteVer \in 0..MaxEdits /\ localVer \in 0..MaxEdits
  /\ readVer \in 0..MaxEdits /\ listedVer \in 0..MaxEdits
  /\ seq \in 0..MaxSeq /\ readSeq \in 0..MaxSeq
  /\ watermark \in 0..(MaxEdits + MaxTouches) /\ listedOrder \in 0..(MaxEdits + MaxTouches)
  /\ {up, connected, relistDue, listing, listBehind, listOwed,
      listPassed, owedMem, owedDurable, reading,
      readResumed} \subseteq BOOLEAN

Init ==
  \* Registration or a seeded create: the local copy holds the server's version.
  /\ remoteVer = 0 /\ localVer = 0 /\ watermark = 0 /\ listedOrder = 0
  /\ edits = 0 /\ touches = 0 /\ restarts = 0 /\ disconnects = 0
  /\ resumes = 0
  /\ up = TRUE /\ connected = FALSE /\ relistDue = FALSE
  /\ listing = FALSE /\ listedVer = 0 /\ listBehind = FALSE
  /\ listOwed = FALSE /\ listPassed = FALSE
  /\ owedMem = FALSE /\ owedDurable = FALSE /\ seq = 0
  /\ reading = FALSE /\ readVer = 0 /\ readSeq = 0 /\ readResumed = FALSE

\* A peer device of the same identity edits the metadata document.
PeerEdit ==
  /\ edits < MaxEdits
  /\ remoteVer' = remoteVer + 1 /\ UNCHANGED watermark
  /\ edits' = edits + 1
  /\ IF up /\ connected
       THEN owedMem' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<owedMem, seq>>
  /\ UNCHANGED <<touches, restarts, disconnects, resumes, up, connected,
                 relistDue, listingVars, owedDurable, localVer, readVars>>

\* A write into the folder or a move touches the row, not the metadata.
OtherTouch ==
  /\ touches < MaxTouches
  /\ UNCHANGED watermark /\ touches' = touches + 1
  /\ UNCHANGED <<remoteVer, edits, restarts, disconnects, resumes, up,
                 connected, relistDue, listingVars, owedMem, owedDurable, seq,
                 localVer, readVars>>

Acknowledge ==
  /\ up /\ ~connected
  /\ connected' = TRUE /\ relistDue' = RelistOnAcknowledge
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, listingVars, owedMem,
                 owedDurable, seq, localVer, readVars>>

Disconnect ==
  /\ connected /\ disconnects < MaxDisconnects
  /\ connected' = FALSE /\ disconnects' = disconnects + 1
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, restarts, resumes,
                 up, relistDue, listingVars, owedMem, owedDurable, seq,
                 localVer, readVars>>

\* A delta listing returns the row only while the watermark has not passed it.
BeginListing ==
  /\ up /\ relistDue /\ ~listing
  /\ relistDue' = FALSE
  /\ IF edits + touches > watermark
       THEN /\ listing' = TRUE /\ listedOrder' = edits + touches /\ listedVer' = remoteVer
            /\ listBehind' = (remoteVer > localVer)
            /\ listOwed' = FALSE /\ listPassed' = FALSE
       ELSE UNCHANGED listingVars
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, owedMem,
                 owedDurable, seq, localVer, readVars>>

\* oweContainerMetadataRead: memory first, then container_metadata_revalidations.
OweListedRead ==
  /\ up /\ listing /\ listBehind /\ ~listOwed
  /\ OweBeforeWatermark \/ listPassed
  /\ owedMem' = TRUE /\ seq' = seq + 1 /\ owedDurable' = TRUE
  /\ listOwed' = TRUE
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, relistDue,
                 listing, listedOrder, listedVer, listBehind, listPassed, localVer,
                 readVars>>

\* The page's watermark is saved after its rows are applied.
AdvanceWatermark ==
  /\ up /\ listing /\ ~listPassed
  /\ ~OweBeforeWatermark \/ listOwed \/ ~listBehind
  \* A write after the listing read the row leaves it pending.
  /\ watermark' = listedOrder
  /\ listPassed' = TRUE
  /\ UNCHANGED <<remoteVer, boundVars, up, connected, relistDue, listing,
                 listedOrder, listedVer, listBehind, listOwed, owedMem, owedDurable, seq,
                 localVer, readVars>>

FinishListing ==
  /\ listing /\ listPassed /\ (listOwed \/ ~listBehind)
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listPassed' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, relistDue,
                 listedOrder, listedVer, listBehind, owedMem, owedDurable, seq, localVer,
                 readVars>>

\* syncSingleContainerMetadata snapshots the signal sequence before its read.
BeginRead ==
  /\ up /\ owedMem /\ ~reading
  /\ reading' = TRUE /\ readVer' = remoteVer /\ readSeq' = seq
  /\ readResumed' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, relistDue,
                 listingVars, owedMem, owedDurable, seq, localVer>>

\* The pass resumes a paginated pull begun earlier; its pages stop at that
\* pull's upper bound, any version up to the current one.
ResumeRead ==
  /\ up /\ owedMem /\ ~reading /\ resumes < MaxResumes
  /\ reading' = TRUE /\ readSeq' = seq /\ readResumed' = TRUE
  /\ readVer' \in 0..remoteVer
  /\ resumes' = resumes + 1
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, restarts,
                 disconnects, up, connected, relistDue, listingVars, owedMem,
                 owedDurable, seq, localVer>>

\* The pull imports every update the client lacks as of its snapshot.
FinishRead ==
  /\ up /\ reading
  /\ reading' = FALSE
  /\ localVer' = IF readVer > localVer THEN readVer ELSE localVer
  /\ IF (~SettleOnlyIfUnchanged \/ seq = readSeq)
        /\ (SettleResumedPull \/ ~readResumed)
       THEN owedMem' = FALSE /\ owedDurable' = FALSE
       ELSE UNCHANGED <<owedMem, owedDurable>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, relistDue,
                 listingVars, seq, readVer, readSeq, readResumed>>

Crash ==
  /\ up /\ restarts < MaxRestarts
  /\ up' = FALSE /\ connected' = FALSE /\ relistDue' = FALSE
  /\ restarts' = restarts + 1
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listPassed' = FALSE
  /\ owedMem' = FALSE /\ reading' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, disconnects, resumes,
                 listedOrder, listedVer, listBehind, owedDurable, seq, localVer, readVer,
                 readSeq, readResumed>>

\* restoreOwedContainerMetadataReads on a store's first sync pass.
Start ==
  /\ ~up
  /\ up' = TRUE
  /\ IF RestoreOnStart /\ owedDurable
       THEN owedMem' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<owedMem, seq>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, connected, relistDue,
                 listingVars, owedDurable, localVer, readVars>>

Next ==
  \/ PeerEdit \/ OtherTouch \/ Acknowledge \/ Disconnect
  \/ BeginListing \/ OweListedRead \/ AdvanceWatermark \/ FinishListing
  \/ BeginRead \/ ResumeRead \/ FinishRead \/ Crash \/ Start
  \* Bounded peer, crash and disconnect budgets leave a quiescent end state.
  \/ UNCHANGED vars

Fairness ==
  /\ WF_vars(Acknowledge) /\ WF_vars(Start)
  /\ WF_vars(BeginListing) /\ WF_vars(OweListedRead)
  /\ WF_vars(AdvanceWatermark) /\ WF_vars(FinishListing)
  /\ WF_vars(BeginRead) /\ WF_vars(FinishRead)

Spec == Init /\ [][Next]_vars /\ Fairness

(***************************************************************************)
(* While the client is behind, something still obliges a read: a durable  *)
(* debt, a row the next delta listing will return, or, while the process  *)
(* is up, a queued read, a fresh read that covers the latest version, or a *)
(* re-list that has seen the row behind and not yet owed its read.         *)
(***************************************************************************)
EvidenceRetained ==
  localVer < remoteVer =>
    \/ owedDurable
    \/ edits + touches > watermark
    \/ up /\ owedMem
    \/ up /\ reading /\ readVer = remoteVer /\ ~readResumed
    \/ up /\ listing /\ listBehind /\ ~listOwed

\* Once edits stop, the client holds the server's metadata version.
Converges == <>[](localVer = remoteVer)

====
