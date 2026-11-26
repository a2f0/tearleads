---- MODULE SharedDatabaseListing ----
(***************************************************************************)
(* Two runtimes that share one local database, such as two browser tabs,  *)
(* each hold an ordinary document open and catch up with a peer's edit    *)
(* without probing the document on every reconnect.                       *)
(*                                                                         *)
(* The runtimes share what is durable: the lane's watermark, the read a   *)
(* listing owes the document, and the saved record with its processed     *)
(* cursor. Each keeps its own copy of the open document in memory, its    *)
(* own socket, and its own pending work. A listing by either runtime      *)
(* advances the shared watermark, so the other runtime's listing no       *)
(* longer returns the row; a read by either runtime saves the record and  *)
(* settles the shared debt once the cursor covers it.                     *)
(*                                                                         *)
(* A hint reaches a runtime only while its interest is acknowledged. It   *)
(* forces a listing of the lane and a read. An acknowledged connection    *)
(* owes a re-list of the lane from the shared watermark, and that catch-  *)
(* up ends by asking for a read when the shared debt is unsettled, or     *)
(* when the saved record holds content this runtime's copy lacks: the     *)
(* other runtime listed the row, read the edit and settled the debt.      *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS Tabs,
  MaxEdits,
  MaxDisconnects,
  \* Production ends a catch-up by reading a record another runtime saved
  \* past this runtime's open copy.
  PullWhenSavedElsewhere

ASSUME /\ MaxEdits \in Nat /\ MaxDisconnects \in Nat
       /\ PullWhenSavedElsewhere \in BOOLEAN

VARIABLES
  serverVer,     \* how many updates the server holds for the document
  watermark,     \* shared: the row version the lane watermark has passed
  debt,          \* shared: the update count a listing owes a read; 0 if none
  diskVer,       \* shared: the count the saved record and its cursor cover
  mem,           \* the count each runtime's open copy holds
  up,            \* the runtime's interest declaration is acknowledged
  hintList,      \* a hint's forced listing of the lane is still to run
  catchUp,       \* where the runtime's catch-up after an acknowledgement is
  wanted,        \* the runtime's store has been asked to read
  inFlight,      \* a read of the runtime is in flight
  flightVer,     \* the server count that read captured
  flightSawDebt, \* that read found the debt before its request
  disconnects

vars == <<serverVer, watermark, debt, diskVer, mem, up, hintList, catchUp,
          wanted, inFlight, flightVer, flightSawDebt, disconnects>>

flightVars == <<inFlight, flightVer, flightSawDebt>>
sharedVars == <<watermark, debt, diskVer>>

Max(a, b) == IF a >= b THEN a ELSE b

TypeOK ==
  /\ serverVer \in 0..MaxEdits /\ watermark \in 0..MaxEdits
  /\ debt \in 0..MaxEdits /\ diskVer \in 0..MaxEdits
  /\ mem \in [Tabs -> 0..MaxEdits]
  /\ flightVer \in [Tabs -> 0..MaxEdits]
  /\ catchUp \in [Tabs -> {"idle", "list", "ask"}]
  /\ up \in [Tabs -> BOOLEAN] /\ hintList \in [Tabs -> BOOLEAN]
  /\ wanted \in [Tabs -> BOOLEAN] /\ inFlight \in [Tabs -> BOOLEAN]
  /\ flightSawDebt \in [Tabs -> BOOLEAN]
  /\ disconnects \in 0..MaxDisconnects

Init ==
  \* Both runtimes are connected and hold every update.
  /\ serverVer = 0 /\ watermark = 0 /\ debt = 0 /\ diskVer = 0
  /\ mem = [t \in Tabs |-> 0]
  /\ up = [t \in Tabs |-> TRUE]
  /\ hintList = [t \in Tabs |-> FALSE]
  /\ catchUp = [t \in Tabs |-> "idle"]
  /\ wanted = [t \in Tabs |-> FALSE]
  /\ inFlight = [t \in Tabs |-> FALSE]
  /\ flightVer = [t \in Tabs |-> 0]
  /\ flightSawDebt = [t \in Tabs |-> FALSE]
  /\ disconnects = 0

\* A peer's accepted write stores one update and hints each connected
\* runtime, whose hint forces a listing of the lane and a read.
PeerEdit ==
  /\ serverVer < MaxEdits
  /\ serverVer' = serverVer + 1
  /\ hintList' = [t \in Tabs |-> hintList[t] \/ up[t]]
  /\ wanted' = [t \in Tabs |-> wanted[t] \/ up[t]]
  /\ UNCHANGED <<sharedVars, mem, up, catchUp, flightVars, disconnects>>

\* A runtime's socket drops; hints sent meanwhile are lost to it.
Disconnect(t) ==
  /\ up[t] /\ disconnects < MaxDisconnects
  /\ up' = [up EXCEPT ![t] = FALSE]
  /\ disconnects' = disconnects + 1
  /\ UNCHANGED <<serverVer, sharedVars, mem, hintList, catchUp, wanted,
                 flightVars>>

\* The server acknowledges the runtime's interest: a catch-up is owed.
Acknowledge(t) ==
  /\ ~up[t]
  /\ up' = [up EXCEPT ![t] = TRUE]
  /\ catchUp' = [catchUp EXCEPT ![t] = "list"]
  /\ UNCHANGED <<serverVer, sharedVars, mem, hintList, wanted, flightVars,
                 disconnects>>

\* One listing of the lane from the shared watermark. A returned row the
\* saved cursor does not cover owes the document a read, and the listing
\* runtime's store is asked for it. Owing before the watermark passes the
\* row is DocumentListingConvergence's subject; here they are one step.
ListLane(t) ==
  LET owes == watermark < serverVer /\ diskVer < serverVer IN
  /\ watermark' = serverVer
  /\ debt' = IF owes THEN serverVer ELSE debt
  /\ wanted' = [wanted EXCEPT ![t] = @ \/ owes]

\* The listing a hint forced.
HintListing(t) ==
  /\ hintList[t]
  /\ ListLane(t)
  /\ hintList' = [hintList EXCEPT ![t] = FALSE]
  /\ UNCHANGED <<serverVer, diskVer, mem, up, catchUp, flightVars,
                 disconnects>>

\* The re-list an acknowledged connection owes.
CatchUpListing(t) ==
  /\ catchUp[t] = "list"
  /\ ListLane(t)
  /\ catchUp' = [catchUp EXCEPT ![t] = "ask"]
  /\ UNCHANGED <<serverVer, diskVer, mem, up, hintList, flightVars,
                 disconnects>>

\* The catch-up ends: the runtime's store is asked to read when the shared
\* debt is unsettled, or when the saved record is past its open copy.
CatchUpAsk(t) ==
  /\ catchUp[t] = "ask"
  /\ catchUp' = [catchUp EXCEPT ![t] = "idle"]
  /\ wanted' = [wanted EXCEPT ![t] =
       @ \/ debt > 0 \/ (PullWhenSavedElsewhere /\ mem[t] < diskVer)]
  /\ UNCHANGED <<serverVer, sharedVars, mem, up, hintList, flightVars,
                 disconnects>>

\* The store's pull starts: it reads the debt, then requests by the version
\* of its own copy, so the server returns every update the copy lacks.
BeginRead(t) ==
  /\ wanted[t] /\ ~inFlight[t]
  /\ wanted' = [wanted EXCEPT ![t] = FALSE]
  /\ inFlight' = [inFlight EXCEPT ![t] = TRUE]
  /\ flightVer' = [flightVer EXCEPT ![t] = serverVer]
  /\ flightSawDebt' = [flightSawDebt EXCEPT ![t] = debt > 0]
  /\ UNCHANGED <<serverVer, sharedVars, mem, up, hintList, catchUp,
                 disconnects>>

\* The pull completes: the copy and the saved record hold what it read, and
\* the debt it saw is settled once the saved cursor covers the owed count.
\* A save merges into the record's history, so the record never moves back.
FinishRead(t) ==
  LET held == Max(mem[t], flightVer[t])
      saved == Max(diskVer, held) IN
  /\ inFlight[t]
  /\ inFlight' = [inFlight EXCEPT ![t] = FALSE]
  /\ mem' = [mem EXCEPT ![t] = held]
  /\ diskVer' = saved
  /\ debt' = IF flightSawDebt[t] /\ saved >= debt THEN 0 ELSE debt
  /\ UNCHANGED <<serverVer, watermark, up, hintList, catchUp, wanted,
                 flightVer, flightSawDebt, disconnects>>

RuntimeStep(t) ==
  \/ Acknowledge(t) \/ HintListing(t) \/ CatchUpListing(t) \/ CatchUpAsk(t)
  \/ BeginRead(t) \/ FinishRead(t)

Next ==
  \/ PeerEdit
  \/ \E t \in Tabs : Disconnect(t) \/ RuntimeStep(t)
  \/ UNCHANGED vars

Spec ==
  /\ Init /\ [][Next]_vars
  /\ \A t \in Tabs :
       /\ WF_vars(Acknowledge(t)) /\ WF_vars(HintListing(t))
       /\ WF_vars(CatchUpListing(t)) /\ WF_vars(CatchUpAsk(t))
       /\ WF_vars(BeginRead(t)) /\ WF_vars(FinishRead(t))

\* While a connected runtime's open copy is behind the server, something of
\* its own still obliges a read: a pending request, a read in flight that
\* captured the server's count, or a catch-up that has not asked yet. A
\* disconnected runtime owes a catch-up at its next acknowledgement.
OpenCopyEvidenceRetained ==
  \A t \in Tabs :
    mem[t] < serverVer =>
      \/ ~up[t]
      \/ wanted[t]
      \/ catchUp[t] # "idle"
      \/ inFlight[t] /\ flightVer[t] = serverVer

\* Once edits and disconnects stop, every runtime's copy holds every update.
Converges == <>[](\A t \in Tabs : mem[t] = serverVer)

\* Every owed read is eventually settled.
DebtsSettle == debt > 0 ~> debt = 0
====
