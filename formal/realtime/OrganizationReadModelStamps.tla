-------------------- MODULE OrganizationReadModelStamps --------------------
(* Organization read-model lane stamps and held hints (#2522). Each source   *)
(* mutation advances the per-organization cursor head and stamps every lane  *)
(* or group it changed with the new cursor; a delta from cursor c reloads    *)
(* exactly the entities whose stamp exceeds c. `directory` stands for every  *)
(* lane stamped on the head row in the same update; `group` for a membership *)
(* stamp on a group row or tombstone, written later in the same transaction. *)
(* Commits publish lossy hints. While the client's own mutation is active,   *)
(* delivered hints are held; releasing them may skip the feed request only   *)
(* when a completed pass was sent after the latest held hint arrived.        *)
EXTENDS Naturals
CONSTANTS SerializeAllocation, StampUnderHeadLock, ReleaseChecksCoverage,
          CoverFromSend, CoverOnlyOnSuccess
ASSUME {SerializeAllocation, StampUnderHeadLock, ReleaseChecksCoverage,
        CoverFromSend, CoverOnlyOnSuccess} \subseteq BOOLEAN

Writers == {"w1", "w2"}
GroupRows == {"group"}
Entities == {"directory"} \cup GroupRows
NoLock == "none"
Max(a, b) == IF a > b THEN a ELSE b

VARIABLES head, stamp, ver, wpc, target, alloc, early, seq, lock,
          cur, seen, inflight, hintSeq, heldSeq, coveredSeq, dirty, mutating,
          req, reqSeq, reqDirty, snapHead, snapSeen, lostCursor, failed
server == <<head, stamp, ver, wpc, target, alloc, early, seq, lock>>
client == <<cur, seen, inflight, hintSeq, heldSeq, coveredSeq, dirty,
            mutating, req, reqSeq, reqDirty, snapHead, snapSeen, lostCursor,
            failed>>
vars == <<server, client>>
writerVars == <<wpc, target, alloc, early, seq>>

Init ==
  /\ head = 0 /\ stamp = [e \in Entities |-> 0] /\ ver = [e \in Entities |-> 0]
  /\ wpc = [w \in Writers |-> "idle"] /\ target = [w \in Writers |-> {}]
  /\ alloc = [w \in Writers |-> 0] /\ early = [w \in Writers |-> 0]
  /\ seq = 0 /\ lock = NoLock
  /\ cur = 0 /\ seen = [e \in Entities |-> 0]
  /\ inflight = FALSE /\ hintSeq = 0 /\ heldSeq = 0 /\ coveredSeq = 0
  /\ dirty = FALSE /\ mutating = "before"
  /\ req = "idle" /\ reqSeq = 0 /\ reqDirty = FALSE /\ snapHead = 0
  /\ snapSeen = [e \in Entities |-> 0] /\ lostCursor = 0 /\ failed = FALSE

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
  /\ UNCHANGED <<head, stamp, ver, lock, client>>

(* One update increments the cursor and stamps head-row lanes; it takes the  *)
(* exclusive row lock, so it waits for a reader's shared lock and for any    *)
(* other writer until commit.                                                *)
AdvanceHead(w) ==
  /\ wpc[w] = "open" /\ lock = NoLock
  /\ lock' = w
  /\ wpc' = [wpc EXCEPT ![w] = "locked"]
  /\ alloc' = [alloc EXCEPT ![w] = IF SerializeAllocation THEN head + 1
                                   ELSE alloc[w]]
  /\ UNCHANGED <<head, stamp, ver, target, early, seq, client>>

GroupStamp(w) == IF StampUnderHeadLock THEN alloc[w] ELSE early[w]

(* Commit publishes domain rows, the head, and every stamp atomically; the   *)
(* lossy hint is published afterwards.                                       *)
Commit(w) ==
  /\ wpc[w] = "locked" /\ lock = w
  /\ head' = Max(head, alloc[w])
  /\ stamp' = [e \in Entities |->
                 IF e \notin target[w] THEN stamp[e]
                 ELSE IF e \in GroupRows THEN GroupStamp(w) ELSE alloc[w]]
  /\ ver' = [e \in Entities |-> IF e \in target[w] THEN ver[e] + 1 ELSE ver[e]]
  /\ lock' = NoLock
  /\ wpc' = [wpc EXCEPT ![w] = "done"]
  /\ inflight' = TRUE
  /\ UNCHANGED <<target, alloc, early, seq, cur, seen, hintSeq, heldSeq,
                 coveredSeq, dirty, mutating, req, reqSeq, reqDirty, snapHead,
                 snapSeen, lostCursor, failed>>

(* A rolled-back mutation leaves no head advance, stamp, change, or hint. *)
Abort(w) ==
  /\ wpc[w] \in {"open", "locked"}
  /\ lock' = IF lock = w THEN NoLock ELSE lock
  /\ wpc' = [wpc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<head, stamp, ver, target, alloc, early, seq, client>>

clientRest == <<cur, seen, coveredSeq, req, reqSeq, reqDirty, snapHead,
                snapSeen>>

(* Coalesced hints arrive. While the client's mutation is active they are   *)
(* held with their arrival number; otherwise they schedule one feed pass.   *)
Deliver ==
  /\ inflight
  /\ inflight' = FALSE
  /\ hintSeq' = hintSeq + 1
  /\ IF mutating = "active"
       THEN heldSeq' = hintSeq + 1 /\ dirty' = dirty
       ELSE heldSeq' = heldSeq /\ dirty' = TRUE
  /\ UNCHANGED <<server, clientRest, mutating, lostCursor, failed>>

(* Hints are lossy; a lost hint excuses staleness until the client catches *)
(* up to the head it announced.                                             *)
Lose ==
  /\ inflight
  /\ inflight' = FALSE
  /\ lostCursor' = head
  /\ UNCHANGED <<server, clientRest, hintSeq, heldSeq, dirty, mutating,
                 failed>>

StartMutation ==
  /\ mutating = "before"
  /\ mutating' = "active"
  /\ UNCHANGED <<server, clientRest, inflight, hintSeq, heldSeq, dirty,
                 lostCursor, failed>>

(* Releasing held hints schedules a pass unless a completed pass was sent  *)
(* after the latest of them arrived.                                       *)
EndMutation ==
  /\ mutating = "active"
  /\ mutating' = "after"
  /\ heldSeq' = 0
  /\ dirty' = (dirty \/ (heldSeq # 0 /\ ReleaseChecksCoverage
                         /\ heldSeq > coveredSeq))
  /\ UNCHANGED <<server, clientRest, inflight, hintSeq, lostCursor, failed>>

(* A feed request is sent for a scheduled pass, or as the explicit         *)
(* post-mutation pass, which may run at any point of the mutation window.  *)
(* It consumes a scheduled trigger but leaves held hints held.             *)
Send ==
  /\ req = "idle" /\ (dirty \/ mutating = "active")
  /\ req' = "sent"
  /\ reqSeq' = hintSeq
  /\ reqDirty' = dirty
  /\ dirty' = FALSE
  /\ UNCHANGED <<server, cur, seen, coveredSeq, snapHead, snapSeen, inflight,
                 hintSeq, heldSeq, mutating, lostCursor, failed>>

(* The server reads the head, stamps, and stamped lanes under the shared    *)
(* head lock, after the request was sent.                                  *)
Read ==
  /\ req = "sent" /\ lock = NoLock
  /\ req' = "read"
  /\ snapHead' = head
  /\ snapSeen' = [e \in Entities |-> IF stamp[e] > cur THEN ver[e] ELSE seen[e]]
  /\ UNCHANGED <<server, cur, seen, coveredSeq, reqSeq, reqDirty, inflight,
                 hintSeq, heldSeq, dirty, mutating, lostCursor, failed>>

(* The client applies the page and cursor in one transaction and records   *)
(* that every hint received before the request was sent is covered.        *)
Finish ==
  /\ req = "read"
  /\ req' = "idle"
  /\ cur' = snapHead /\ seen' = snapSeen
  /\ coveredSeq' = Max(coveredSeq, IF CoverFromSend THEN reqSeq ELSE hintSeq)
  /\ failed' = FALSE
  /\ UNCHANGED <<server, reqSeq, reqDirty, snapHead, snapSeen, inflight,
                 hintSeq, heldSeq, dirty, mutating, lostCursor>>

(* A failed request keeps the last-known-good projection and covers no held *)
(* hint. If it consumed a scheduled trigger, the client waits for the next  *)
(* one; a failed explicit pass consumed nothing, so held hints still fire.  *)
Fail ==
  /\ req \in {"sent", "read"}
  /\ req' = "idle"
  /\ failed' = (failed \/ reqDirty)
  /\ coveredSeq' = IF CoverOnlyOnSuccess THEN coveredSeq
                   ELSE Max(coveredSeq, IF CoverFromSend THEN reqSeq ELSE hintSeq)
  /\ UNCHANGED <<server, cur, seen, reqSeq, reqDirty, snapHead, snapSeen,
                 inflight, hintSeq, heldSeq, dirty, mutating, lostCursor>>

Next ==
  \/ \E w \in Writers, changed \in (SUBSET Entities) \ {{}}: Begin(w, changed)
  \/ \E w \in Writers: AdvanceHead(w) \/ Commit(w) \/ Abort(w)
  \/ Deliver \/ Lose \/ StartMutation \/ EndMutation
  \/ Send \/ Read \/ Finish \/ Fail
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ head \in 0..2 /\ seq \in 0..2 /\ cur \in 0..2 /\ snapHead \in 0..2
  /\ stamp \in [Entities -> 0..2] /\ ver \in [Entities -> 0..2]
  /\ seen \in [Entities -> 0..2] /\ snapSeen \in [Entities -> 0..2]
  /\ wpc \in [Writers -> {"idle", "open", "locked", "done"}]
  /\ target \in [Writers -> SUBSET Entities]
  /\ alloc \in [Writers -> 0..2] /\ early \in [Writers -> 0..3]
  /\ lock \in Writers \cup {NoLock}
  /\ inflight \in BOOLEAN /\ dirty \in BOOLEAN /\ failed \in BOOLEAN
  /\ reqDirty \in BOOLEAN
  /\ {hintSeq, heldSeq, coveredSeq, reqSeq} \subseteq 0..2
  /\ mutating \in {"before", "active", "after"}
  /\ req \in {"idle", "sent", "read"} /\ lostCursor \in 0..2

(* A cursor covering an entity's last stamp implies the client holds that   *)
(* change: no delta can skip a change the cursor claims.                      *)
CursorCoversChanges ==
  \A e \in Entities: stamp[e] <= cur => seen[e] = ver[e]
(* A client at the head cursor holds the server's current projection. *)
CaughtUpClientIsCurrent ==
  cur = head => \A e \in Entities: seen[e] = ver[e]
(* A client behind a committed change still has a hint, held hint, owed or  *)
(* in-flight pass to catch up, unless a hint was lost or a failed pass      *)
(* consumed the scheduled trigger.                                          *)
BehindClientHasTrigger ==
  (\E e \in Entities: stamp[e] > cur) =>
    \/ inflight \/ heldSeq # 0 \/ dirty \/ req # "idle"
    \/ cur < lostCursor \/ failed
=============================================================================
