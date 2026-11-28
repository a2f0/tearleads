---- MODULE DiscoveryLaneResumption ----
(***************************************************************************)
(* A device signs in and lists the document lanes of the containers it     *)
(* learns about. One batched listing pages every queued lane from its      *)
(* cursor; the lanes then verify and apply one at a time. Verification may *)
(* defer a document whose signed head is not yet available: the candidate  *)
(* is staged durably and an in-memory timer retries the lane. A reload can *)
(* stop the process anywhere: the queue, the listing in flight, the timers *)
(* and the socket are lost; the projection, the cursor, the lane's settled *)
(* mark, the tree watermark, revalidation requests, and staged candidates  *)
(* survive. A later start publishes the cached tree and raises no hint for *)
(* a lane the tree already holds.                                          *)
(*                                                                         *)
(* Peers may also write new documents or edits after a lane settles. When  *)
(* the socket is acknowledged, realtime hints queue the lane; otherwise    *)
(* the hint is lost and the server's container row sits past the device's  *)
(* tree watermark. Two paths catch up on a later start: an acknowledged    *)
(* connection's crawl and sweep, or an unacknowledged start's resume,      *)
(* which runs a watermarked tree crawl to owe moved lanes and lists every  *)
(* owed lane (waiting while a connect attempt is pending so that attempt's *)
(* catch-up never re-lists what the resume listed). While the device stays *)
(* online without an acknowledged connection, a periodic watermarked catch-*)
(* up discovers peer writes made after startup.                            *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Lanes,
  MaxCrashes,
  \* Times verification may defer a candidate before its head is available.
  MaxDeferrals,
  \* Peer writes committed to the server after sign-in.
  MaxPeerWrites,
  \* A start that no acknowledgement catches up queues its owed lanes.
  ResumeOwedOnStart,
  \* A start whose connect attempt is pending leaves the owed lanes to it.
  DeferToAcknowledgement,
  \* The settled mark is written with the applied listing, not on receipt.
  SettleWithApply,
  \* An applied listing that deferred a candidate does not settle its lane.
  SettleOnlyWhenComplete,
  \* An unacknowledged start crawls the tree from its watermark before listing.
  CatchUpSettledOnUnacknowledgedStart,
  \* While unacknowledged after startup, periodic catch-up crawls the tree.
  PollWhileUnacknowledged

ASSUME /\ MaxCrashes \in Nat /\ MaxDeferrals \in Nat /\ MaxPeerWrites \in Nat
       /\ ResumeOwedOnStart \in BOOLEAN /\ DeferToAcknowledgement \in BOOLEAN
       /\ SettleWithApply \in BOOLEAN /\ SettleOnlyWhenComplete \in BOOLEAN
       /\ CatchUpSettledOnUnacknowledgedStart \in BOOLEAN
       /\ PollWhileUnacknowledged \in BOOLEAN

Versions == 0..(1 + MaxPeerWrites)
ServerVersions == 1..(1 + MaxPeerWrites)

VARIABLES
  \* Server-side version per lane (starts at 1 for initial account content).
  serverDoc,
  \* Durable, per lane: highest version applied to projection; document lane
  \* cursor; lane settled mark; staged candidate version; tree watermark;
  \* durable document_lane_revalidations request.
  applied, cursor, settled, staged, treeCursor, revalOwed,
  \* Process-local: process runs; start published the tree; reconcile queue;
  \* lanes of listing in flight and version each page held; armed retry timers.
  up, started, queued, listed, page, retry,
  \* Process-local: socket ("none", "pending", "open"); latched ack before
  \* start; resume machine; whether resume listed while an attempt was pending.
  conn, ackLatched, resume, resumedDuringAttempt,
  \* History: an attempt's catch-up re-listed lanes its start's resume listed;
  \* an unacknowledged start ran resume without crawling moved tree lanes.
  listedTwice, startMissedMove,
  crashes, deferrals, peerWrites

durableVars == <<applied, cursor, settled, staged, treeCursor, revalOwed>>
processVars == <<up, started, queued, listed, page, retry>>
connVars == <<conn, ackLatched, resume, resumedDuringAttempt>>
historyVars == <<listedTwice, startMissedMove>>
budgetVars == <<crashes, deferrals, peerWrites>>
vars == <<serverDoc, durableVars, processVars, connVars, historyVars, budgetVars>>

\* The lane still owes a listing: never settled, holding a staged candidate,
\* or requested by a tree crawl that saw its server container row move.
Owed(l) == ~settled[l] \/ staged[l] > 0 \/ revalOwed[l]
OwedLanes == {l \in Lanes : Owed(l)}
MovedLanes == {l \in Lanes : serverDoc[l] > treeCursor[l]}

TypeOK ==
  /\ serverDoc \in [Lanes -> ServerVersions]
  /\ applied \in [Lanes -> Versions] /\ cursor \in [Lanes -> Versions]
  /\ settled \in [Lanes -> BOOLEAN] /\ staged \in [Lanes -> Versions]
  /\ treeCursor \in [Lanes -> ServerVersions]
  /\ revalOwed \in [Lanes -> BOOLEAN]
  /\ up \in BOOLEAN /\ started \in BOOLEAN
  /\ queued \subseteq Lanes /\ listed \subseteq Lanes /\ retry \subseteq Lanes
  /\ page \in [Lanes -> Versions]
  /\ conn \in {"none", "pending", "open"} /\ ackLatched \in BOOLEAN
  /\ resume \in {"awaiting-hydration", "awaiting-acknowledgement", "done"}
  /\ resumedDuringAttempt \in BOOLEAN
  /\ listedTwice \in BOOLEAN /\ startMissedMove \in BOOLEAN
  /\ crashes \in 0..MaxCrashes /\ deferrals \in 0..MaxDeferrals
  /\ peerWrites \in 0..MaxPeerWrites

\* The sign-in boot learns every lane from the remote tree (version 1), and
\* membership growth queues them all.
Init ==
  /\ serverDoc = [l \in Lanes |-> 1]
  /\ applied = [l \in Lanes |-> 0] /\ cursor = [l \in Lanes |-> 0]
  /\ settled = [l \in Lanes |-> FALSE] /\ staged = [l \in Lanes |-> 0]
  /\ treeCursor = [l \in Lanes |-> 1] /\ revalOwed = [l \in Lanes |-> FALSE]
  /\ up = TRUE /\ started = TRUE /\ queued = Lanes /\ listed = {}
  /\ page = [l \in Lanes |-> 0] /\ retry = {}
  /\ conn = "none" /\ ackLatched = FALSE /\ resume = "done"
  /\ resumedDuringAttempt = FALSE /\ listedTwice = FALSE
  /\ startMissedMove = FALSE
  /\ crashes = 0 /\ deferrals = 0 /\ peerWrites = 0

\* Watermarked tree crawl: advances treeCursor and records durable
\* document_lane_revalidations for every container whose row moved.
CrawlTreeVars ==
  /\ treeCursor' = serverDoc
  /\ revalOwed' = [l \in Lanes |-> revalOwed[l] \/ l \in MovedLanes]

\* The resume catches up an unacknowledged start: crawls the tree when
\* enabled, then lists every owed lane. Listing while an attempt is
\* `connecting` means that attempt's catch-up will list them again.
ResumeOwed(connecting) ==
  LET crawled == CatchUpSettledOnUnacknowledgedStart
      owedNow == {l \in Lanes : Owed(l) \/ (crawled /\ l \in MovedLanes)}
  IN /\ treeCursor' = IF ResumeOwedOnStart /\ crawled THEN serverDoc ELSE treeCursor
     /\ revalOwed' = IF ResumeOwedOnStart /\ crawled
                     THEN [l \in Lanes |-> revalOwed[l] \/ l \in MovedLanes]
                     ELSE revalOwed
     /\ queued' = IF ResumeOwedOnStart THEN queued \cup owedNow ELSE queued
     /\ resumedDuringAttempt' =
          (ResumeOwedOnStart /\ owedNow # {} /\ connecting)
     /\ startMissedMove' =
          (startMissedMove \/ (ResumeOwedOnStart /\ ~crawled /\ MovedLanes # {}))

\* A later start publishes the cached tree: the hydrated signal and one
\* step of the resume machine. An acknowledgement latched before it raises
\* the catch-up, which crawls the tree and lists every lane.
Start ==
  /\ up /\ ~started
  /\ started' = TRUE
  /\ IF ackLatched
       THEN /\ CrawlTreeVars /\ queued' = Lanes /\ resume' = "done"
            /\ ackLatched' = FALSE
            /\ UNCHANGED <<resumedDuringAttempt, startMissedMove>>
       ELSE IF DeferToAcknowledgement /\ conn = "pending"
         THEN /\ resume' = "awaiting-acknowledgement"
              /\ UNCHANGED <<treeCursor, revalOwed, queued, ackLatched,
                             resumedDuringAttempt, startMissedMove>>
         ELSE /\ resume' = "done" /\ ResumeOwed(conn = "pending")
              /\ UNCHANGED ackLatched
  /\ UNCHANGED <<serverDoc, applied, cursor, settled, staged, up, listed,
                 page, retry, conn, listedTwice, budgetVars>>

\* A connect attempt starts. Nothing obliges a device to connect.
Connect ==
  /\ up /\ conn = "none"
  /\ conn' = "pending"
  /\ UNCHANGED <<serverDoc, durableVars, processVars, ackLatched, resume,
                 resumedDuringAttempt, historyVars, budgetVars>>

\* The server acknowledges the interest declaration. After the start, the
\* catch-up crawls the tree and lists every known lane; before it, latches.
Acknowledge ==
  /\ up /\ conn = "pending"
  /\ conn' = "open"
  /\ IF started
       THEN /\ CrawlTreeVars /\ queued' = Lanes
            /\ resume' = IF resume = "awaiting-acknowledgement"
                         THEN "done" ELSE resume
            /\ listedTwice' = (listedTwice \/ resumedDuringAttempt)
            /\ UNCHANGED ackLatched
       ELSE /\ ackLatched' = TRUE
            /\ UNCHANGED <<treeCursor, revalOwed, queued, resume, listedTwice>>
  /\ resumedDuringAttempt' = FALSE
  /\ UNCHANGED <<serverDoc, applied, cursor, settled, staged, up, started,
                 listed, page, retry, startMissedMove, budgetVars>>

\* The attempt ends without an acknowledgement: a ticket or socket failure,
\* or a socket that never declares its interest. A waiting resume runs.
AttemptEnds ==
  /\ up /\ conn = "pending"
  /\ conn' = "none"
  /\ IF started /\ resume = "awaiting-acknowledgement"
       THEN /\ resume' = "done" /\ ResumeOwed(FALSE)
       ELSE /\ resumedDuringAttempt' = FALSE
            /\ UNCHANGED <<treeCursor, revalOwed, queued, resume, startMissedMove>>
  /\ UNCHANGED <<serverDoc, applied, cursor, settled, staged, up, started,
                 listed, page, retry, ackLatched, listedTwice, budgetVars>>

Disconnect ==
  /\ up /\ conn = "open"
  /\ conn' = "none"
  /\ UNCHANGED <<serverDoc, durableVars, processVars, ackLatched, resume,
                 resumedDuringAttempt, historyVars, budgetVars>>

\* A peer writes a new document or edit to a lane. When the device holds an
\* acknowledged connection, a realtime hint queues that lane; otherwise the
\* hint is lost and the container row sits past treeCursor.
PeerWrite(l) ==
  /\ peerWrites < MaxPeerWrites
  /\ serverDoc' = [serverDoc EXCEPT ![l] = @ + 1]
  /\ peerWrites' = peerWrites + 1
  /\ queued' = IF up /\ started /\ conn = "open" THEN queued \cup {l} ELSE queued
  /\ UNCHANGED <<durableVars, up, started, listed, page, retry, connVars,
                 historyVars, crashes, deferrals>>

\* Periodic watermarked catch-up while online without an acknowledged socket.
\* Runs even across flapping reconnect attempts (`conn # "open"`) once the
\* start's resume machine is done so retries cannot starve catch-up.
PollUnacknowledged ==
  /\ PollWhileUnacknowledged
  /\ up /\ started /\ conn # "open" /\ resume = "done"
  /\ MovedLanes # {}
  /\ CrawlTreeVars
  /\ queued' = queued \cup {l \in Lanes : Owed(l) \/ l \in MovedLanes}
  /\ UNCHANGED <<serverDoc, applied, cursor, settled, staged, up, started,
                 listed, page, retry, connVars, historyVars, budgetVars>>

\* One batched listing pages every queued lane from its cursor.
BeginListing ==
  /\ up /\ started /\ queued # {} /\ listed = {}
  /\ listed' = queued /\ queued' = {}
  /\ page' = [l \in Lanes |->
       IF l \in queued
         THEN IF serverDoc[l] > cursor[l] THEN serverDoc[l] ELSE 0
         ELSE page[l]]
  /\ settled' = IF SettleWithApply THEN settled
                ELSE [l \in Lanes |-> settled[l] \/ l \in queued]
  /\ UNCHANGED <<serverDoc, applied, cursor, staged, treeCursor, revalOwed,
                 up, started, retry, connVars, historyVars, budgetVars>>

\* Verification covers the listed document and any staged candidate. When it
\* does not `accept`, the candidate is deferred durably and retried via timer.
Candidate(l) == IF page[l] >= staged[l] THEN page[l] ELSE staged[l]

ApplyLane(l, accept) ==
  /\ up /\ l \in listed
  /\ accept \/ (Candidate(l) > 0 /\ deferrals < MaxDeferrals)
  /\ LET cand == Candidate(l)
         pending == cand > 0 /\ ~accept
         nextCursor == IF page[l] > cursor[l] THEN page[l] ELSE cursor[l]
     IN /\ applied' = [applied EXCEPT ![l] =
              IF cand > 0 /\ accept /\ cand > @ THEN cand ELSE @]
        /\ staged' = [staged EXCEPT ![l] = IF pending THEN cand ELSE 0]
        /\ cursor' = [cursor EXCEPT ![l] = nextCursor]
        /\ settled' = [settled EXCEPT ![l] =
             settled[l] \/ (SettleWithApply /\ (~pending \/ ~SettleOnlyWhenComplete))]
        /\ revalOwed' = [revalOwed EXCEPT ![l] =
             IF ~pending /\ nextCursor >= treeCursor[l] THEN FALSE ELSE @]
        /\ retry' = IF pending THEN retry \cup {l} ELSE retry
        /\ deferrals' = IF pending THEN deferrals + 1 ELSE deferrals
  /\ listed' = listed \ {l}
  /\ UNCHANGED <<serverDoc, treeCursor, up, started, queued, page, connVars,
                 historyVars, crashes, peerWrites>>

\* The in-memory retry timer for a deferred candidate fires.
RetryLane(l) ==
  /\ up /\ l \in retry
  /\ retry' = retry \ {l} /\ queued' = queued \cup {l}
  /\ UNCHANGED <<serverDoc, durableVars, up, started, listed, page, connVars,
                 historyVars, budgetVars>>

\* A reload or process exit, at any point.
Crash ==
  /\ up /\ crashes < MaxCrashes
  /\ up' = FALSE /\ started' = FALSE /\ queued' = {} /\ listed' = {}
  /\ page' = [l \in Lanes |-> 0] /\ retry' = {}
  /\ conn' = "none" /\ ackLatched' = FALSE /\ resume' = "awaiting-hydration"
  /\ resumedDuringAttempt' = FALSE
  /\ crashes' = crashes + 1
  /\ UNCHANGED <<serverDoc, durableVars, historyVars, deferrals, peerWrites>>

Restart ==
  /\ ~up
  /\ up' = TRUE
  /\ UNCHANGED <<serverDoc, durableVars, started, queued, listed, page, retry,
                 connVars, historyVars, budgetVars>>

Next ==
  \/ Start \/ BeginListing \/ PollUnacknowledged \/ Crash \/ Restart
  \/ Connect \/ Acknowledge \/ AttemptEnds \/ Disconnect
  \/ \E l \in Lanes :
       \/ PeerWrite(l)
       \/ RetryLane(l)
       \/ \E accept \in BOOLEAN : ApplyLane(l, accept)
  \* Bounded crash, deferral, and peer-write budgets leave a quiescent state.
  \/ UNCHANGED vars

\* The device's own steps (including periodic unacknowledged catch-up) are
\* fair, and a pending connect attempt resolves. Nothing forces a connect.
Fairness ==
  /\ WF_vars(Start) /\ WF_vars(BeginListing) /\ WF_vars(Restart)
  /\ WF_vars(PollUnacknowledged)
  /\ WF_vars(Acknowledge \/ AttemptEnds)
  /\ \A l \in Lanes :
       /\ WF_vars(RetryLane(l))
       /\ WF_vars(\E accept \in BOOLEAN : ApplyLane(l, accept))

Spec == Init /\ [][Next]_vars /\ Fairness

\* Any lane behind the version its tree crawl observed still owes a listing.
UnappliedLaneIsOwed == \A l \in Lanes : applied[l] < treeCursor[l] => Owed(l)

\* A settled lane without a pending revalidation holds every version its tree
\* crawl observed.
SettledLaneIsApplied ==
  \A l \in Lanes : (settled[l] /\ ~revalOwed[l]) => applied[l] >= treeCursor[l]

\* An attempt's catch-up never re-lists what the same start's resume listed
\* while that attempt was pending. A later connection may list it again.
OwedListedOnce == ~listedTwice

\* An unacknowledged start crawls the tree so settled lanes whose server row
\* moved are owed and queued immediately rather than skipped on resume.
UnacknowledgedStartCoversMovedLanes == ~startMissedMove

\* Once crashes and peer writes stop, every lane's latest document reaches
\* the projection, whether or not any connection is ever acknowledged.
Converges == <>[](\A l \in Lanes : applied[l] = serverDoc[l])

\* Every lane is eventually settled, so later resumes list nothing.
LanesSettle == <>[](\A l \in Lanes : ~Owed(l))
====
