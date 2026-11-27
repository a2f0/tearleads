---- MODULE CatchUpCoordination ----
(***************************************************************************)
(* The catch-up state machine (`catchUpMachine.ts`) coordinates unforced  *)
(* document-lane listings around the tree crawl an acknowledged           *)
(* connection owes.                                                       *)
(*                                                                         *)
(* While a catch-up waits for its crawl (`awaitingCrawl`) or its turn     *)
(* among sweeps (`awaitingTurn`), unforced listings of lanes known at the *)
(* acknowledgement are deferred, unless the user opened the lane or the   *)
(* lane was already owed. A stuck sweep ahead in line triggers a bounded  *)
(* timeout (`overdue`) that ends deferral immediately. An acknowledgement *)
(* arriving while `awaitingCrawl` shares the wait and clears the lanes    *)
(* listed since; an acknowledgement arriving while `awaitingTurn` or      *)
(* `overdue` supersedes the earlier wait with a fresh one.                *)
(*                                                                         *)
(* When a crawl is incomplete and the sweep falls back to listing every   *)
(* known lane, it may skip a lane cleanly listed since the latest         *)
(* acknowledgement (`listedSince`). A listing sent before an              *)
(* acknowledgement, or before a `pendingDiscovery` retry bumped the       *)
(* lane's `pendingGen`, must never mark the lane as vouched for fallback. *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS MaxAcks,
  MaxPending,
  MaxListings,
  \* Production accepts a `listed` event only for the current wait and
  \* latest acknowledgement count.
  CheckAckOnListed,
  \* Production accepts a `listed` event only while the lane's
  \* `pendingGenerations` matches what it was when the listing was sent.
  CheckPendingGenOnListed,
  \* Production ends deferral once `turnOverdue` moves the catch-up to `overdue`.
  OverdueEndsDeferral,
  \* Production ignores `turnTaken` from a superseded wait.
  CheckWaitOnTurnTaken

ASSUME /\ MaxAcks \in Nat /\ MaxPending \in Nat /\ MaxListings \in Nat
       /\ CheckAckOnListed \in BOOLEAN
       /\ CheckPendingGenOnListed \in BOOLEAN
       /\ OverdueEndsDeferral \in BOOLEAN
       /\ CheckWaitOnTurnTaken \in BOOLEAN

VARIABLES
  status,         \* "idle" | "awaitingCrawl" | "awaitingTurn" | "overdue"
  waitId,         \* identifier of the active wait; 0 when idle
  nextWait,       \* next wait identifier
  acks,           \* acknowledgements served by the active wait
  totalAcks,      \* budget counter for acknowledgements
  listedNow,      \* known lane was opened or already owed -> not deferred
  listedSince,    \* known lane cleanly listed since latest acknowledgement
  listedSinceAck, \* acknowledgement count when `listedSince` was set
  pendingGen,     \* per-container generation bumped on `pendingDiscovery`
  pendingEvents,  \* budget counter for `pendingDiscovery`
  pendingRetry,   \* a pending discovery retry is outstanding for the lane
  staleWait,      \* an earlier wait whose sweep has not fired `turnTaken` yet
  droppedWait,    \* a superseded wait's `turnTaken` dropped the active wait
  listing,        \* a listing batch for the lane is in flight
  listWait,       \* waitId captured when that listing was sent
  listAck,        \* acks captured when that listing was sent
  listPendingGen, \* pendingGen captured when that listing was sent
  listings        \* budget counter for listings

vars == <<status, waitId, nextWait, acks, totalAcks, listedNow, listedSince,
          listedSinceAck, pendingGen, pendingEvents, pendingRetry, staleWait,
          droppedWait, listing, listWait, listAck, listPendingGen, listings>>

listVars == <<listing, listWait, listAck, listPendingGen, listings>>

MaxWaits == MaxAcks + 1

TypeOK ==
  /\ status \in {"idle", "awaitingCrawl", "awaitingTurn", "overdue"}
  /\ waitId \in 0..MaxWaits /\ nextWait \in 1..(MaxWaits + 1)
  /\ acks \in 0..MaxAcks /\ totalAcks \in 0..MaxAcks
  /\ listedSinceAck \in 0..MaxAcks
  /\ pendingGen \in 0..MaxPending /\ pendingEvents \in 0..MaxPending
  /\ staleWait \in 0..MaxWaits
  /\ listWait \in 0..MaxWaits /\ listAck \in 0..MaxAcks
  /\ listPendingGen \in 0..MaxPending /\ listings \in 0..MaxListings
  /\ {listedNow, listedSince, pendingRetry, droppedWait, listing} \subseteq BOOLEAN

Init ==
  /\ status = "idle" /\ waitId = 0 /\ nextWait = 1
  /\ acks = 0 /\ totalAcks = 0
  /\ listedNow = FALSE /\ listedSince = FALSE /\ listedSinceAck = 0
  /\ pendingGen = 0 /\ pendingEvents = 0 /\ pendingRetry = FALSE
  /\ staleWait = 0 /\ droppedWait = FALSE
  /\ listing = FALSE /\ listWait = 0 /\ listAck = 0 /\ listPendingGen = 0
  /\ listings = 0

\* Whether the catch-up currently defers an unforced listing of the known lane.
Defers ==
  /\ (status \in {"awaitingCrawl", "awaitingTurn"}
        \/ (~OverdueEndsDeferral /\ status = "overdue"))
  /\ ~listedNow

\* An acknowledged connection arrives (`acknowledged`).
Acknowledged ==
  /\ totalAcks < MaxAcks
  /\ totalAcks' = totalAcks + 1
  /\ IF status = "awaitingCrawl"
       THEN /\ acks' = acks + 1
            /\ listedSince' = FALSE /\ listedSinceAck' = 0
            /\ pendingGen' = 0
            /\ UNCHANGED <<status, waitId, nextWait, listedNow, staleWait>>
       ELSE /\ status' = "awaitingCrawl"
            /\ staleWait' = IF status \in {"awaitingTurn", "overdue"}
                              THEN waitId ELSE staleWait
            /\ waitId' = nextWait /\ nextWait' = nextWait + 1
            /\ acks' = 1
            /\ listedNow' = FALSE /\ listedSince' = FALSE /\ listedSinceAck' = 0
            /\ pendingGen' = 0
  /\ UNCHANGED <<pendingEvents, pendingRetry, droppedWait, listVars>>

\* The tree crawl finishes (`crawlSettled` for the current wait).
CrawlSettled ==
  /\ status = "awaitingCrawl"
  /\ status' = "awaitingTurn"
  /\ UNCHANGED <<waitId, nextWait, acks, totalAcks, listedNow, listedSince,
                 listedSinceAck, pendingGen, pendingEvents, pendingRetry,
                 staleWait, droppedWait, listVars>>

\* The turn timer expires while awaiting a turn (`turnOverdue`).
TurnOverdue ==
  /\ status = "awaitingTurn"
  /\ status' = "overdue"
  /\ listedNow' = FALSE
  /\ UNCHANGED <<waitId, nextWait, acks, totalAcks, listedSince,
                 listedSinceAck, pendingGen, pendingEvents, pendingRetry,
                 staleWait, droppedWait, listVars>>

\* User opens the lane or it was already owed (`opened` / `alreadyOwed`).
OpenedOrAlreadyOwed ==
  /\ status \in {"awaitingCrawl", "awaitingTurn"} /\ ~listedNow
  /\ listedNow' = TRUE
  /\ UNCHANGED <<status, waitId, nextWait, acks, totalAcks, listedSince,
                 listedSinceAck, pendingGen, pendingEvents, pendingRetry,
                 staleWait, droppedWait, listVars>>

\* A listing batch is sent for the lane, capturing the catch-up snapshot.
BeginListing ==
  /\ status # "idle" /\ ~listing /\ listings < MaxListings
  /\ listing' = TRUE /\ listings' = listings + 1
  /\ listWait' = waitId /\ listAck' = acks /\ listPendingGen' = pendingGen
  /\ UNCHANGED <<status, waitId, nextWait, acks, totalAcks, listedNow,
                 listedSince, listedSinceAck, pendingGen, pendingEvents,
                 pendingRetry, staleWait, droppedWait>>

\* A listing leaves a candidate pending or its retry timer fires (`pendingDiscovery`).
PendingDiscovery ==
  /\ status # "idle" /\ pendingEvents < MaxPending
  /\ pendingEvents' = pendingEvents + 1
  /\ pendingGen' = pendingGen + 1
  /\ pendingRetry' = TRUE
  /\ listedSince' = FALSE /\ listedSinceAck' = 0
  /\ UNCHANGED <<status, waitId, nextWait, acks, totalAcks, listedNow,
                 staleWait, droppedWait, listVars>>

\* The in-flight listing completes cleanly (`listed`).
FinishListing ==
  /\ listing
  /\ listing' = FALSE
  /\ LET sameWait == status # "idle" /\ listWait = waitId
         sameAck == ~CheckAckOnListed \/ listAck = acks
         samePending == ~CheckPendingGenOnListed \/ listPendingGen = pendingGen
     IN /\ IF sameWait /\ sameAck /\ samePending
             THEN listedSince' = TRUE /\ listedSinceAck' = listAck
             ELSE UNCHANGED <<listedSince, listedSinceAck>>
        /\ IF sameWait /\ listAck = acks /\ listPendingGen = pendingGen
             THEN pendingRetry' = FALSE
             ELSE UNCHANGED pendingRetry
  /\ UNCHANGED <<status, waitId, nextWait, acks, totalAcks, listedNow,
                 pendingGen, pendingEvents, staleWait, droppedWait, listWait,
                 listAck, listPendingGen, listings>>

\* The active wait's sweep takes its turn (`turnTaken` for the current wait).
TurnTaken ==
  /\ status \in {"awaitingTurn", "overdue"}
  /\ status' = "idle" /\ waitId' = 0 /\ acks' = 0
  /\ listedNow' = FALSE /\ listedSince' = FALSE /\ listedSinceAck' = 0
  /\ pendingGen' = 0 /\ pendingRetry' = FALSE
  /\ UNCHANGED <<nextWait, totalAcks, pendingEvents, staleWait, droppedWait,
                 listVars>>

\* A superseded wait's sweep reaches `turnTaken` late.
StaleTurnTaken ==
  /\ staleWait > 0
  /\ staleWait' = 0
  /\ IF ~CheckWaitOnTurnTaken /\ status # "idle"
       THEN /\ status' = "idle" /\ waitId' = 0 /\ acks' = 0
            /\ listedNow' = FALSE /\ listedSince' = FALSE /\ listedSinceAck' = 0
            /\ pendingGen' = 0 /\ droppedWait' = TRUE
       ELSE UNCHANGED <<status, waitId, acks, listedNow, listedSince,
                        listedSinceAck, pendingGen, droppedWait>>
  /\ UNCHANGED <<nextWait, totalAcks, pendingEvents, pendingRetry, listVars>>

Next ==
  \/ Acknowledged \/ CrawlSettled \/ TurnOverdue \/ OpenedOrAlreadyOwed
  \/ BeginListing \/ PendingDiscovery \/ FinishListing
  \/ TurnTaken \/ StaleTurnTaken
  \/ UNCHANGED vars

\* A crawl may take time, and a sweep ahead in line may be stuck so TurnTaken
\* is not forced while awaitingTurn; TurnOverdue bounds that wait.
Fairness ==
  /\ WF_vars(CrawlSettled)
  /\ WF_vars(TurnOverdue)
  /\ WF_vars(FinishListing)

Spec == Init /\ [][Next]_vars /\ Fairness

\* A lane vouched for the incomplete-crawl fallback was cleanly listed after
\* the latest acknowledgement with no pending discovery retry outstanding.
VouchIsFresh ==
  listedSince => (status # "idle" /\ listedSinceAck = acks /\ ~pendingRetry)

\* A superseded wait's late `turnTaken` never drops the active wait.
ActiveWaitSurvivesStaleTurn == ~droppedWait

\* No lane is deferred forever: even if the sweep turn never arrives,
\* `TurnOverdue` ends deferral.
DeferralEnds == Defers ~> ~Defers
====
