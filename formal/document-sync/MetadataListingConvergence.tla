---- MODULE MetadataListingConvergence ----
(***************************************************************************)
(* A client that holds a container metadata document catches up with a    *)
(* peer's edit whose realtime hint was lost.                               *)
(*                                                                         *)
(* The server counts the updates it holds for the metadata document; the  *)
(* listing reports that count with each container row. Updates are only   *)
(* ever added, so the count of a document is monotonic. A peer's update   *)
(* may be void: the client judges it and keeps no content from it. A     *)
(* write to the metadata document, or any other write that touches the   *)
(* container, such as a write into the folder or a move, leaves the row   *)
(* past its lane watermark, so the next delta listing returns it. A hint  *)
(* reaches the client only while it is up and its interest is            *)
(* acknowledged. Each acknowledged connection owes a re-list of the       *)
(* client's lanes from their watermarks. A completed pull leaves a        *)
(* processed cursor that counts every update through its bound, void ones *)
(* included; the client may stop sending it (a changed judge, a key       *)
(* conflict, a frontier that no longer covers it). A listing whose count  *)
(* the cursor does not cover owes the document a read, in memory and      *)
(* durably at the listed count, before the watermark advances past the    *)
(* row. A read captures the server count and the signal sequence;         *)
(* finishing it settles the debt only if no newer signal arrived, it did  *)
(* not resume an earlier pull, and its cursor covers the owed count. A    *)
(* crash loses memory, the socket and in-flight work; the watermark, the  *)
(* durable debt, the cursor and the local copy survive, and the store's   *)
(* first pass reloads the debt.                                           *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS MaxEdits,
  \* Peer updates the client voids: judged, counted, never imported.
  MaxVoidEdits,
  MaxTouches,
  MaxRestarts,
  MaxDisconnects,
  MaxResumes,
  \* Times the client stops sending its processed cursor.
  MaxWithholds,
  \* Production covers a listed count by the processed cursor's count, not
  \* by the updates whose content the local copy holds.
  CoverByProcessedCount,
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

ASSUME /\ MaxEdits \in Nat /\ MaxVoidEdits \in Nat /\ MaxTouches \in Nat
       /\ MaxRestarts \in Nat /\ MaxDisconnects \in Nat
       /\ MaxResumes \in Nat /\ MaxWithholds \in Nat
       /\ CoverByProcessedCount \in BOOLEAN
       /\ OweBeforeWatermark \in BOOLEAN
       /\ SettleOnlyIfUnchanged \in BOOLEAN
       /\ SettleResumedPull \in BOOLEAN
       /\ RestoreOnStart \in BOOLEAN
       /\ RelistOnAcknowledge \in BOOLEAN

VARIABLES
  remoteVer,     \* how many updates the server holds for the document
  voids,         \* the positions of the void updates among them
  watermark,     \* last applied publication position
  listedOrder,   \* publication position captured by the listing snapshot
  edits, voidEdits, touches, restarts, disconnects, resumes, withholds,
  up,            \* the client process is running
  connected,     \* its interest declaration is acknowledged
  relistDue,     \* an acknowledged connection still owes its re-list
  listing,       \* a re-list is applying this row
  listedVer,     \* the update count that re-list read
  listBehind,    \* the client's coverage did not reach it
  listOwed,      \* that re-list already owed the read
  listPassed,    \* that re-list already advanced the watermark past the row
  owedMem,       \* the in-memory needs-sync queue holds the document
  owedDurable,   \* durable: container_metadata_revalidations holds it
  owedVer,       \* durable: the update count that debt advertises
  seq,           \* in-memory signal sequence for the document
  localVer,      \* durable: how many updates the client has processed
  cursorVer,     \* durable: the count the sendable processed cursor covers
  reading, readVer, readSeq,
  readResumed    \* the read resumes an earlier pull's pages and bound

vars == <<remoteVer, voids, watermark, edits, voidEdits, touches, restarts,
          disconnects, resumes, withholds, up, connected, relistDue, listing,
          listedOrder, listedVer, listBehind, listOwed, listPassed, owedMem,
          owedDurable, owedVer, seq, localVer, cursorVer, reading, readVer,
          readSeq, readResumed>>

listingVars == <<listing, listedOrder, listedVer, listBehind, listOwed, listPassed>>
readVars == <<reading, readVer, readSeq, readResumed>>
boundVars == <<edits, voidEdits, touches, restarts, disconnects, resumes,
               withholds>>
\* State the client keeps across a crash, apart from the listing's.
clientVars == <<owedVer, localVer, cursorVer>>

MaxUpdates == MaxEdits + MaxVoidEdits
MaxOrder == MaxUpdates + MaxTouches
MaxSeq == MaxUpdates * 2 + MaxTouches + MaxRestarts + MaxDisconnects + 2

\* How many of the first `n` updates the local copy holds the content of.
ContentCount(n) == n - Cardinality({v \in voids : v <= n})

\* The count a listing must not exceed for the client to owe no read.
Coverage ==
  IF CoverByProcessedCount THEN cursorVer ELSE ContentCount(localVer)

TypeOK ==
  /\ remoteVer \in 0..MaxUpdates /\ voids \subseteq 1..MaxUpdates
  /\ localVer \in 0..MaxUpdates /\ cursorVer \in 0..MaxUpdates
  /\ owedVer \in 0..MaxUpdates
  /\ readVer \in 0..MaxUpdates /\ listedVer \in 0..MaxUpdates
  /\ seq \in 0..MaxSeq /\ readSeq \in 0..MaxSeq
  /\ watermark \in 0..MaxOrder /\ listedOrder \in 0..MaxOrder
  /\ {up, connected, relistDue, listing, listBehind, listOwed,
      listPassed, owedMem, owedDurable, reading,
      readResumed} \subseteq BOOLEAN

Init ==
  \* Registration or a create: the client holds every update the server does.
  /\ remoteVer = 0 /\ voids = {} /\ localVer = 0 /\ cursorVer = 0
  /\ watermark = 0 /\ listedOrder = 0
  /\ edits = 0 /\ voidEdits = 0 /\ touches = 0 /\ restarts = 0
  /\ disconnects = 0 /\ resumes = 0 /\ withholds = 0
  /\ up = TRUE /\ connected = FALSE /\ relistDue = FALSE
  /\ listing = FALSE /\ listedVer = 0 /\ listBehind = FALSE
  /\ listOwed = FALSE /\ listPassed = FALSE
  /\ owedMem = FALSE /\ owedDurable = FALSE /\ owedVer = 0 /\ seq = 0
  /\ reading = FALSE /\ readVer = 0 /\ readSeq = 0 /\ readResumed = FALSE

\* The server stores a peer's update and hints connected, subscribed clients.
StoreUpdate ==
  /\ remoteVer' = remoteVer + 1 /\ UNCHANGED watermark
  /\ IF up /\ connected
       THEN owedMem' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<owedMem, seq>>
  /\ UNCHANGED <<touches, restarts, disconnects, resumes, withholds, up,
                 connected, relistDue, listingVars, owedDurable, clientVars,
                 readVars>>

\* A peer device of the same identity edits the metadata document.
PeerEdit ==
  /\ edits < MaxEdits
  /\ edits' = edits + 1
  /\ StoreUpdate /\ UNCHANGED <<voids, voidEdits>>

\* A peer's update the client will void, such as one whose declared span
\* claims more than it holds: the client judges it and imports nothing.
PeerVoidEdit ==
  /\ voidEdits < MaxVoidEdits
  /\ voidEdits' = voidEdits + 1 /\ voids' = voids \cup {remoteVer + 1}
  /\ StoreUpdate /\ UNCHANGED edits

\* A write into the folder or a move touches the row, not the metadata.
OtherTouch ==
  /\ touches < MaxTouches
  /\ UNCHANGED watermark /\ touches' = touches + 1
  /\ UNCHANGED <<remoteVer, voids, edits, voidEdits, restarts, disconnects,
                 resumes, withholds, up, connected, relistDue, listingVars,
                 owedMem, owedDurable, seq, clientVars, readVars>>

\* The client stops sending its processed cursor: a new judge, or a frontier
\* that no longer covers the cursor's version. What it processed is
\* unchanged; only the count it can show is lost.
WithholdCursor ==
  /\ cursorVer > 0 /\ withholds < MaxWithholds
  /\ cursorVer' = 0 /\ withholds' = withholds + 1
  /\ UNCHANGED <<remoteVer, voids, watermark, edits, voidEdits, touches,
                 restarts, disconnects, resumes, up, connected, relistDue,
                 listingVars, owedMem, owedDurable, owedVer, seq, localVer,
                 readVars>>

Acknowledge ==
  /\ up /\ ~connected
  /\ connected' = TRUE /\ relistDue' = RelistOnAcknowledge
  /\ UNCHANGED <<remoteVer, voids, watermark, boundVars, up, listingVars,
                 owedMem, owedDurable, seq, clientVars, readVars>>

Disconnect ==
  /\ connected /\ disconnects < MaxDisconnects
  /\ connected' = FALSE /\ disconnects' = disconnects + 1
  /\ UNCHANGED <<remoteVer, voids, watermark, edits, voidEdits, touches,
                 restarts, resumes, withholds, up, relistDue, listingVars,
                 owedMem, owedDurable, seq, clientVars, readVars>>

\* A delta listing returns the row only while the watermark has not passed it.
BeginListing ==
  /\ up /\ relistDue /\ ~listing
  /\ relistDue' = FALSE
  /\ IF remoteVer + touches > watermark
       THEN /\ listing' = TRUE /\ listedOrder' = remoteVer + touches
            /\ listedVer' = remoteVer
            /\ listBehind' = (remoteVer > Coverage)
            /\ listOwed' = FALSE /\ listPassed' = FALSE
       ELSE UNCHANGED listingVars
  /\ UNCHANGED <<remoteVer, voids, watermark, boundVars, up, connected,
                 owedMem, owedDurable, seq, clientVars, readVars>>

\* oweContainerMetadataRead: memory first, then container_metadata_revalidations,
\* whose upsert keeps the larger advertised count.
OweListedRead ==
  /\ up /\ listing /\ listBehind /\ ~listOwed
  /\ OweBeforeWatermark \/ listPassed
  /\ owedMem' = TRUE /\ seq' = seq + 1 /\ owedDurable' = TRUE
  /\ owedVer' = IF listedVer > owedVer THEN listedVer ELSE owedVer
  /\ listOwed' = TRUE
  /\ UNCHANGED <<remoteVer, voids, watermark, boundVars, up, connected,
                 relistDue, listing, listedOrder, listedVer, listBehind,
                 listPassed, localVer, cursorVer, readVars>>

\* The page's watermark is saved after its rows are applied.
AdvanceWatermark ==
  /\ up /\ listing /\ ~listPassed
  /\ ~OweBeforeWatermark \/ listOwed \/ ~listBehind
  \* A write after the listing read the row leaves it pending.
  /\ watermark' = listedOrder
  /\ listPassed' = TRUE
  /\ UNCHANGED <<remoteVer, voids, boundVars, up, connected, relistDue,
                 listing, listedOrder, listedVer, listBehind, listOwed, owedMem,
                 owedDurable, seq, clientVars, readVars>>

FinishListing ==
  /\ listing /\ listPassed /\ (listOwed \/ ~listBehind)
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listPassed' = FALSE
  /\ UNCHANGED <<remoteVer, voids, watermark, boundVars, up, connected,
                 relistDue, listedOrder, listedVer, listBehind, owedMem,
                 owedDurable, seq, clientVars, readVars>>

\* syncSingleContainerMetadata snapshots the signal sequence before its read.
BeginRead ==
  /\ up /\ owedMem /\ ~reading
  /\ reading' = TRUE /\ readVer' = remoteVer /\ readSeq' = seq
  /\ readResumed' = FALSE
  /\ UNCHANGED <<remoteVer, voids, watermark, boundVars, up, connected,
                 relistDue, listingVars, owedMem, owedDurable, seq, clientVars>>

\* The pass resumes a paginated pull begun earlier; its pages stop at that
\* pull's upper bound, any count up to the current one.
ResumeRead ==
  /\ up /\ owedMem /\ ~reading /\ resumes < MaxResumes
  /\ reading' = TRUE /\ readSeq' = seq /\ readResumed' = TRUE
  /\ readVer' \in 0..remoteVer
  /\ resumes' = resumes + 1
  /\ UNCHANGED <<remoteVer, voids, watermark, edits, voidEdits, touches,
                 restarts, disconnects, withholds, up, connected, relistDue,
                 listingVars, owedMem, owedDurable, seq, clientVars>>

\* The pull judges every update the client lacks as of its snapshot, voiding
\* some, and its last page records the processed cursor at its bound. The
\* debt is settled after the save, against the cursor the save left.
FinishRead ==
  /\ up /\ reading
  /\ reading' = FALSE
  /\ localVer' = IF readVer > localVer THEN readVer ELSE localVer
  /\ cursorVer' = IF readVer > cursorVer THEN readVer ELSE cursorVer
  /\ LET processed == IF readVer > localVer THEN readVer ELSE localVer
          covered == IF CoverByProcessedCount
                       THEN IF readVer > cursorVer THEN readVer ELSE cursorVer
                       ELSE ContentCount(processed)
     IN IF (~SettleOnlyIfUnchanged \/ seq = readSeq)
           /\ (SettleResumedPull \/ ~readResumed)
           /\ (~owedDurable \/ covered >= owedVer)
          THEN owedMem' = FALSE /\ owedDurable' = FALSE /\ owedVer' = 0
          ELSE UNCHANGED <<owedMem, owedDurable, owedVer>>
  /\ UNCHANGED <<remoteVer, voids, watermark, boundVars, up, connected,
                 relistDue, listingVars, seq, readVer, readSeq, readResumed>>

Crash ==
  /\ up /\ restarts < MaxRestarts
  /\ up' = FALSE /\ connected' = FALSE /\ relistDue' = FALSE
  /\ restarts' = restarts + 1
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listPassed' = FALSE
  /\ owedMem' = FALSE /\ reading' = FALSE
  /\ UNCHANGED <<remoteVer, voids, watermark, edits, voidEdits, touches,
                 disconnects, resumes, withholds, listedOrder, listedVer,
                 listBehind, owedDurable, seq, clientVars, readVer, readSeq,
                 readResumed>>

\* restoreOwedContainerMetadataReads on a store's first sync pass.
Start ==
  /\ ~up
  /\ up' = TRUE
  /\ IF RestoreOnStart /\ owedDurable
       THEN owedMem' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<owedMem, seq>>
  /\ UNCHANGED <<remoteVer, voids, watermark, boundVars, connected,
                 relistDue, listingVars, owedDurable, clientVars, readVars>>

Next ==
  \/ PeerEdit \/ PeerVoidEdit \/ OtherTouch \/ WithholdCursor
  \/ Acknowledge \/ Disconnect
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

\* The cursor never counts an update the client has not processed.
CursorWithinProcessed == cursorVer <= localVer

(***************************************************************************)
(* While the client is behind, something still obliges a read: a durable  *)
(* debt, a row the next delta listing will return, or, while the process  *)
(* is up, a queued read, a fresh read that covers the latest version, or a *)
(* re-list that has seen the row behind and not yet owed its read.         *)
(***************************************************************************)
EvidenceRetained ==
  localVer < remoteVer =>
    \/ owedDurable
    \/ remoteVer + touches > watermark
    \/ up /\ owedMem
    \/ up /\ reading /\ readVer = remoteVer /\ ~readResumed
    \/ up /\ listing /\ listBehind /\ ~listOwed

\* Once edits stop, the client has processed every update the server holds.
Converges == <>[](localVer = remoteVer)

\* Every owed read is eventually settled: a void update must not leave a
\* debt that no read can pay.
DebtsSettle == <>[](~owedMem /\ ~owedDurable)

====
