-------------------- MODULE OrganizationReadModelStamps --------------------
(* Organization read-model lane stamps (#2522). Each source mutation advances *)
(* the per-organization cursor head and stamps every lane or group it changed *)
(* with the new cursor; a delta from cursor c reloads exactly the entities     *)
(* whose stamp exceeds c. `directory` stands for every lane stamped on the     *)
(* head row in the same update; `group` for a membership stamp on a group row  *)
(* or tombstone, written in a later statement of the same transaction.        *)
(* The directory lane's content also depends on the reader's role: pending   *)
(* leave requests reach only administrators. A change to Admins that flips   *)
(* the reader's role changes what the directory holds for it without any    *)
(* directory row changing, so that change must stamp the directory too.     *)
(* A mutation sends the cursor its client holds and may advance the head a    *)
(* second time in the same transaction, as a group write does (#2903 P11).    *)
(* When the held cursor is the head its first stamp advanced from, the writer *)
(* builds the client's delta inside its own transaction, after its last      *)
(* stamp, and its response carries it with the final cursor.                 *)
EXTENDS Naturals
CONSTANTS SerializeAllocation, StampUnderHeadLock, StampDirectoryOnAdminsChange,
          DeltaAfterLastStamp
ASSUME {SerializeAllocation, StampUnderHeadLock, StampDirectoryOnAdminsChange,
        DeltaAfterLastStamp} \subseteq BOOLEAN

Writers == {"w1", "w2"}
HeadLanes == {"directory"}
GroupRows == {"group"}
Entities == HeadLanes \cup GroupRows
NoLock == "none"
Max(a, b) == IF a > b THEN a ELSE b

(* admin: the reader's current role; promotes[w]: w's mutation is an Admins *)
(* change that flips it; seenAdmin: the role the reader's directory copy was *)
(* served under.                                                             *)
(* held[w]: the client's cursor when w was sent; first[w]: w's first stamp;  *)
(* again[w]: the entities w's second stamp changed (alloc[w] is then its     *)
(* final cursor); built[w]: w's committed delta has been built; dIn, dVer,   *)
(* dAdmin: the entities that delta reloads, their versions, and the role its *)
(* directory was served under; sent[w]: the delta reached the client.        *)
VARIABLES head, stamp, ver, wpc, target, alloc, early, seq, lock, cur, seen,
          admin, promotes, seenAdmin,
          held, first, again, built, dIn, dVer, dAdmin, sent
vars == <<head, stamp, ver, wpc, target, alloc, early, seq, lock, cur, seen,
          admin, promotes, seenAdmin,
          held, first, again, built, dIn, dVer, dAdmin, sent>>
writerVars == <<wpc, target, alloc, early, seq, promotes>>
deltaVars == <<held, first, again, built, dIn, dVer, dAdmin, sent>>

Init ==
  /\ head = 0 /\ stamp = [e \in Entities |-> 0] /\ ver = [e \in Entities |-> 0]
  /\ wpc = [w \in Writers |-> "idle"] /\ target = [w \in Writers |-> {}]
  /\ alloc = [w \in Writers |-> 0] /\ early = [w \in Writers |-> 0]
  /\ seq = 0 /\ lock = NoLock
  /\ cur = 0 /\ seen = [e \in Entities |-> 0]
  /\ admin = FALSE /\ promotes = [w \in Writers |-> FALSE] /\ seenAdmin = FALSE
  /\ held = [w \in Writers |-> 0] /\ first = [w \in Writers |-> 0]
  /\ again = [w \in Writers |-> {}] /\ built = [w \in Writers |-> FALSE]
  /\ dIn = [w \in Writers |-> {}] /\ dVer = [w \in Writers |-> [e \in Entities |-> 0]]
  /\ dAdmin = [w \in Writers |-> FALSE] /\ sent = [w \in Writers |-> FALSE]

(* A mutation starts and writes uncommitted domain rows. The negative controls *)
(* allocate its cursor from a sequence or read the head for a group stamp here, *)
(* before holding the head row lock.                                           *)
(* An Admins change is a group membership change; with the audience rule  *)
(* it stamps the directory as well. The request carries the client's cursor. *)
Begin(w, changed, flipsRole) ==
  /\ wpc[w] = "idle"
  /\ wpc' = [wpc EXCEPT ![w] = "open"]
  /\ promotes' = [promotes EXCEPT ![w] = flipsRole]
  /\ target' = [target EXCEPT ![w] =
       IF flipsRole
         THEN changed \cup GroupRows \cup
                (IF StampDirectoryOnAdminsChange THEN HeadLanes ELSE {})
         ELSE changed]
  /\ alloc' = [alloc EXCEPT ![w] = IF SerializeAllocation THEN 0 ELSE seq + 1]
  /\ seq' = IF SerializeAllocation THEN seq ELSE seq + 1
  /\ early' = [early EXCEPT ![w] = head + 1]
  /\ held' = [held EXCEPT ![w] = cur]
  /\ UNCHANGED <<head, stamp, ver, lock, cur, seen, admin, seenAdmin,
                  first, again, built, dIn, dVer, dAdmin, sent>>

(* `advanceOrganizationReadModelHead`: one update increments the cursor and    *)
(* stamps head-row lanes; it takes the exclusive row lock, so it waits for a   *)
(* reader's shared lock and for any other writer until commit.                 *)
AdvanceHead(w) ==
  /\ wpc[w] = "open" /\ lock = NoLock
  /\ lock' = w
  /\ wpc' = [wpc EXCEPT ![w] = "locked"]
  /\ alloc' = [alloc EXCEPT ![w] = IF SerializeAllocation THEN head + 1
                                   ELSE alloc[w]]
  /\ first' = [first EXCEPT ![w] = alloc'[w]]
  /\ UNCHANGED <<head, stamp, ver, target, early, seq, cur, seen, promotes,
                  admin, seenAdmin, held, again, built, dIn, dVer, dAdmin, sent>>

(* A group write's second advance in the same transaction, still under the  *)
(* head row lock: the organization policy's lanes after the group's. Only    *)
(* the negative control builds the delta before it.                         *)
AdvanceAgain(w, changed) ==
  /\ lock = w /\ again[w] = {}
  /\ wpc[w] = "locked" \/ (~DeltaAfterLastStamp /\ wpc[w] = "built")
  /\ again' = [again EXCEPT ![w] = changed]
  /\ alloc' = [alloc EXCEPT ![w] = alloc[w] + 1]
  /\ UNCHANGED <<head, stamp, ver, wpc, target, early, seq, lock, cur, seen,
                  admin, promotes, seenAdmin, held, first, built, dIn, dVer,
                  dAdmin, sent>>

GroupStamp(w) == IF StampUnderHeadLock THEN first[w] ELSE early[w]

(* The stamp and version an entity holds once w commits, as w's own          *)
(* transaction already sees them.                                            *)
WriterStamp(w, e) ==
  IF e \in again[w] THEN alloc[w]
  ELSE IF e \notin target[w] THEN stamp[e]
  ELSE IF e \in GroupRows THEN GroupStamp(w) ELSE first[w]
WriterVer(w, e) ==
  IF e \in target[w] \cup again[w] THEN ver[e] + 1 ELSE ver[e]
WriterAdmin(w) == IF promotes[w] THEN ~admin ELSE admin

(* `loadCommittedReadModelDeltaInTransaction`: only when the held cursor is  *)
(* the head before the first stamp, read every entity stamped after it as    *)
(* the writer's own transaction sees it, under the reader's role there.      *)
BuildDelta(w) ==
  /\ wpc[w] = "locked" /\ lock = w
  /\ wpc' = [wpc EXCEPT ![w] = "built"]
  /\ built' = [built EXCEPT ![w] = held[w] + 1 = first[w]]
  /\ dIn' = [dIn EXCEPT ![w] = {e \in Entities : WriterStamp(w, e) > held[w]}]
  /\ dVer' = [dVer EXCEPT ![w] = [e \in Entities |-> WriterVer(w, e)]]
  /\ dAdmin' = [dAdmin EXCEPT ![w] = WriterAdmin(w)]
  /\ UNCHANGED <<head, stamp, ver, target, alloc, early, seq, lock, cur, seen,
                  admin, promotes, seenAdmin, held, first, again, sent>>

(* Commit publishes domain rows, the head, and every stamp atomically; the   *)
(* response carries a delta that was built, with the final cursor.           *)
Commit(w) ==
  /\ wpc[w] \in {"locked", "built"} /\ lock = w
  /\ head' = Max(head, alloc[w])
  /\ stamp' = [e \in Entities |-> WriterStamp(w, e)]
  /\ ver' = [e \in Entities |-> WriterVer(w, e)]
  /\ admin' = WriterAdmin(w)
  /\ lock' = NoLock
  /\ wpc' = [wpc EXCEPT ![w] = "done"]
  /\ sent' = [sent EXCEPT ![w] = built[w]]
  /\ UNCHANGED <<target, alloc, early, seq, cur, seen, promotes, seenAdmin,
                  held, first, again, built, dIn, dVer, dAdmin>>

(* A rolled-back mutation leaves no head advance, stamp, or domain change, *)
(* and its response carries no delta.                                      *)
Abort(w) ==
  /\ wpc[w] \in {"open", "locked", "built"}
  /\ lock' = IF lock = w THEN NoLock ELSE lock
  /\ wpc' = [wpc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<head, stamp, ver, target, alloc, early, seq, cur, seen,
                  promotes, admin, seenAdmin, deltaVars>>

(* `loadDeltaResponse` under the shared head lock, applied by the client in    *)
(* one transaction: reload every entity stamped after the cursor, then adopt   *)
(* the head as the next cursor. Hints only trigger this; any may be lost.      *)
(* The directory is served under the reader's role at the time of the read. *)
Reconcile ==
  /\ lock = NoLock
  /\ seen' = [e \in Entities |-> IF stamp[e] > cur THEN ver[e] ELSE seen[e]]
  /\ seenAdmin' = IF stamp["directory"] > cur THEN admin ELSE seenAdmin
  /\ cur' = head
  /\ UNCHANGED <<head, stamp, ver, lock, writerVars, admin, deltaVars>>

(* `applyCommittedOrganizationReadModel`: the client applies the delta its *)
(* own response carried only while it still holds the cursor it sent, at   *)
(* any time after the response, or never.                                  *)
ApplyDelta(w) ==
  /\ sent[w] /\ cur = held[w]
  /\ seen' = [e \in Entities |-> IF e \in dIn[w] THEN dVer[w][e] ELSE seen[e]]
  /\ seenAdmin' = IF "directory" \in dIn[w] THEN dAdmin[w] ELSE seenAdmin
  /\ cur' = alloc[w]
  /\ sent' = [sent EXCEPT ![w] = FALSE]
  /\ UNCHANGED <<head, stamp, ver, lock, writerVars, admin, held, first, again,
                  built, dIn, dVer, dAdmin>>

Next ==
  \/ \E w \in Writers, changed \in (SUBSET Entities) \ {{}}, flipsRole \in BOOLEAN:
       Begin(w, changed, flipsRole)
  \/ \E w \in Writers, changed \in (SUBSET Entities) \ {{}}:
       AdvanceAgain(w, changed)
  \/ \E w \in Writers:
       AdvanceHead(w) \/ BuildDelta(w) \/ Commit(w) \/ Abort(w) \/ ApplyDelta(w)
  \/ Reconcile

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ head \in 0..4 /\ seq \in 0..2 /\ cur \in 0..4
  /\ stamp \in [Entities -> 0..4] /\ ver \in [Entities -> 0..2]
  /\ seen \in [Entities -> 0..2]
  /\ wpc \in [Writers -> {"idle", "open", "locked", "built", "done"}]
  /\ target \in [Writers -> SUBSET Entities]
  /\ alloc \in [Writers -> 0..4] /\ early \in [Writers -> 0..5]
  /\ lock \in Writers \cup {NoLock}
  /\ admin \in BOOLEAN /\ seenAdmin \in BOOLEAN
  /\ promotes \in [Writers -> BOOLEAN]
  /\ held \in [Writers -> 0..4] /\ first \in [Writers -> 0..4]
  /\ again \in [Writers -> SUBSET Entities] /\ built \in [Writers -> BOOLEAN]
  /\ dIn \in [Writers -> SUBSET Entities]
  /\ dVer \in [Writers -> [Entities -> 0..2]]
  /\ dAdmin \in [Writers -> BOOLEAN] /\ sent \in [Writers -> BOOLEAN]

(* A cursor covering an entity's last stamp implies the client holds that   *)
(* change: no delta can skip a change the cursor claims.                      *)
CursorCoversChanges ==
  \A e \in Entities: stamp[e] <= cur => seen[e] = ver[e]
(* A client at the head cursor holds the server's current projection. *)
CaughtUpClientIsCurrent ==
  cur = head => \A e \in Entities: seen[e] = ver[e]
(* A caught-up reader's directory was served under its current role, so a  *)
(* new administrator holds the pending requests.                           *)
CaughtUpDirectoryMatchesRole ==
  cur = head => seenAdmin = admin
=============================================================================
