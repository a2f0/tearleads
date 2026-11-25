---- MODULE DiscoveryLaneResumption ----
(***************************************************************************)
(* A device signs in and lists the document lanes of the containers it     *)
(* learns about. One batched listing pages every queued lane from its      *)
(* cursor; the lanes then verify and apply one at a time. Verification may *)
(* defer a document whose signed head is not yet available: the candidate  *)
(* is staged durably and an in-memory timer retries the lane. A reload can *)
(* stop the process anywhere: the queue, the listing in flight, the timers *)
(* and the socket are lost; the projection, the cursor, the lane's settled *)
(* mark and the staged candidates survive. A later start publishes the     *)
(* cached tree and raises no hint for a lane the tree already holds.       *)
(*                                                                         *)
(* Two things list lanes at a later start. The catch-up after an           *)
(* acknowledged connection lists every known lane, but a connect attempt   *)
(* may end without an acknowledgement, and a device may not connect at     *)
(* all. A resume lists the lanes the durable state says are still owed.    *)
(* It waits while an attempt is pending, so a start lists an owed lane     *)
(* once: in the acknowledgement's catch-up, or in the resume when the      *)
(* attempt ends without one.                                               *)
(*                                                                         *)
(* Each lane holds one document the device lacks. The server's documents   *)
(* are fixed: the account's content exists before this device signs in.    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Lanes,
  MaxCrashes,
  \* Times verification may defer a candidate before its head is available.
  MaxDeferrals,
  \* A start that no acknowledgement catches up queues its owed lanes.
  ResumeOwedOnStart,
  \* A start whose connect attempt is pending leaves the owed lanes to it.
  DeferToAcknowledgement,
  \* The settled mark is written with the applied listing, not on receipt.
  SettleWithApply,
  \* An applied listing that deferred a candidate does not settle its lane.
  SettleOnlyWhenComplete

ASSUME /\ MaxCrashes \in Nat /\ MaxDeferrals \in Nat
       /\ ResumeOwedOnStart \in BOOLEAN /\ DeferToAcknowledgement \in BOOLEAN
       /\ SettleWithApply \in BOOLEAN /\ SettleOnlyWhenComplete \in BOOLEAN

VARIABLES
  \* Durable, per lane: the document is in the local projection; the cursor
  \* has passed it; the lane row carries its settled mark; a candidate waits
  \* in the staged-discovery table.
  applied, cursor, settled, staged,
  \* Process-local: the process runs; its start has published the tree; the
  \* reconcile queue; the lanes of the listing in flight and whether each
  \* page held the document; the lanes whose retry timer is armed.
  up, started, queued, listed, page, retry,
  \* Process-local: the socket ("none", "pending" while a connect attempt
  \* awaits its acknowledgement, "open"); an acknowledgement that arrived
  \* before the start; the resume machine; and whether the resume listed
  \* owed lanes while the current attempt was pending.
  conn, ackLatched, resume, resumedDuringAttempt,
  \* History: one attempt's catch-up re-listed lanes its start's resume had
  \* already listed.
  listedTwice,
  crashes, deferrals

durableVars == <<applied, cursor, settled, staged>>
processVars == <<up, started, queued, listed, page, retry>>
connVars == <<conn, ackLatched, resume, resumedDuringAttempt>>
vars == <<durableVars, processVars, connVars, listedTwice, crashes, deferrals>>

\* The lane still owes a listing: it was never settled, or it holds a
\* staged candidate.
Owed(l) == ~settled[l] \/ staged[l]
OwedLanes == {l \in Lanes : Owed(l)}

TypeOK ==
  /\ applied \in [Lanes -> BOOLEAN] /\ cursor \in [Lanes -> BOOLEAN]
  /\ settled \in [Lanes -> BOOLEAN] /\ staged \in [Lanes -> BOOLEAN]
  /\ up \in BOOLEAN /\ started \in BOOLEAN
  /\ queued \subseteq Lanes /\ listed \subseteq Lanes /\ retry \subseteq Lanes
  /\ page \in [Lanes -> BOOLEAN]
  /\ conn \in {"none", "pending", "open"} /\ ackLatched \in BOOLEAN
  /\ resume \in {"awaiting-hydration", "awaiting-acknowledgement", "done"}
  /\ resumedDuringAttempt \in BOOLEAN /\ listedTwice \in BOOLEAN
  /\ crashes \in 0..MaxCrashes /\ deferrals \in 0..MaxDeferrals

\* The sign-in boot learns every lane from the remote tree, and membership
\* growth queues them all.
Init ==
  /\ applied = [l \in Lanes |-> FALSE] /\ cursor = [l \in Lanes |-> FALSE]
  /\ settled = [l \in Lanes |-> FALSE] /\ staged = [l \in Lanes |-> FALSE]
  /\ up = TRUE /\ started = TRUE /\ queued = Lanes /\ listed = {}
  /\ page = [l \in Lanes |-> FALSE] /\ retry = {}
  /\ conn = "none" /\ ackLatched = FALSE /\ resume = "done"
  /\ resumedDuringAttempt = FALSE /\ listedTwice = FALSE
  /\ crashes = 0 /\ deferrals = 0

\* The resume queues the owed lanes. Listing them while an attempt is
\* `connecting` means that attempt's catch-up will list them again.
ResumeOwed(connecting) ==
  /\ queued' = IF ResumeOwedOnStart THEN queued \cup OwedLanes ELSE queued
  /\ resumedDuringAttempt' =
       (ResumeOwedOnStart /\ OwedLanes # {} /\ connecting)

\* A later start publishes the cached tree: the hydrated signal and one
\* step of the resume machine. An acknowledgement latched before it raises
\* the catch-up, which lists every lane.
Start ==
  /\ up /\ ~started
  /\ started' = TRUE
  /\ IF ackLatched
       THEN /\ queued' = Lanes /\ resume' = "done" /\ ackLatched' = FALSE
            /\ UNCHANGED resumedDuringAttempt
       ELSE IF DeferToAcknowledgement /\ conn = "pending"
         THEN /\ resume' = "awaiting-acknowledgement"
              /\ UNCHANGED <<queued, ackLatched, resumedDuringAttempt>>
         ELSE /\ resume' = "done" /\ ResumeOwed(conn = "pending")
              /\ UNCHANGED ackLatched
  /\ UNCHANGED <<durableVars, up, listed, page, retry, conn, listedTwice,
                 crashes, deferrals>>

\* A connect attempt starts. Nothing obliges a device to connect.
Connect ==
  /\ up /\ conn = "none"
  /\ conn' = "pending"
  /\ UNCHANGED <<durableVars, processVars, ackLatched, resume,
                 resumedDuringAttempt, listedTwice, crashes, deferrals>>

\* The server acknowledges the interest declaration. After the start, the
\* catch-up lists every known lane; before it, the acknowledgement latches.
Acknowledge ==
  /\ up /\ conn = "pending"
  /\ conn' = "open"
  /\ IF started
       THEN /\ queued' = Lanes
            /\ resume' = IF resume = "awaiting-acknowledgement"
                         THEN "done" ELSE resume
            /\ listedTwice' = (listedTwice \/ resumedDuringAttempt)
            /\ UNCHANGED ackLatched
       ELSE /\ ackLatched' = TRUE
            /\ UNCHANGED <<queued, resume, listedTwice>>
  /\ resumedDuringAttempt' = FALSE
  /\ UNCHANGED <<durableVars, up, started, listed, page, retry, crashes,
                 deferrals>>

\* The attempt ends without an acknowledgement: a ticket or socket failure,
\* or a socket that never declares its interest. A waiting resume runs.
AttemptEnds ==
  /\ up /\ conn = "pending"
  /\ conn' = "none"
  /\ IF started /\ resume = "awaiting-acknowledgement"
       THEN /\ resume' = "done" /\ ResumeOwed(FALSE)
       ELSE /\ resumedDuringAttempt' = FALSE
            /\ UNCHANGED <<queued, resume>>
  /\ UNCHANGED <<durableVars, up, started, listed, page, retry, ackLatched,
                 listedTwice, crashes, deferrals>>

Disconnect ==
  /\ up /\ conn = "open"
  /\ conn' = "none"
  /\ UNCHANGED <<durableVars, processVars, ackLatched, resume,
                 resumedDuringAttempt, listedTwice, crashes, deferrals>>

\* One batched listing pages every queued lane from its cursor. A later
\* start's reconciler takes up to four lanes per run; the model folds those
\* runs into one listing, since a lane a reload leaves unlisted stays owed.
BeginListing ==
  /\ up /\ started /\ queued # {} /\ listed = {}
  /\ listed' = queued /\ queued' = {}
  /\ page' = [l \in Lanes |-> IF l \in queued THEN ~cursor[l] ELSE page[l]]
  /\ settled' = IF SettleWithApply THEN settled
                ELSE [l \in Lanes |-> settled[l] \/ l \in queued]
  /\ UNCHANGED <<applied, cursor, staged, up, started, retry, connVars,
                 listedTwice, crashes, deferrals>>

\* Verification covers the listed document and any staged candidate. When
\* it does not `accept`, the candidate is deferred: staged durably, with the
\* lane's retry timer armed. The cursor and the settled mark are written in
\* one statement after the lane applies.
Candidate(l) == page[l] \/ staged[l]

ApplyLane(l, accept) ==
  /\ up /\ l \in listed
  /\ accept \/ (Candidate(l) /\ deferrals < MaxDeferrals)
  /\ LET pending == Candidate(l) /\ ~accept
     IN /\ applied' = [applied EXCEPT ![l] = applied[l] \/ (Candidate(l) /\ accept)]
        /\ staged' = [staged EXCEPT ![l] = pending]
        /\ cursor' = [cursor EXCEPT ![l] = cursor[l] \/ page[l]]
        /\ settled' = [settled EXCEPT ![l] =
             settled[l] \/ (SettleWithApply /\ (~pending \/ ~SettleOnlyWhenComplete))]
        /\ retry' = IF pending THEN retry \cup {l} ELSE retry
        /\ deferrals' = IF pending THEN deferrals + 1 ELSE deferrals
  /\ listed' = listed \ {l}
  /\ UNCHANGED <<up, started, queued, page, connVars, listedTwice, crashes>>

\* The in-memory retry timer for a deferred candidate fires.
RetryLane(l) ==
  /\ up /\ l \in retry
  /\ retry' = retry \ {l} /\ queued' = queued \cup {l}
  /\ UNCHANGED <<durableVars, up, started, listed, page, connVars,
                 listedTwice, crashes, deferrals>>

\* A reload or process exit, at any point.
Crash ==
  /\ up /\ crashes < MaxCrashes
  /\ up' = FALSE /\ started' = FALSE /\ queued' = {} /\ listed' = {}
  /\ page' = [l \in Lanes |-> FALSE] /\ retry' = {}
  /\ conn' = "none" /\ ackLatched' = FALSE /\ resume' = "awaiting-hydration"
  /\ resumedDuringAttempt' = FALSE
  /\ crashes' = crashes + 1
  /\ UNCHANGED <<durableVars, listedTwice, deferrals>>

Restart ==
  /\ ~up
  /\ up' = TRUE
  /\ UNCHANGED <<durableVars, started, queued, listed, page, retry, connVars,
                 listedTwice, crashes, deferrals>>

Next ==
  \/ Start \/ BeginListing \/ Crash \/ Restart
  \/ Connect \/ Acknowledge \/ AttemptEnds \/ Disconnect
  \/ \E l \in Lanes : RetryLane(l) \/ \E accept \in BOOLEAN : ApplyLane(l, accept)
  \* The bounded crash and deferral budgets leave a quiescent end state.
  \/ UNCHANGED vars

\* The device's own steps are fair, and a pending connect attempt resolves:
\* it is acknowledged or it ends. Nothing makes the device connect.
Fairness ==
  /\ WF_vars(Start) /\ WF_vars(BeginListing) /\ WF_vars(Restart)
  /\ WF_vars(Acknowledge \/ AttemptEnds)
  /\ \A l \in Lanes :
       /\ WF_vars(RetryLane(l))
       /\ WF_vars(\E accept \in BOOLEAN : ApplyLane(l, accept))

Spec == Init /\ [][Next]_vars /\ Fairness

\* A lane whose document is missing still owes a listing, durably.
UnappliedLaneIsOwed == \A l \in Lanes : ~applied[l] => Owed(l)

\* The settled mark means the lane's documents are in the projection.
SettledLaneIsApplied == \A l \in Lanes : settled[l] => applied[l]

\* A start lists an owed lane once: an attempt's catch-up never re-lists
\* what the same start's resume listed while that attempt was pending.
OwedListedOnce == ~listedTwice

\* Once crashes stop, every lane's document reaches the projection, whether
\* or not any connection is ever acknowledged.
Converges == <>[](\A l \in Lanes : applied[l])

\* Every lane is eventually settled, so later resumes list nothing.
LanesSettle == <>[](\A l \in Lanes : ~Owed(l))
====
