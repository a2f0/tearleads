--------------------------- MODULE TransactionLease ---------------------------
EXTENDS Naturals
CONSTANTS MaxTransactions, MaxSteps, IdleBound, WaitBound,
          UseLease, IdleRevocation, SweepDisconnect, RefuseDrops
ASSUME /\ MaxTransactions \in Nat /\ MaxSteps \in Nat
       /\ IdleBound \in Nat \ {0} /\ WaitBound \in Nat \ {0}
       /\ {UseLease, IdleRevocation, SweepDisconnect, RefuseDrops} \subseteq BOOLEAN
(* The idle bound is below the wait bound, so a stalled holder is revoked    *)
(* before a waiter behind it is refused.                                     *)
ASSUME IdleBound < WaitBound
(* Two connections share one SQLite handle in the owner tab's worker. H's    *)
(* tab opens transactions and may freeze (alive, sending nothing) or die     *)
(* (its liveness lock gone). W's tab is alive and wants one statement run,   *)
(* retrying it after each refusal. Time passes in ticks, only while no       *)
(* statement can run; the worker's timer bounds both waits.                  *)
VARIABLES hMode, hConn, hPending, hTransactions, hSteps, txn, idle, swept,
          wPhase, wPending, wWaited, wRefused, foreignRun, ranAfterRefusal
hVars == <<hMode, hConn, hPending, hTransactions, hSteps>>
wVars == <<wPhase, wPending, wWaited, wRefused>>
ghostVars == <<foreignRun, ranAfterRefusal>>
vars == <<hVars, txn, idle, swept, wVars, ghostVars>>

Init ==
  /\ hMode = "alive" /\ hConn = "open" /\ hPending = "none"
  /\ hTransactions = 0 /\ hSteps = 0 /\ txn = "none" /\ idle = 0
  /\ swept = FALSE
  /\ wPhase = "quiet" /\ wPending = FALSE /\ wWaited = 0 /\ wRefused = FALSE
  /\ foreignRun = FALSE /\ ranAfterRefusal = FALSE

(* Under the lease only the holder runs while the handle is in a transaction. *)
WMayRun == ~UseLease \/ txn = "none"
HRunnable == hPending # "none"
WRunnable == wPending /\ WMayRun
(* The holder sent nothing for the idle bound while another statement waits. *)
CanRevoke ==
  /\ IdleRevocation /\ txn = "h" /\ hPending = "none" /\ idle >= IdleBound
  /\ wPending

(* H's tab sends a statement: a BEGIN outside a transaction, or a statement *)
(* or the end of its own. Its arrival restarts the holder's idle clock.     *)
HIssue ==
  /\ hMode = "alive" /\ hConn = "open" /\ hPending = "none"
  /\ \/ /\ txn = "none" /\ hTransactions < MaxTransactions
        /\ hPending' = "begin"
     \/ /\ txn = "h" /\ hSteps < MaxSteps /\ hPending' = "statement"
     \/ /\ txn = "h" /\ hPending' = "end"
  /\ idle' = 0
  /\ UNCHANGED <<hMode, hConn, hTransactions, hSteps, txn, swept, wVars, ghostVars>>
(* The worker runs H's statement; its settling restarts the idle clock.     *)
HRun ==
  /\ HRunnable
  /\ CASE hPending = "begin" ->
            /\ txn' = "h" /\ hTransactions' = hTransactions + 1 /\ hSteps' = 0
       [] hPending = "statement" ->
            /\ hSteps' = hSteps + 1 /\ UNCHANGED <<txn, hTransactions>>
       [] hPending = "end" ->
            /\ txn' = "none" /\ UNCHANGED <<hTransactions, hSteps>>
  /\ hPending' = "none" /\ idle' = 0
  /\ UNCHANGED <<hMode, hConn, swept, wVars, ghostVars>>
HFreeze ==
  /\ hMode = "alive" /\ hMode' = "frozen"
  /\ UNCHANGED <<hConn, hPending, hTransactions, hSteps, txn, idle, swept, wVars, ghostVars>>
HDie ==
  /\ hMode \in {"alive", "frozen"} /\ hMode' = "dead"
  /\ UNCHANGED <<hConn, hPending, hTransactions, hSteps, txn, idle, swept, wVars, ghostVars>>
(* The app reopens a database whose transaction the worker revoked.         *)
HReopen ==
  /\ hMode = "alive" /\ hConn = "revoked" /\ hConn' = "open"
  /\ UNCHANGED <<hMode, hPending, hTransactions, hSteps, txn, idle, swept, wVars, ghostVars>>

WStart ==
  /\ wPhase = "quiet" /\ wPhase' = "wanting"
  /\ UNCHANGED <<hVars, txn, idle, swept, wPending, wWaited, wRefused, ghostVars>>
(* W's tab sends its statement, and again after each refusal.             *)
WIssue ==
  /\ wPhase = "wanting" /\ ~wPending
  /\ wPending' = TRUE /\ wWaited' = 0 /\ wRefused' = FALSE
  /\ UNCHANGED <<hVars, txn, idle, swept, wPhase, ghostVars>>
(* A statement whose busy answer W already saw leaves W still wanting.     *)
WRun ==
  /\ WRunnable
  /\ foreignRun' = (foreignRun \/ txn = "h")
  /\ ranAfterRefusal' = (ranAfterRefusal \/ wRefused)
  /\ wPending' = FALSE /\ wRefused' = FALSE
  /\ wPhase' = IF wRefused THEN wPhase ELSE "done"
  /\ UNCHANGED <<hVars, txn, idle, swept, wWaited>>
(* A statement that waited the bound is answered busy. It never runs later; *)
(* without that rule the answer is sent but the statement stays queued.     *)
WRefuse ==
  /\ wPending /\ ~wRefused /\ ~WMayRun /\ wWaited >= WaitBound /\ ~CanRevoke
  /\ IF RefuseDrops
       THEN /\ wPending' = FALSE /\ UNCHANGED wRefused
       ELSE /\ wRefused' = TRUE /\ UNCHANGED wPending
  /\ UNCHANGED <<hVars, txn, idle, swept, wPhase, wWaited, ghostVars>>
(* The worker rolls the stalled holder back and retires its connection.     *)
Revoke ==
  /\ CanRevoke
  /\ txn' = "none" /\ hConn' = "revoked" /\ idle' = 0
  /\ UNCHANGED <<hMode, hPending, hTransactions, hSteps, swept, wVars, ghostVars>>
(* The owner tab sees the dead tab's liveness lock gone. With the disconnect *)
(* the worker closes its connection, rolling back what it held; without it  *)
(* only the owner's end of the port closes.                                 *)
Sweep ==
  /\ hMode = "dead" /\ ~swept /\ swept' = TRUE
  /\ IF SweepDisconnect /\ hConn = "open"
       THEN /\ hConn' = "closed" /\ hPending' = "none"
            /\ txn' = IF txn = "h" THEN "none" ELSE txn
            /\ idle' = 0
       ELSE UNCHANGED <<hConn, hPending, txn, idle>>
  /\ UNCHANGED <<hMode, hTransactions, hSteps, wVars, ghostVars>>
(* Time passes only while nothing can run.                                  *)
Tick ==
  /\ ~HRunnable /\ ~WRunnable
  /\ wWaited' = IF wPending /\ wWaited < WaitBound THEN wWaited + 1 ELSE wWaited
  /\ idle' = IF txn = "h" /\ idle < IdleBound THEN idle + 1 ELSE idle
  /\ UNCHANGED <<hVars, txn, swept, wPhase, wPending, wRefused, ghostVars>>

Next ==
  \/ HIssue \/ HRun \/ HFreeze \/ HDie \/ HReopen
  \/ WStart \/ WIssue \/ WRun \/ WRefuse \/ Revoke \/ Sweep \/ Tick
(* An alive holder keeps working and ends its transaction; the worker runs  *)
(* what it may, the timer fires, and the owner sweeps dead tabs. A tab may  *)
(* freeze or die at any point, and the waiter may never want anything.      *)
Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(HIssue) /\ WF_vars(HRun) /\ WF_vars(HReopen)
  /\ WF_vars(WIssue) /\ WF_vars(WRun) /\ WF_vars(WRefuse)
  /\ WF_vars(Revoke) /\ WF_vars(Sweep) /\ WF_vars(Tick)

TypeOK ==
  /\ hMode \in {"alive", "frozen", "dead"}
  /\ hConn \in {"open", "revoked", "closed"}
  /\ hPending \in {"none", "begin", "statement", "end"}
  /\ hTransactions \in 0..MaxTransactions /\ hSteps \in 0..MaxSteps
  /\ txn \in {"none", "h"} /\ idle \in 0..IdleBound /\ swept \in BOOLEAN
  /\ wPhase \in {"quiet", "wanting", "done"} /\ wPending \in BOOLEAN
  /\ wWaited \in 0..WaitBound /\ wRefused \in BOOLEAN
  /\ foreignRun \in BOOLEAN /\ ranAfterRefusal \in BOOLEAN
(* No other connection's statement runs inside the holder's transaction.    *)
NoForeignStatementInTransaction == ~foreignRun
(* A connection the worker closed or revoked holds no transaction.          *)
RetiredHolderKeepsNoLease == hConn # "open" => txn # "h"
(* A statement answered busy never runs.                                    *)
RefusedStatementNeverRuns == ~ranAfterRefusal
(* Every waiting statement runs or is refused.                              *)
WaiterSettles == wPending ~> (~wPending \/ wRefused)
(* A dead tab's transaction does not keep the lease.                        *)
DeadHolderReleased == (hMode = "dead" /\ txn = "h") ~> (txn # "h")
(* Retrying after refusals, the waiter's statement eventually runs.         *)
WaiterRuns == (wPhase = "wanting") ~> (wPhase = "done")
=============================================================================
