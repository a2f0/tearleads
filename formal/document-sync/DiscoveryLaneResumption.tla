---- MODULE DiscoveryLaneResumption ----
(***************************************************************************)
(* A device signs in and lists the document lanes of the containers it     *)
(* learns about. One batched listing pages every queued lane from its      *)
(* cursor; the lanes then verify and apply one at a time. Verification may *)
(* defer a document whose signed head is not yet available: the candidate  *)
(* is staged durably and an in-memory timer retries the lane. A reload can *)
(* stop the process anywhere: the queue, the listing in flight and the     *)
(* timers are lost; the projection, the cursor, the lane's settled mark    *)
(* and the staged candidates survive. A later start publishes the cached   *)
(* tree and raises no hint for a lane the tree already holds, so only the  *)
(* durable state can say that a lane still owes a listing.                 *)
(*                                                                         *)
(* Each lane holds one document the device lacks. The server's documents   *)
(* are fixed: the account's content exists before this device signs in.    *)
(* Peer writes after that reach a lane through hints, a visit or a         *)
(* reconnect sweep, which this model leaves out.                           *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS Lanes,
  MaxCrashes,
  \* Times verification may defer a candidate before its head is available.
  MaxDeferrals,
  \* A start queues every lane its durable state still owes a listing.
  ResumeOwedOnStart,
  \* The settled mark is written with the applied listing, not on receipt.
  SettleWithApply,
  \* An applied listing that deferred a candidate does not settle its lane.
  SettleOnlyWhenComplete

ASSUME /\ MaxCrashes \in Nat /\ MaxDeferrals \in Nat
       /\ ResumeOwedOnStart \in BOOLEAN /\ SettleWithApply \in BOOLEAN
       /\ SettleOnlyWhenComplete \in BOOLEAN

VARIABLES
  \* Durable, per lane: the document is in the local projection; the cursor
  \* has passed it; the lane row carries its settled mark; a candidate waits
  \* in the staged-discovery table.
  applied, cursor, settled, staged,
  \* Process-local: the process runs; its start has published the tree; the
  \* reconcile queue; the lanes of the listing in flight and whether each
  \* page held the document; the lanes whose retry timer is armed.
  up, started, queued, listed, page, retry,
  crashes, deferrals

durableVars == <<applied, cursor, settled, staged>>
processVars == <<up, started, queued, listed, page, retry>>
vars == <<durableVars, processVars, crashes, deferrals>>

\* The lane still owes a listing: it was never settled, or it holds a
\* staged candidate.
Owed(l) == ~settled[l] \/ staged[l]

TypeOK ==
  /\ applied \in [Lanes -> BOOLEAN] /\ cursor \in [Lanes -> BOOLEAN]
  /\ settled \in [Lanes -> BOOLEAN] /\ staged \in [Lanes -> BOOLEAN]
  /\ up \in BOOLEAN /\ started \in BOOLEAN
  /\ queued \subseteq Lanes /\ listed \subseteq Lanes /\ retry \subseteq Lanes
  /\ page \in [Lanes -> BOOLEAN]
  /\ crashes \in 0..MaxCrashes /\ deferrals \in 0..MaxDeferrals

\* The sign-in boot learns every lane from the remote tree, and membership
\* growth queues them all.
Init ==
  /\ applied = [l \in Lanes |-> FALSE] /\ cursor = [l \in Lanes |-> FALSE]
  /\ settled = [l \in Lanes |-> FALSE] /\ staged = [l \in Lanes |-> FALSE]
  /\ up = TRUE /\ started = TRUE /\ queued = Lanes /\ listed = {}
  /\ page = [l \in Lanes |-> FALSE] /\ retry = {}
  /\ crashes = 0 /\ deferrals = 0

\* A later start publishes the cached tree: the `hydrated` signal.
Start ==
  /\ up /\ ~started
  /\ started' = TRUE
  /\ queued' = IF ResumeOwedOnStart THEN {l \in Lanes : Owed(l)} ELSE {}
  /\ UNCHANGED <<durableVars, up, listed, page, retry, crashes, deferrals>>

\* One batched listing pages every queued lane from its cursor.
BeginListing ==
  /\ up /\ started /\ queued # {} /\ listed = {}
  /\ listed' = queued /\ queued' = {}
  /\ page' = [l \in Lanes |-> IF l \in queued THEN ~cursor[l] ELSE page[l]]
  /\ settled' = IF SettleWithApply THEN settled
                ELSE [l \in Lanes |-> settled[l] \/ l \in queued]
  /\ UNCHANGED <<applied, cursor, staged, up, started, retry, crashes,
                 deferrals>>

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
  /\ UNCHANGED <<up, started, queued, page, crashes>>

\* The in-memory retry timer for a deferred candidate fires.
RetryLane(l) ==
  /\ up /\ l \in retry
  /\ retry' = retry \ {l} /\ queued' = queued \cup {l}
  /\ UNCHANGED <<durableVars, up, started, listed, page, crashes, deferrals>>

\* A reload or process exit, at any point.
Crash ==
  /\ up /\ crashes < MaxCrashes
  /\ up' = FALSE /\ started' = FALSE /\ queued' = {} /\ listed' = {}
  /\ page' = [l \in Lanes |-> FALSE] /\ retry' = {}
  /\ crashes' = crashes + 1
  /\ UNCHANGED <<durableVars, deferrals>>

Restart ==
  /\ ~up
  /\ up' = TRUE
  /\ UNCHANGED <<durableVars, started, queued, listed, page, retry, crashes,
                 deferrals>>

Next ==
  \/ Start \/ BeginListing \/ Crash \/ Restart
  \/ \E l \in Lanes : RetryLane(l) \/ \E accept \in BOOLEAN : ApplyLane(l, accept)
  \* The bounded crash and deferral budgets leave a quiescent end state.
  \/ UNCHANGED vars

Fairness ==
  /\ WF_vars(Start) /\ WF_vars(BeginListing) /\ WF_vars(Restart)
  /\ \A l \in Lanes :
       /\ WF_vars(RetryLane(l))
       /\ WF_vars(\E accept \in BOOLEAN : ApplyLane(l, accept))

Spec == Init /\ [][Next]_vars /\ Fairness

\* A lane whose document is missing still owes a listing, durably.
UnappliedLaneIsOwed == \A l \in Lanes : ~applied[l] => Owed(l)

\* The settled mark means the lane's documents are in the projection.
SettledLaneIsApplied == \A l \in Lanes : settled[l] => applied[l]

\* Once crashes stop, every lane's document reaches the projection.
Converges == <>[](\A l \in Lanes : applied[l])

\* Every lane is eventually settled, so later starts list nothing.
LanesSettle == <>[](\A l \in Lanes : ~Owed(l))
====
