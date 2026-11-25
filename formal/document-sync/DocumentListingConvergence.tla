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
(* settles the debt only if its cursor also covers the owed count.        *)
(*                                                                         *)
(* The row also reports the document's access head, which a link change   *)
(* or a rotation moves without adding an update. The device holds the     *)
(* access context of one head: the key bundle of its record, and an open  *)
(* store's copy of it. A listing whose head differs from the bundle's     *)
(* owes a read too. Applying a listed row whose head is newer drops the   *)
(* record's bundle, so the debt is written before the row is applied; a   *)
(* store that later loads a record with no bundle probes on its own.      *)
(*                                                                         *)
(* A crash loses memory, the socket, the open store and in-flight work;   *)
(* the watermark, the durable debt, the cursor, the local copy and the    *)
(* record's bundle survive.                                                *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxEdits,
  MaxTouches,
  MaxHeadMoves,
  MaxRestarts,
  MaxDisconnects,
  \* Reads a replica that lags the listing may serve.
  MaxLaggingReads,
  \* Production owes the read before the lane watermark passes the row.
  OweBeforeWatermark,
  \* Production owes the read before the listed row is applied.
  OweBeforeApply,
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
       /\ MaxHeadMoves \in Nat
       /\ MaxDisconnects \in Nat /\ MaxLaggingReads \in Nat
       /\ OweBeforeWatermark \in BOOLEAN
       /\ OweBeforeApply \in BOOLEAN
       /\ SettleOnlyIfCovered \in BOOLEAN
       /\ SettleOnlyIfUnchanged \in BOOLEAN
       /\ RememberClosedStoreHint \in BOOLEAN
       /\ RestoreOnOpen \in BOOLEAN
       /\ RelistOnAcknowledge \in BOOLEAN

VARIABLES
  remoteVer,     \* how many updates the server holds for the document
  headMoves,     \* the server's access head: how often it has moved
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
  listedHead,    \* the access head that re-list read
  listBehind,    \* the client's cursor did not cover it
  listOwed,      \* that re-list already owed the read
  listApplied,   \* that re-list already applied the row to the record
  listPassed,    \* that re-list already advanced the watermark past the row
  probeDue,      \* the store's remote-update signal is pending
  owedDurable,   \* durable: document_listing_revalidations holds the document
  owedVer,       \* durable: the update count that debt advertises
  seq,           \* in-memory signal sequence of the store
  localVer,      \* durable: the count the processed cursor covers
  heldHead,      \* durable: the head the device's access context was read at
  bundleHeld,    \* durable: the record still holds that context's key bundle
  reading, readVer, readSeq, readHead

vars == <<remoteVer, headMoves, watermark, listedOrder, edits, touches,
          restarts, disconnects, laggingReads, up, connected, open,
          missedHint, hintedVer, relistDue, listing, listedVer, listedHead,
          listBehind, listOwed, listApplied, listPassed, probeDue,
          owedDurable, owedVer, seq, localVer, heldHead, bundleHeld,
          reading, readVer, readSeq, readHead>>

listingVars == <<listing, listedOrder, listedVer, listedHead, listBehind,
                 listOwed, listApplied, listPassed>>
readVars == <<reading, readVer, readSeq, readHead>>
boundVars == <<edits, touches, restarts, disconnects, laggingReads>>
storeVars == <<open, missedHint, hintedVer, probeDue, seq>>
headVars == <<headMoves, heldHead, bundleHeld>>

MaxOrder == MaxEdits + MaxTouches + MaxHeadMoves
MaxSeq == MaxEdits * 2 + MaxTouches + MaxHeadMoves * 2 + MaxRestarts * 2
            + MaxDisconnects + 2

\* The row's publication position: every write that touches it advances it.
Order == remoteVer + touches + headMoves

\* What the re-list in progress shows this device has not read: more updates
\* than its cursor covers, or another access head than its bundle's. The
\* head is compared with the record as it stands when the check runs.
ListedBehind == listBehind \/ (bundleHeld /\ heldHead # listedHead)

TypeOK ==
  /\ remoteVer \in 0..MaxEdits /\ localVer \in 0..MaxEdits
  /\ owedVer \in 0..MaxEdits /\ readVer \in 0..MaxEdits
  /\ listedVer \in 0..MaxEdits /\ hintedVer \in 0..MaxEdits
  /\ seq \in 0..MaxSeq /\ readSeq \in 0..MaxSeq
  /\ watermark \in 0..MaxOrder /\ listedOrder \in 0..MaxOrder
  /\ headMoves \in 0..MaxHeadMoves /\ heldHead \in 0..MaxHeadMoves
  /\ listedHead \in 0..MaxHeadMoves /\ readHead \in 0..MaxHeadMoves
  /\ {up, connected, open, missedHint, relistDue, listing, listBehind,
      listOwed, listApplied, listPassed, probeDue, owedDurable, bundleHeld,
      reading} \subseteq BOOLEAN

Init ==
  \* A create or a completed pull: the client holds every update.
  /\ remoteVer = 0 /\ localVer = 0 /\ watermark = 0 /\ listedOrder = 0
  /\ edits = 0 /\ touches = 0 /\ restarts = 0 /\ disconnects = 0
  /\ laggingReads = 0
  /\ up = TRUE /\ connected = FALSE /\ open = TRUE /\ missedHint = FALSE
  /\ hintedVer = 0 /\ relistDue = FALSE
  /\ listing = FALSE /\ listedVer = 0 /\ listedHead = 0
  /\ listBehind = FALSE /\ listOwed = FALSE /\ listApplied = FALSE
  /\ listPassed = FALSE
  /\ probeDue = FALSE /\ owedDurable = FALSE /\ owedVer = 0 /\ seq = 0
  /\ headMoves = 0 /\ heldHead = 0 /\ bundleHeld = TRUE
  /\ reading = FALSE /\ readVer = 0 /\ readSeq = 0 /\ readHead = 0

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
                 owedVer, localVer, headVars, readVars>>

\* An attachment bind or detach, or this device's own write, lists the row
\* again without adding an update the client lacks or moving the head.
OtherTouch ==
  /\ touches < MaxTouches
  /\ touches' = touches + 1
  /\ UNCHANGED <<remoteVer, watermark, edits, restarts, disconnects,
                 laggingReads, up, connected, storeVars, relistDue,
                 listingVars, owedDurable, owedVer, localVer, headVars,
                 readVars>>

\* A peer's link change or rotation moves the access head and lists the row
\* again. It adds no update, and no hint for it is assumed to arrive.
HeadMove ==
  /\ headMoves < MaxHeadMoves
  /\ headMoves' = headMoves + 1
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, storeVars,
                 relistDue, listingVars, owedDurable, owedVer, localVer,
                 heldHead, bundleHeld, readVars>>

Acknowledge ==
  /\ up /\ ~connected
  /\ connected' = TRUE /\ relistDue' = RelistOnAcknowledge
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, storeVars, listingVars,
                 owedDurable, owedVer, localVer, headVars, readVars>>

Disconnect ==
  /\ connected /\ disconnects < MaxDisconnects
  /\ connected' = FALSE /\ disconnects' = disconnects + 1
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, restarts,
                 laggingReads, up, storeVars, relistDue, listingVars,
                 owedDurable, owedVer, localVer, headVars, readVars>>

\* A delta listing returns the row only while the watermark has not passed it.
BeginListing ==
  /\ up /\ relistDue /\ ~listing
  /\ relistDue' = FALSE
  /\ IF Order > watermark
       THEN /\ listing' = TRUE /\ listedOrder' = Order
            /\ listedVer' = remoteVer /\ listedHead' = headMoves
            /\ listBehind' = (remoteVer > localVer)
            /\ listOwed' = FALSE /\ listApplied' = FALSE
            /\ listPassed' = FALSE
       ELSE UNCHANGED listingVars
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, storeVars,
                 owedDurable, owedVer, localVer, headVars, readVars>>

\* The debt is written first; a registered store is then asked to read.
OweListedRead ==
  /\ up /\ listing /\ ListedBehind /\ ~listOwed
  /\ OweBeforeWatermark \/ listPassed
  /\ owedDurable' = TRUE
  /\ owedVer' = IF listedVer > owedVer THEN listedVer ELSE owedVer
  /\ listOwed' = TRUE
  /\ IF open
       THEN probeDue' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<probeDue, seq>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, open,
                 missedHint, hintedVer, relistDue, listing, listedOrder,
                 listedVer, listedHead, listBehind, listApplied, listPassed,
                 localVer, headVars, readVars>>

\* The listed row is applied to the record. A row with a newer access head
\* drops the key bundle the record held, so the record names no head after.
ApplyListedRow ==
  /\ up /\ listing /\ ~listApplied
  /\ ~OweBeforeApply \/ listOwed \/ ~ListedBehind
  /\ listApplied' = TRUE
  /\ bundleHeld' = (bundleHeld /\ ~(heldHead < listedHead))
  /\ UNCHANGED <<remoteVer, headMoves, watermark, boundVars, up, connected,
                 storeVars, relistDue, listing, listedOrder, listedVer,
                 listedHead, listBehind, listOwed, listPassed, owedDurable,
                 owedVer, localVer, heldHead, readVars>>

\* The lane's watermark is saved once its rows are owed; the model leaves
\* that save and the apply unordered.
AdvanceWatermark ==
  /\ up /\ listing /\ ~listPassed
  /\ ~OweBeforeWatermark \/ listOwed \/ ~ListedBehind
  /\ watermark' = listedOrder
  /\ listPassed' = TRUE
  /\ UNCHANGED <<remoteVer, boundVars, up, connected, storeVars, relistDue,
                 listing, listedOrder, listedVer, listedHead, listBehind,
                 listOwed, listApplied, owedDurable, owedVer, localVer,
                 headVars, readVars>>

FinishListing ==
  /\ listing /\ listApplied /\ listPassed /\ (listOwed \/ ~ListedBehind)
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listApplied' = FALSE
  /\ listPassed' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, storeVars,
                 relistDue, listedOrder, listedVer, listedHead, listBehind,
                 owedDurable, owedVer, localVer, headVars, readVars>>

\* Something opens the document's store: a view, or the background primer.
\* A store whose document a listing covers arms no probe of its own; a
\* record with no key bundle has completed no pull, so nothing covers it.
OpenStore ==
  /\ up /\ ~open
  /\ open' = TRUE /\ missedHint' = FALSE /\ UNCHANGED hintedVer
  /\ IF missedHint \/ (RestoreOnOpen /\ owedDurable) \/ ~bundleHeld
       THEN probeDue' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<probeDue, seq>>
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, relistDue,
                 listingVars, owedDurable, owedVer, localVer, headVars,
                 readVars>>

\* The document lane snapshots the signal sequence before its request.
BeginRead ==
  /\ up /\ open /\ probeDue /\ ~reading
  /\ reading' = TRUE /\ readVer' = remoteVer /\ readSeq' = seq
  /\ readHead' = headMoves
  /\ UNCHANGED <<remoteVer, watermark, boundVars, up, connected, storeVars,
                 relistDue, listingVars, owedDurable, owedVer, localVer,
                 headVars>>

\* A replica that lags the listing serves the pull: it may hold any count
\* from the one this client already processed up to the current one. A read
\* a hint forced is assumed to see the hinted write, as before listings owed
\* reads; only the listing's own count is checked against the cursor. The
\* access head it returns is likewise assumed current.
BeginLaggingRead ==
  /\ up /\ open /\ probeDue /\ ~reading
  /\ laggingReads < MaxLaggingReads
  /\ laggingReads' = laggingReads + 1
  /\ reading' = TRUE /\ readSeq' = seq /\ readHead' = headMoves
  /\ readVer' \in (IF hintedVer > localVer THEN hintedVer ELSE localVer)
                    ..remoteVer
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, restarts,
                 disconnects, up, connected, storeVars, relistDue,
                 listingVars, owedDurable, owedVer, localVer, headVars>>

\* The pull applies every update through its bound and records the cursor,
\* and saves the access context of the head it read with its key bundle.
\* A debt its cursor does not cover keeps the signal for a later pass.
FinishRead ==
  /\ up /\ reading
  /\ reading' = FALSE
  /\ localVer' = IF readVer > localVer THEN readVer ELSE localVer
  /\ heldHead' = IF bundleHeld /\ heldHead > readHead THEN heldHead
                  ELSE readHead
  /\ bundleHeld' = TRUE
  /\ LET covered == IF readVer > localVer THEN readVer ELSE localVer
         unchanged == ~SettleOnlyIfUnchanged \/ seq = readSeq
         paid == ~owedDurable \/ ~SettleOnlyIfCovered \/ covered >= owedVer
     IN IF unchanged /\ paid
          THEN probeDue' = FALSE /\ owedDurable' = FALSE /\ owedVer' = 0
          ELSE UNCHANGED <<probeDue, owedDurable, owedVer>>
  /\ UNCHANGED <<remoteVer, headMoves, watermark, boundVars, up, connected,
                 open, missedHint, hintedVer, seq, relistDue, listingVars,
                 readVer, readSeq, readHead>>

Crash ==
  /\ up /\ restarts < MaxRestarts
  /\ up' = FALSE /\ connected' = FALSE /\ relistDue' = FALSE
  /\ open' = FALSE /\ missedHint' = FALSE /\ hintedVer' = 0
  /\ restarts' = restarts + 1
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listApplied' = FALSE
  /\ listPassed' = FALSE
  /\ probeDue' = FALSE /\ reading' = FALSE
  /\ UNCHANGED <<remoteVer, watermark, edits, touches, disconnects,
                 laggingReads, listedOrder, listedVer, listedHead, listBehind,
                 owedDurable, owedVer, seq, localVer, headVars, readVer,
                 readSeq, readHead>>

Start ==
  /\ ~up
  /\ up' = TRUE
  /\ UNCHANGED <<remoteVer, watermark, boundVars, connected, storeVars,
                 relistDue, listingVars, owedDurable, owedVer, localVer,
                 headVars, readVars>>

Next ==
  \/ PeerEdit \/ OtherTouch \/ HeadMove \/ Acknowledge \/ Disconnect
  \/ BeginListing \/ OweListedRead \/ ApplyListedRow \/ AdvanceWatermark
  \/ FinishListing
  \/ OpenStore \/ BeginRead \/ BeginLaggingRead \/ FinishRead
  \/ Crash \/ Start
  \* Bounded peer, crash and disconnect budgets leave a quiescent end state.
  \/ UNCHANGED vars

\* Only the client's own steps and the server's acknowledgement are fair; no
\* step of another device is needed for the client to settle.
Fairness ==
  /\ WF_vars(Acknowledge) /\ WF_vars(Start) /\ WF_vars(OpenStore)
  /\ WF_vars(BeginListing) /\ WF_vars(OweListedRead)
  /\ WF_vars(ApplyListedRow) /\ WF_vars(AdvanceWatermark)
  /\ WF_vars(FinishListing)
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
    \/ Order > watermark
    \/ up /\ open /\ probeDue
    \/ up /\ missedHint
    \/ up /\ reading /\ readVer = remoteVer
    \/ up /\ listing /\ listBehind /\ ~listOwed

(***************************************************************************)
(* While the device's access context is not the server's head, something  *)
(* still obliges a read: a durable debt, a row the next delta listing     *)
(* will return to a record that still holds a bundle to compare, a store  *)
(* that will find no bundle when it loads, or, while the process is up, a *)
(* pending signal, a read that fetches the current head, or a re-list     *)
(* that saw the head moved and has not yet owed its read.                 *)
(***************************************************************************)
AccessHeadEvidenceRetained ==
  (~bundleHeld \/ heldHead # headMoves) =>
    \/ owedDurable
    \/ bundleHeld /\ Order > watermark
    \/ ~bundleHeld /\ ~open
    \/ up /\ open /\ probeDue
    \/ up /\ reading /\ readHead = headMoves
    \/ up /\ listing /\ ListedBehind /\ ~listOwed

\* A store that is not open holds no signal, and no read runs without one.
StoreWorkIsWellFormed ==
  /\ (probeDue \/ reading) => up /\ open
  /\ missedHint => up /\ ~open

\* Once edits stop, the client has processed every update the server holds.
Converges == <>[](localVer = remoteVer)

\* Every owed read is eventually settled.
DebtsSettle == <>[](~owedDurable)

====
