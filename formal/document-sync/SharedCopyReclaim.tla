---------------------------- MODULE SharedCopyReclaim ----------------------------
(* One hydrated storage copy is shared by every slot that holds the same blob
   (#2365 finding #18). Dropping a slot's row queues the copy for a reclaim
   that deletes its bytes only while no row still holds them. *)
EXTENDS Naturals
CONSTANTS Slots, CheckReferences, LockReclaim
ASSUME /\ Slots # {} /\ {CheckReferences, LockReclaim} \subseteq BOOLEAN
VARIABLES held, bytes, queued, reclaiming
vars == <<held, bytes, queued, reclaiming>>

Unheld == \A s \in Slots : ~held[s]

Init == /\ held = [s \in Slots |-> FALSE] /\ bytes = FALSE
        /\ queued = FALSE /\ reclaiming = FALSE

(* Hydration writes the copy and commits the slot's row under the copy's
   lock, which a reclaim holds from its reference check to its delete. *)
Hydrate(s) ==
  /\ ~held[s] /\ ~(LockReclaim /\ reclaiming)
  /\ held' = [held EXCEPT ![s] = TRUE] /\ bytes' = TRUE
  /\ UNCHANGED <<queued, reclaiming>>

(* Deleting a slot's row queues the copy in the same transaction. *)
Drop(s) ==
  /\ held[s]
  /\ held' = [held EXCEPT ![s] = FALSE] /\ queued' = TRUE
  /\ UNCHANGED <<bytes, reclaiming>>

(* A copy some row still holds is acknowledged and kept; otherwise the
   reclaim proceeds to delete it. *)
BeginReclaim ==
  /\ queued /\ ~reclaiming
  /\ IF ~CheckReferences \/ Unheld
       THEN reclaiming' = TRUE /\ UNCHANGED queued
       ELSE queued' = FALSE /\ UNCHANGED reclaiming
  /\ UNCHANGED <<held, bytes>>

FinishReclaim ==
  /\ reclaiming
  /\ bytes' = FALSE /\ reclaiming' = FALSE /\ queued' = FALSE
  /\ UNCHANGED held

Next == (\E s \in Slots : Hydrate(s) \/ Drop(s)) \/ BeginReclaim \/ FinishReclaim
Spec == Init /\ [][Next]_vars /\ WF_vars(BeginReclaim) /\ WF_vars(FinishReclaim)

TypeOK == /\ held \in [Slots -> BOOLEAN]
          /\ {bytes, queued, reclaiming} \subseteq BOOLEAN
(* A slot whose row names the copy never loses its bytes: hydration skips a
   slot it already holds, so lost bytes would never be downloaded again. *)
HeldCopyPresent == \A s \in Slots : held[s] => bytes
(* A queued copy nobody holds is eventually deleted, unless a slot takes it
   back first. *)
UnheldCopyReclaimed == (queued /\ bytes /\ Unheld) ~> (~bytes \/ ~Unheld)
=============================================================================
