---- MODULE DocumentListingConvergence ----
(***************************************************************************)
(* A client that holds an ordinary document catches up with a peer's edit *)
(* without probing the document on every restart and reconnect.           *)
(*                                                                         *)
(* The server counts the updates it holds for the document; a container   *)
(* lane's listing reports that count with the document's row. Updates are *)
(* only ever added, so the count is monotonic. A write to the document,   *)
(* or any other write that touches it, such as an attachment bind or a    *)
(* move, leaves the row past its lane watermark, so the next delta        *)
(* listing returns it. A hint reaches the client only while it is up and  *)
(* its interest is acknowledged. A registered document store takes the    *)
(* hint; for a document with no store yet, the client remembers that it   *)
(* was hinted until the store opens. Each acknowledged connection owes a  *)
(* re-list of the client's lanes from their watermarks. A completed pull  *)
(* leaves a processed cursor that counts every update through its bound.  *)
(* A listing whose count the cursor does not cover owes the document a    *)
(* read, durably at the listed count, before the watermark advances past  *)
(* the row; a registered store is asked to read at once, and a store that *)
(* opens later finds the debt. A read captures the server count, or an    *)
(* older one when a lagging replica serves it, and the signal sequence;   *)
(* finishing it clears the signal only if no newer one arrived, and       *)
(* settles the debt only if its cursor also covers the owed count. A      *)
(* crash loses memory, the socket, the open store and in-flight work; the *)
(* watermark, the durable debt, the cursor and the local copy survive.    *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxEdits,
  MaxTouches,
  MaxRestarts,
  MaxDisconnects,
  \* Reads a replica that lags the listing may serve.
  MaxLaggingReads,
  \* Production owes the read before the lane watermark passes the row.
  OweBeforeWatermark,
  \* Production settles a debt only when the read's cursor covers its count.
  SettleOnlyIfCovered,
  \* Production clears a signal only when no newer one arrived meanwhile.
  SettleOnlyIfUnchanged,
  \* Production remembers a hint that names a document with no store yet.
  RememberClosedStoreHint,
  \* Production reads the durable debt when the document's store opens.
  RestoreOnOpen,
  \* Production re-lists after every acknowledged connection.
  RelistOnAcknowledge

ASSUME /\ MaxEdits \in Nat /\ MaxTouches \in Nat /\ MaxRestarts \in Nat
       /\ MaxDisconnects \in Nat /\ MaxLaggingReads \in Nat
       /\ OweBeforeWatermark \in BOOLEAN
       /\ SettleOnlyIfCovered \in BOOLEAN
       /\ SettleOnlyIfUnchanged \in BOOLEAN
       /\ RememberClosedStoreHint \in BOOLEAN
       /\ RestoreOnOpen \in BOOLEAN
       /\ RelistOnAcknowledge \in BOOLEAN

VARIABLES
  remoteVer,     \* how many updates the server holds for the document
  watermark,     \* last applied publication position of the lane
  listedOrder,   \* publication position captured by the listing snapshot
  edits, touches, restarts, disconnects, laggingReads,
  up,            \* the client process is running
  connected,     \* its interest declaration is acknowledged
  open,          \* the document's store is registered in this process
  missedHint,    \* a hint named the document while no store was registered
  hintedVer,     \* the newest count a hint delivered to this process named
  relistDue,     \* an acknowledged connection still owes its re-list
  listing,       \* a re-list is applying this row
  listedVer,     \* the update count that re-list read
  listBehind,    \* the client's cursor did not cover it
  listOwed,      \* that re-list already owed the read
  listPassed,    \* that re-list already advanced the watermark past the row
  probeDue,      \* the store's remote-update signal is pending
  owedDurable,   \* durable: document_listing_revalidations holds the document
  owedVer,       \* durable: the update count that debt advertises
  seq,           \* in-memory signal sequence of the store
  localVer,      \* durable: the count the processed cursor covers
  reading, readVer, readSeq

vars == <<remoteVer, watermark, listedOrder, edits, touches, restarts,
          disconnects, laggingReads, up, connected, open, missedHint,
          hintedVer, relistDue, listing, listedVer, listBehind, listOwed, listPassed,
          probeDue, owedDurable, owedVer, seq, localVer, reading, readVer,
          readSeq>>

listingVars == <<listing, listedOrder, listedVer, listBehind, listOwed,
                 listPassed>>
readVars == <<reading, readVer, readSeq>>
boundVars == <<edits, touches, restarts, disconnects, laggingReads>>
storeVars == <<open, missedHint, hintedVer, probeDue, seq>>

MaxOrder == MaxEdits + MaxTouches
MaxSeq == MaxEdits * 2 + MaxTouches + MaxRestarts * 2 + MaxDisconnects + 2

TypeOK ==
  /\ remoteVer \in 0..MaxEdits /\ localVer \in 0..MaxEdits
  /\ owedVer \in 0..MaxEdits /\ readVer \in 0..MaxEdits
  /\ listedVer \in 0..MaxEdits /\ hintedVer \in 0..MaxEdits
  /\ seq \in 0..MaxSeq /\ readSeq \in 0..MaxSeq
  /\ watermark \in 0..MaxOrder /\ listedOrder \in 0..MaxOrder
  /\ {up, connected, open, missedHint, relistDue, listing, listBehind,
      listOwed, listPassed, probeDue, owedDurable, reading} \subseteq BOOLEAN

Init ==
  \* A create or a completed pull: the client holds every update.
  /\ remoteVer = 0 /\ localVer = 0 /\ watermark = 0 /\ listedOrder = 0
  /\ edits = 0 /\ touches = 0 /\ restarts = 0 /\ disconnects = 0
  /\ laggingReads = 0
  /\ up = TRUE /\ connected = FALSE /\ open = TRUE /\ missedHint = FALSE
  /\ hintedVer = 0 /\ relistDue = FALSE
  /\ listing = FALSE /\ listedVer = 0 /\ listBehind = FALSE
  /\ listOwed = FALSE /\ listPassed = FALSE
  /\ probeDue = FALSE /\ owedDurable = FALSE /\ owedVer = 0 /\ seq = 0
  /\ reading = FALSE /\ readVer = 0 /\ readSeq = 0

\* A peer's accepted write stores one update and hints connected clients. A
\* registered store takes the hint; otherwise the client remembers it.
PeerEdit ==
  /\ edits < MaxEdits
  /\ edits' = edits + 1 /\ remoteVer' = remoteVer + 1
  /\ hintedVer' = IF up /\ connected THEN remoteVer + 1 ELSE hintedVer
  /\ IF up /\ connected /\ open
       THEN probeDue' = TRUE /\ seq' = seq + 1 /\ UNCHANGED missedHint
       ELSE /\ UNCHANGED <<probeDue, seq>>
            /\ missedHint' =
                 (missedHint \/ (up /\ connected /\ RememberClosedStoreHint))
  /\ UNCHANGED <<watermark, touches, restarts, disconnects, laggingReads, up,
                 connected, open, relistDue, listingVars, owedDurable,
                 owedVer, localVer, readVars>>

\* An attachment bind or detach, a link change, or this device's own write
\* lists the row again without adding an update the client lacks.
OtherTouch ==
  /\ touches < MaxTouches
  /\ touches' = touches + 1
  /\ UNCHANGED <<remoteVer, watermark, edits, restarts, disconnects,
                 laggingReads, up, connected, storeVars, relistDue,
                 listingVars, owedDurable, owedVer, localVer, readVars>>

Acknowledge ==
  /\ up /\ ~connected
  /\ connected' = TRUE /\ relistDue' = RelistOnAcknowledge
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, storeVars, listingVars,
                 owedDurable, owedVer, localVer, readVars>>

Disconnect ==
  /\ connected /\ disconnects < MaxDisconnects
  /\ connected' = FALSE /\ disconnects' = disconnects + 1
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, restarts,
                 laggingReads, up, storeVars, relistDue, listingVars,
                 owedDurable, owedVer, localVer, readVars>>

\* A delta listing returns the row only while the watermark has not passed it.
BeginListing ==
  /\ up /\ relistDue /\ ~listing
  /\ relistDue' = FALSE
  /\ IF remoteVer + touches > watermark
       THEN /\ listing' = TRUE /\ listedOrder' = remoteVer + touches
            /\ listedVer' = remoteVer
            /\ listBehind' = (remoteVer > localVer)
            /\ listOwed' = FALSE /\ listPassed' = FALSE
       ELSE UNCHANGED listingVars
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, storeVars,
                 owedDurable, owedVer, localVer, readVars>>

\* The debt is written first; a registered store is then asked to read.
OweListedRead ==
  /\ up /\ listing /\ listBehind /\ ~listOwed
  /\ OweBeforeWatermark \/ listPassed
  /\ owedDurable' = TRUE
  /\ owedVer' = IF listedVer > owedVer THEN listedVer ELSE owedVer
  /\ listOwed' = TRUE
  /\ IF open
       THEN probeDue' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<probeDue, seq>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, open,
                 missedHint, hintedVer, relistDue, listing, listedOrder,
                 listedVer, listBehind, listPassed, localVer, readVars>>

\* The lane's watermark is saved after its rows are applied.
AdvanceWatermark ==
  /\ up /\ listing /\ ~listPassed
  /\ ~OweBeforeWatermark \/ listOwed \/ ~listBehind
  /\ watermark' = listedOrder
  /\ listPassed' = TRUE
  /\ UNCHANGED <<remoteVer, boundVars, up, connected, storeVars, relistDue,
                 listing, listedOrder, listedVer, listBehind, listOwed,
                 owedDurable, owedVer, localVer, readVars>>

FinishListing ==
  /\ listing /\ listPassed /\ (listOwed \/ ~listBehind)
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listPassed' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, storeVars,
                 relistDue, listedOrder, listedVer, listBehind, owedDurable,
                 owedVer, localVer, readVars>>

\* Something opens the document's store: a view, or the background primer.
\* A store whose document a listing covers arms no probe of its own.
OpenStore ==
  /\ up /\ ~open
  /\ open' = TRUE /\ missedHint' = FALSE /\ UNCHANGED hintedVer
  /\ IF missedHint \/ (RestoreOnOpen /\ owedDurable)
       THEN probeDue' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<probeDue, seq>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, relistDue,
                 listingVars, owedDurable, owedVer, localVer, readVars>>

\* The document lane snapshots the signal sequence before its request.
BeginRead ==
  /\ up /\ open /\ probeDue /\ ~reading
  /\ reading' = TRUE /\ readVer' = remoteVer /\ readSeq' = seq
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, storeVars,
                 relistDue, listingVars, owedDurable, owedVer, localVer>>

\* A replica that lags the listing serves the pull: it may hold any count
\* from the one this client already processed up to the current one. A read
\* a hint forced is assumed to see the hinted write, as before listings owed
\* reads; only the listing's own count is checked against the cursor.
BeginLaggingRead ==
  /\ up /\ open /\ probeDue /\ ~reading
  /\ laggingReads < MaxLaggingReads
  /\ laggingReads' = laggingReads + 1
  /\ reading' = TRUE /\ readSeq' = seq
  /\ readVer' \in (IF hintedVer > localVer THEN hintedVer ELSE localVer)
                    ..remoteVer
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, restarts,
                 disconnects, up, connected, storeVars, relistDue,
                 listingVars, owedDurable, owedVer, localVer>>

\* The pull applies every update through its bound and records the cursor.
\* A debt its cursor does not cover keeps the signal for a later pass.
FinishRead ==
  /\ up /\ reading
  /\ reading' = FALSE
  /\ localVer' = IF readVer > localVer THEN readVer ELSE localVer
  /\ LET covered == IF readVer > localVer THEN readVer ELSE localVer
         unchanged == ~SettleOnlyIfUnchanged \/ seq = readSeq
         paid == ~owedDurable \/ ~SettleOnlyIfCovered \/ covered >= owedVer
     IN IF unchanged /\ paid
          THEN probeDue' = FALSE /\ owedDurable' = FALSE /\ owedVer' = 0
          ELSE UNCHANGED <<probeDue, owedDurable, owedVer>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, open,
                 missedHint, hintedVer, seq, relistDue, listingVars, readVer,
                 readSeq>>

Crash ==
  /\ up /\ restarts < MaxRestarts
  /\ up' = FALSE /\ connected' = FALSE /\ relistDue' = FALSE
  /\ open' = FALSE /\ missedHint' = FALSE /\ hintedVer' = 0
  /\ restarts' = restarts + 1
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listPassed' = FALSE
  /\ probeDue' = FALSE /\ reading' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, disconnects,
                 laggingReads, listedOrder, listedVer, listBehind,
                 owedDurable, owedVer, seq, localVer, readVer, readSeq>>

Start ==
  /\ ~up
  /\ up' = TRUE
  /\ UNCHANGED <<remoteVer, watermark, boundVars, connected, storeVars,
                 relistDue, listingVars, owedDurable, owedVer, localVer,
                 readVars>>

Next ==
  \/ PeerEdit \/ OtherTouch \/ Acknowledge \/ Disconnect
  \/ BeginListing \/ OweListedRead \/ AdvanceWatermark \/ FinishListing
  \/ OpenStore \/ BeginRead \/ BeginLaggingRead \/ FinishRead
  \/ Crash \/ Start
  \* Bounded peer, crash and disconnect budgets leave a quiescent end state.
  \/ UNCHANGED vars

\* Only the client's own steps and the server's acknowledgement are fair; no
\* step of another device is needed for the client to settle.
Fairness ==
  /\ WF_vars(Acknowledge) /\ WF_vars(Start) /\ WF_vars(OpenStore)
  /\ WF_vars(BeginListing) /\ WF_vars(OweListedRead)
  /\ WF_vars(AdvanceWatermark) /\ WF_vars(FinishListing)
  /\ WF_vars(BeginRead) /\ WF_vars(FinishRead)

Spec == Init /\ [][Next]_vars /\ Fairness

(***************************************************************************)
(* While the client is behind, something still obliges a read: a durable  *)
(* debt, a row the next delta listing will return, or, while the process  *)
(* is up, a pending signal, a remembered hint, a fresh read that covers    *)
(* the latest count, or a re-list that saw the row behind and has not yet *)
(* owed its read.                                                          *)
(***************************************************************************)
EvidenceRetained ==
  localVer < remoteVer =>
    \/ owedDurable
    \/ remoteVer + touches > watermark
    \/ up /\ open /\ probeDue
    \/ up /\ missedHint
    \/ up /\ reading /\ readVer = remoteVer
    \/ up /\ listing /\ listBehind /\ ~listOwed

\* A store that is not open holds no signal, and no read runs without one.
StoreWorkIsWellFormed ==
  /\ (probeDue \/ reading) => up /\ open
  /\ missedHint => up /\ ~open

\* Once edits stop, the client has processed every update the server holds.
Converges == <>[](localVer = remoteVer)

\* Every owed read is eventually settled.
DebtsSettle == <>[](~owedDurable)

====
