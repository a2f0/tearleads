-------------------- MODULE OrganizationReadModelStamps --------------------
(* Organization read-model lane stamps (#2522). Each source mutation advances *)
(* the per-organization cursor head and stamps every lane or group it changed *)
(* with the new cursor; a delta from cursor c reloads exactly the entities     *)
(* whose stamp exceeds c. `directory` stands for every lane stamped on the     *)
(* head row in the same update; `group` for a membership stamp on a group row  *)
(* or tombstone, written in a later statement of the same transaction.        *)
EXTENDS Naturals
CONSTANTS SerializeAllocation, StampUnderHeadLock
ASSUME {SerializeAllocation, StampUnderHeadLock} \subseteq BOOLEAN

Writers == {"w1", "w2"}
HeadLanes == {"directory"}
GroupRows == {"group"}
Entities == HeadLanes \cup GroupRows
NoLock == "none"
Max(a, b) == IF a > b THEN a ELSE b

VARIABLES head, stamp, ver, wpc, target, alloc, early, seq, lock, cur, seen
vars == <<head, stamp, ver, wpc, target, alloc, early, seq, lock, cur, seen>>
writerVars == <<wpc, target, alloc, early, seq>>

Init ==
  /\ head = 0 /\ stamp = [e \in Entities |-> 0] /\ ver = [e \in Entities |-> 0]
  /\ wpc = [w \in Writers |-> "idle"] /\ target = [w \in Writers |-> {}]
  /\ alloc = [w \in Writers |-> 0] /\ early = [w \in Writers |-> 0]
  /\ seq = 0 /\ lock = NoLock
  /\ cur = 0 /\ seen = [e \in Entities |-> 0]

(* A mutation starts and writes uncommitted domain rows. The negative controls *)
(* allocate its cursor from a sequence or read the head for a group stamp here, *)
(* before holding the head row lock.                                           *)
Begin(w, changed) ==
  /\ wpc[w] = "idle"
  /\ wpc' = [wpc EXCEPT ![w] = "open"]
  /\ target' = [target EXCEPT ![w] = changed]
  /\ alloc' = [alloc EXCEPT ![w] = IF SerializeAllocation THEN 0 ELSE seq + 1]
  /\ seq' = IF SerializeAllocation THEN seq ELSE seq + 1
  /\ early' = [early EXCEPT ![w] = head + 1]
  /\ UNCHANGED <<head, stamp, ver, lock, cur, seen>>

(* `advanceOrganizationReadModelHead`: one update increments the cursor and    *)
(* stamps head-row lanes; it takes the exclusive row lock, so it waits for a   *)
(* reader's shared lock and for any other writer until commit.                 *)
AdvanceHead(w) ==
  /\ wpc[w] = "open" /\ lock = NoLock
  /\ lock' = w
  /\ wpc' = [wpc EXCEPT ![w] = "locked"]
  /\ alloc' = [alloc EXCEPT ![w] = IF SerializeAllocation THEN head + 1
                                   ELSE alloc[w]]
  /\ UNCHANGED <<head, stamp, ver, target, early, seq, cur, seen>>

GroupStamp(w) == IF StampUnderHeadLock THEN alloc[w] ELSE early[w]

(* Commit publishes domain rows, the head, and every stamp atomically. *)
Commit(w) ==
  /\ wpc[w] = "locked" /\ lock = w
  /\ head' = Max(head, alloc[w])
  /\ stamp' = [e \in Entities |->
                 IF e \notin target[w] THEN stamp[e]
                 ELSE IF e \in GroupRows THEN GroupStamp(w) ELSE alloc[w]]
  /\ ver' = [e \in Entities |-> IF e \in target[w] THEN ver[e] + 1 ELSE ver[e]]
  /\ lock' = NoLock
  /\ wpc' = [wpc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<target, alloc, early, seq, cur, seen>>

(* A rolled-back mutation leaves no head advance, stamp, or domain change. *)
Abort(w) ==
  /\ wpc[w] \in {"open", "locked"}
  /\ lock' = IF lock = w THEN NoLock ELSE lock
  /\ wpc' = [wpc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<head, stamp, ver, target, alloc, early, seq, cur, seen>>

(* `loadDeltaResponse` under the shared head lock, applied by the client in    *)
(* one transaction: reload every entity stamped after the cursor, then adopt   *)
(* the head as the next cursor. Hints only trigger this; any may be lost.      *)
Reconcile ==
  /\ lock = NoLock
  /\ seen' = [e \in Entities |-> IF stamp[e] > cur THEN ver[e] ELSE seen[e]]
  /\ cur' = head
  /\ UNCHANGED <<head, stamp, ver, lock, writerVars>>

Next ==
  \/ \E w \in Writers, changed \in (SUBSET Entities) \ {{}}: Begin(w, changed)
  \/ \E w \in Writers: AdvanceHead(w) \/ Commit(w) \/ Abort(w)
  \/ Reconcile

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ head \in 0..2 /\ seq \in 0..2 /\ cur \in 0..2
  /\ stamp \in [Entities -> 0..2] /\ ver \in [Entities -> 0..2]
  /\ seen \in [Entities -> 0..2]
  /\ wpc \in [Writers -> {"idle", "open", "locked", "done"}]
  /\ target \in [Writers -> SUBSET Entities]
  /\ alloc \in [Writers -> 0..2] /\ early \in [Writers -> 0..3]
  /\ lock \in Writers \cup {NoLock}

(* A cursor covering an entity's last stamp implies the client holds that   *)
(* change: no delta can skip a change the cursor claims.                      *)
CursorCoversChanges ==
  \A e \in Entities: stamp[e] <= cur => seen[e] = ver[e]
(* A client at the head cursor holds the server's current projection. *)
CaughtUpClientIsCurrent ==
  cur = head => \A e \in Entities: seen[e] = ver[e]
=============================================================================
