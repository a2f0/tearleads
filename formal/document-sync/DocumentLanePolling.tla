---- MODULE DocumentLanePolling ----
(***************************************************************************)
(* A client finds a change to a folder's document lane without listing    *)
(* every known document lane after each acknowledged connection.          *)
(*                                                                         *)
(* Every server write that changes what a folder's document lane returns  *)
(* also republishes the folder's row, so the row moves past the watermark *)
(* of the lane that serves it: its parent's child lane, or the root lane. *)
(* After each acknowledged connection the client's tree crawl lists those *)
(* lanes. A row the crawl is served owes the folder's document lane one   *)
(* listing, durably, before the serving lane's watermark passes the row.  *)
(* Tree listings outside a catch-up (a hint's tree listing, a start's, or *)
(* a retried crawl) owe the lane the same way with no sweep behind them.  *)
(* The catch-up then lists every lane a durable debt names. A listing     *)
(* reads the debt's revision before its request and settles only that     *)
(* revision, and only when the listing succeeds. A hint reaches the       *)
(* client only while it is up and its interest is acknowledged, and       *)
(* forces a listing of the lane.                                          *)
(*                                                                         *)
(* A crash loses memory, the socket and in-flight work. Both watermarks   *)
(* and the debt survive.                                                   *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxWrites,
  MaxTouches,
  MaxRestarts,
  MaxDisconnects,
  MaxFailures,
  MaxOutsideTrees,
  \* The server republishes the folder's row with every write that changes
  \* what its document lane returns.
  TouchFolderOnWrite,
  \* Production owes the listing before the serving lane's watermark passes.
  OweBeforeParentWatermark,
  \* Production settles only the debt revision a listing read before it began.
  SettleOnlyIfUnchanged,
  \* Production's catch-up lists every lane a durable debt names, not only
  \* the lanes its own crawl owed.
  ListDurableDebts,
  \* Production settles a durable debt only when the listing succeeds.
  SettleOnFailedListing

ASSUME /\ MaxWrites \in Nat /\ MaxTouches \in Nat /\ MaxRestarts \in Nat
       /\ MaxDisconnects \in Nat /\ MaxFailures \in Nat
       /\ MaxOutsideTrees \in Nat
       /\ TouchFolderOnWrite \in BOOLEAN
       /\ OweBeforeParentWatermark \in BOOLEAN
       /\ SettleOnlyIfUnchanged \in BOOLEAN
       /\ ListDurableDebts \in BOOLEAN
       /\ SettleOnFailedListing \in BOOLEAN

VARIABLES
  docOrder,        \* publications in the folder's document lane
  folderOrder,     \* publications of the folder's row in the lane serving it
  writes, touches, restarts, disconnects, failures, outsideTrees,
  parentWatermark, \* durable: position of the serving lane the client applied
  laneWatermark,   \* durable: position of the document lane the client applied
  debtRev,         \* durable: revision of the listing owed to the lane; 0 = none
  nextRev,         \* the next fresh revision
  outsideDebt,     \* durable debt was written by an outside tree listing since last ack
  up,              \* the client process is running
  connected,       \* its interest declaration is acknowledged
  crawlDue,        \* an acknowledged connection still owes its tree crawl
  crawling,        \* a crawl is applying the folder's row
  crawlOrder,      \* the folder-row position that crawl's listing captured
  crawlServed,     \* that listing returned the folder's row
  crawlOwed,       \* that crawl already owed the lane its listing
  crawlPassed,     \* that crawl already advanced the serving lane's watermark
  ownDebt,         \* memory: a crawl of this process owed the lane
  sweepDue,        \* a finished crawl still owes the listing of owed lanes
  hintDue,         \* a hint's forced listing of the lane is still to run
  listing,         \* a listing of the document lane is in flight
  listOrder,       \* the document-lane position that listing captured
  listRev          \* the debt revision that listing read before its request

vars == <<docOrder, folderOrder, writes, touches, restarts, disconnects,
          failures, outsideTrees, parentWatermark, laneWatermark, debtRev,
          nextRev, outsideDebt, up, connected, crawlDue, crawling, crawlOrder,
          crawlServed, crawlOwed, crawlPassed, ownDebt, sweepDue, hintDue,
          listing, listOrder, listRev>>

serverVars == <<docOrder, folderOrder, writes, touches>>
boundVars == <<restarts, disconnects, failures, outsideTrees>>
crawlVars == <<crawling, crawlOrder, crawlServed, crawlOwed, crawlPassed>>
listVars == <<listing, listOrder, listRev>>
durableVars == <<parentWatermark, laneWatermark, debtRev, nextRev, outsideDebt>>

MaxOrder == MaxWrites + MaxTouches
MaxRev == MaxRestarts + MaxDisconnects + MaxOutsideTrees + 2
Max(a, b) == IF a >= b THEN a ELSE b

TypeOK ==
  /\ docOrder \in 0..MaxWrites /\ folderOrder \in 0..MaxOrder
  /\ writes \in 0..MaxWrites /\ touches \in 0..MaxTouches
  /\ restarts \in 0..MaxRestarts /\ disconnects \in 0..MaxDisconnects
  /\ failures \in 0..MaxFailures /\ outsideTrees \in 0..MaxOutsideTrees
  /\ parentWatermark \in 0..MaxOrder /\ crawlOrder \in 0..MaxOrder
  /\ laneWatermark \in 0..MaxWrites /\ listOrder \in 0..MaxWrites
  /\ debtRev \in 0..MaxRev /\ listRev \in 0..MaxRev /\ nextRev \in 1..(MaxRev + 1)
  /\ {up, connected, crawlDue, crawling, crawlServed, crawlOwed, crawlPassed,
      ownDebt, sweepDue, hintDue, listing, outsideDebt} \subseteq BOOLEAN

Init ==
  \* The client has listed the folder and its documents and is not connected.
  /\ docOrder = 0 /\ folderOrder = 0 /\ writes = 0 /\ touches = 0
  /\ restarts = 0 /\ disconnects = 0 /\ failures = 0 /\ outsideTrees = 0
  /\ parentWatermark = 0 /\ laneWatermark = 0 /\ debtRev = 0 /\ nextRev = 1
  /\ outsideDebt = FALSE
  /\ up = TRUE /\ connected = FALSE /\ crawlDue = FALSE
  /\ crawling = FALSE /\ crawlOrder = 0 /\ crawlServed = FALSE
  /\ crawlOwed = FALSE /\ crawlPassed = FALSE
  /\ ownDebt = FALSE /\ sweepDue = FALSE /\ hintDue = FALSE
  /\ listing = FALSE /\ listOrder = 0 /\ listRev = 0

\* A peer's accepted write changes what the document lane returns: a new or
\* changed document row, a link, an unlink or a purge tombstone. It
\* republishes the folder's row and hints a connected client.
PeerWrite ==
  /\ writes < MaxWrites
  /\ writes' = writes + 1 /\ docOrder' = docOrder + 1
  /\ folderOrder' = IF TouchFolderOnWrite THEN folderOrder + 1 ELSE folderOrder
  /\ hintDue' = (hintDue \/ (up /\ connected))
  /\ UNCHANGED <<touches, boundVars, durableVars, up, connected, crawlDue,
                 crawlVars, ownDebt, sweepDue, listVars>>

\* A write that republishes the folder's row and leaves its document lane
\* alone, such as a rename or a grant.
OtherTouch ==
  /\ touches < MaxTouches
  /\ touches' = touches + 1 /\ folderOrder' = folderOrder + 1
  /\ UNCHANGED <<docOrder, writes, boundVars, durableVars, up, connected,
                 crawlDue, crawlVars, ownDebt, sweepDue, hintDue, listVars>>

Crash ==
  /\ up /\ restarts < MaxRestarts
  /\ restarts' = restarts + 1
  /\ up' = FALSE /\ connected' = FALSE /\ crawlDue' = FALSE
  /\ crawling' = FALSE /\ crawlServed' = FALSE /\ crawlOwed' = FALSE
  /\ crawlPassed' = FALSE /\ ownDebt' = FALSE /\ sweepDue' = FALSE
  /\ hintDue' = FALSE /\ listing' = FALSE
  /\ UNCHANGED <<serverVars, disconnects, failures, outsideTrees, durableVars,
                 crawlOrder, listOrder, listRev>>

Start ==
  /\ ~up
  /\ up' = TRUE
  /\ UNCHANGED <<serverVars, boundVars, durableVars, connected, crawlDue,
                 crawlVars, ownDebt, sweepDue, hintDue, listVars>>

Disconnect ==
  /\ up /\ connected /\ disconnects < MaxDisconnects
  /\ disconnects' = disconnects + 1 /\ connected' = FALSE
  /\ UNCHANGED <<serverVars, restarts, failures, outsideTrees, durableVars, up,
                 crawlDue, crawlVars, ownDebt, sweepDue, hintDue, listVars>>

\* The server acknowledges the client's interest: a tree crawl is owed.
Acknowledge ==
  /\ up /\ ~connected
  /\ connected' = TRUE /\ crawlDue' = TRUE /\ outsideDebt' = FALSE
  /\ UNCHANGED <<serverVars, boundVars, parentWatermark, laneWatermark,
                 debtRev, nextRev, up, crawlVars, ownDebt, sweepDue, hintDue,
                 listVars>>

\* The crawl lists the lane that serves the folder's row from its watermark.
BeginCrawl ==
  /\ up /\ crawlDue /\ ~crawling
  /\ crawlDue' = FALSE /\ crawling' = TRUE
  /\ crawlOrder' = folderOrder
  /\ crawlServed' = (folderOrder > parentWatermark)
  /\ crawlOwed' = FALSE /\ crawlPassed' = FALSE
  /\ UNCHANGED <<serverVars, boundVars, durableVars, up, connected, ownDebt,
                 sweepDue, hintDue, listVars>>

\* A served row owes the folder's document lane a listing, durably.
CrawlOwe ==
  /\ up /\ crawling /\ crawlServed /\ ~crawlOwed
  /\ OweBeforeParentWatermark => ~crawlPassed
  /\ crawlOwed' = TRUE /\ ownDebt' = TRUE /\ outsideDebt' = FALSE
  /\ debtRev' = nextRev /\ nextRev' = nextRev + 1
  /\ UNCHANGED <<serverVars, boundVars, parentWatermark, laneWatermark, up,
                 connected, crawlDue, crawling, crawlOrder, crawlServed,
                 crawlPassed, sweepDue, hintDue, listVars>>

\* The crawl saves the serving lane's watermark past the row.
CrawlPass ==
  /\ up /\ crawling /\ ~crawlPassed
  /\ crawlOwed \/ ~crawlServed \/ ~OweBeforeParentWatermark
  /\ crawlPassed' = TRUE
  /\ parentWatermark' = Max(parentWatermark, crawlOrder)
  /\ UNCHANGED <<serverVars, boundVars, laneWatermark, debtRev, nextRev,
                 outsideDebt, up, connected, crawlDue, crawling, crawlOrder,
                 crawlServed, crawlOwed, ownDebt, sweepDue, hintDue, listVars>>

\* The crawl ends: the catch-up owes the listing of every owed lane.
FinishCrawl ==
  /\ up /\ crawling /\ crawlPassed /\ (crawlOwed \/ ~crawlServed)
  /\ crawling' = FALSE /\ sweepDue' = TRUE
  /\ UNCHANGED <<serverVars, boundVars, durableVars, up, connected, crawlDue,
                 crawlOrder, crawlServed, crawlOwed, crawlPassed, ownDebt,
                 hintDue, listVars>>

\* A tree listing outside a catch-up (a hint's tree listing, a start's, or a
\* retried crawl) is served the folder's row, owes the lane a listing durably,
\* and advances the serving lane's watermark, with no catch-up sweep behind it.
OutsideTreeListing ==
  /\ up /\ ~crawling /\ folderOrder > parentWatermark
  /\ outsideTrees < MaxOutsideTrees
  /\ outsideTrees' = outsideTrees + 1
  /\ parentWatermark' = folderOrder
  /\ debtRev' = nextRev /\ nextRev' = nextRev + 1
  /\ outsideDebt' = TRUE
  /\ UNCHANGED <<serverVars, restarts, disconnects, failures, laneWatermark,
                 up, connected, crawlDue, crawlVars, ownDebt, sweepDue,
                 hintDue, listVars>>

\* Whether the catch-up finds the lane owed.
SweepSeesDebt == debtRev > 0 /\ (ListDurableDebts \/ ownDebt)

\* The catch-up lists the lane if a debt names it, reading the debt's
\* revision before its request.
SweepListing ==
  /\ up /\ sweepDue /\ ~listing
  /\ sweepDue' = FALSE /\ ownDebt' = FALSE
  /\ IF SweepSeesDebt
       THEN listing' = TRUE /\ listOrder' = docOrder /\ listRev' = debtRev
       ELSE UNCHANGED listVars
  /\ UNCHANGED <<serverVars, boundVars, durableVars, up, connected, crawlDue,
                 crawlVars, hintDue>>

\* The listing a hint forced.
HintListing ==
  /\ up /\ hintDue /\ ~listing
  /\ hintDue' = FALSE
  /\ listing' = TRUE /\ listOrder' = docOrder /\ listRev' = debtRev
  /\ UNCHANGED <<serverVars, boundVars, durableVars, up, connected, crawlDue,
                 crawlVars, ownDebt, sweepDue>>

\* A failed or incomplete listing does not advance the lane's watermark,
\* retries on the lane while up, and leaves the durable debt open
\* (`SettleOnFailedListing = FALSE`).
FailListing ==
  /\ up /\ listing /\ failures < MaxFailures
  /\ failures' = failures + 1
  /\ listing' = FALSE
  /\ debtRev' = IF SettleOnFailedListing /\ debtRev > 0
                  /\ (listRev = debtRev \/ ~SettleOnlyIfUnchanged)
                THEN 0 ELSE debtRev
  /\ outsideDebt' = IF debtRev' = 0 THEN FALSE ELSE outsideDebt
  /\ IF debtRev > 0
       THEN sweepDue' = TRUE /\ UNCHANGED hintDue
       ELSE hintDue' = TRUE /\ UNCHANGED sweepDue
  /\ UNCHANGED <<serverVars, restarts, disconnects, outsideTrees,
                 parentWatermark, laneWatermark, nextRev, up, connected,
                 crawlDue, crawlVars, ownDebt, listOrder, listRev>>

\* The listing is applied: the lane's watermark passes what it read, and
\* the debt it read before its request is settled.
FinishListing ==
  /\ up /\ listing
  /\ listing' = FALSE
  /\ laneWatermark' = Max(laneWatermark, listOrder)
  /\ debtRev' = IF debtRev > 0 /\ (listRev = debtRev \/ ~SettleOnlyIfUnchanged)
                  THEN 0 ELSE debtRev
  /\ outsideDebt' = IF debtRev' = 0 THEN FALSE ELSE outsideDebt
  /\ UNCHANGED <<serverVars, boundVars, parentWatermark, nextRev, up,
                 connected, crawlDue, crawlVars, ownDebt, sweepDue, hintDue,
                 listOrder, listRev>>

ClientStep ==
  \/ Start \/ BeginCrawl \/ CrawlOwe \/ CrawlPass \/ FinishCrawl
  \/ OutsideTreeListing \/ SweepListing \/ HintListing
  \/ FailListing \/ FinishListing

Next ==
  \/ PeerWrite \/ OtherTouch \/ Crash \/ Disconnect \/ Acknowledge
  \/ ClientStep
  \/ UNCHANGED vars

Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(Start) /\ WF_vars(Acknowledge) /\ WF_vars(BeginCrawl)
  /\ WF_vars(CrawlOwe) /\ WF_vars(CrawlPass) /\ WF_vars(FinishCrawl)
  /\ WF_vars(SweepListing) /\ WF_vars(HintListing) /\ WF_vars(FinishListing)

\* While the document lane holds a change the client has not listed,
\* something still obliges a listing: a durable debt, a folder row the next
\* crawl will be served, an in-progress crawl that saw the row and has not
\* owed its listing yet, or, while the process is up, a pending hint or a
\* listing in flight that captured the change.
LaneEvidenceRetained ==
  laneWatermark < docOrder =>
    \/ debtRev > 0
    \/ parentWatermark < folderOrder
    \/ up /\ crawling /\ crawlServed /\ ~crawlOwed
    \/ up /\ hintDue
    \/ up /\ listing /\ listOrder = docOrder

\* Once writes, crashes and disconnects stop, the client has listed every
\* change to the lane.
Converges == <>[](laneWatermark = docOrder)

\* Every owed listing settles once an acknowledged connection's catch-up runs
\* for it; only a debt written by an outside tree listing while connected
\* waits for the next acknowledged connection.
DebtsSettle == <>[](debtRev = 0 \/ (connected /\ outsideDebt))
====
