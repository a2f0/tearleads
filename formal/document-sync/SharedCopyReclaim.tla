---------------------------- MODULE SharedCopyReclaim ----------------------------
(* One hydrated storage copy is shared by every slot that holds the same blob
   (#2365 finding #18). Dropping a slot's row queues the copy for a reclaim
   that deletes its bytes only while no row still holds them. *)
EXTENDS Naturals
CONSTANTS Slots, CheckReferences, LockReclaim, CheckPendingReferences,
          QueueLocalRemoval
ASSUME /\ Slots # {}
       /\ {CheckReferences, LockReclaim, CheckPendingReferences,
           QueueLocalRemoval} \subseteq BOOLEAN
VARIABLES held, pending, remote, viewRemote, viewCopy, bytes, queued, reclaiming
vars == <<held, pending, remote, viewRemote, viewCopy, bytes, queued, reclaiming>>

Unheld == \A s \in Slots : ~held[s] /\ ~pending[s]
NoCheckedReferences ==
  \A s \in Slots : ~held[s] /\ (~CheckPendingReferences \/ ~pending[s])

Init == /\ held = [s \in Slots |-> FALSE] /\ bytes = FALSE
        /\ pending = [s \in Slots |-> FALSE]
        /\ remote = [s \in Slots |-> TRUE]
        /\ viewRemote = remote /\ viewCopy = held
        /\ queued = FALSE /\ reclaiming = FALSE

(* Hydration writes the copy and commits the slot's row under the copy's
   lock, which a reclaim holds from its reference check to its delete. *)
Hydrate(s) ==
  /\ ~held[s] /\ ~pending[s] /\ remote[s]
  /\ ~(LockReclaim /\ reclaiming)
  /\ held' = [held EXCEPT ![s] = TRUE] /\ bytes' = TRUE
  /\ viewCopy' = [viewCopy EXCEPT ![s] = TRUE]
  /\ UNCHANGED <<pending, remote, viewRemote, queued, reclaiming>>

(* Deleting a slot's row queues the copy in the same transaction. *)
Drop(s) ==
  /\ held[s]
  /\ held' = [held EXCEPT ![s] = FALSE] /\ queued' = TRUE
  /\ viewCopy' = [viewCopy EXCEPT ![s] = FALSE]
  /\ UNCHANGED <<pending, remote, viewRemote, bytes, reclaiming>>

(* Reset moves the durable reference to the upload queue without changing its
   storage key. An open store still holds its original copy map. *)
ResetToPending ==
  /\ \E s \in Slots : held[s] /\ remote[s]
  /\ held' = [s \in Slots |-> FALSE]
  /\ pending' = [s \in Slots |-> pending[s] \/ held[s]]
  /\ remote' = [s \in Slots |-> FALSE]
  /\ UNCHANGED <<viewRemote, viewCopy, bytes, queued, reclaiming>>

ReloadIdentity(s) ==
  /\ viewRemote[s] # remote[s]
  /\ viewRemote' = [viewRemote EXCEPT ![s] = remote[s]]
  /\ UNCHANGED <<held, pending, remote, viewCopy, bytes, queued, reclaiming>>

(* The old delete-mode follow-up removed bytes immediately, even though the
   durable removal already queued them for reference-checked reclaim. *)
RemoveLocalSlot(s) ==
  /\ ~viewRemote[s] /\ viewCopy[s] /\ pending[s]
  /\ pending' = [pending EXCEPT ![s] = FALSE]
  /\ viewCopy' = [viewCopy EXCEPT ![s] = FALSE]
  /\ queued' = TRUE
  /\ bytes' = IF QueueLocalRemoval THEN bytes ELSE FALSE
  /\ UNCHANGED <<held, remote, viewRemote, reclaiming>>

(* A copy some row still holds is acknowledged and kept; otherwise the
   reclaim proceeds to delete it. *)
BeginReclaim ==
  /\ queued /\ ~reclaiming
  /\ IF ~CheckReferences \/ NoCheckedReferences
       THEN reclaiming' = TRUE /\ UNCHANGED queued
       ELSE queued' = FALSE /\ UNCHANGED reclaiming
  /\ UNCHANGED <<held, pending, remote, viewRemote, viewCopy, bytes>>

FinishReclaim ==
  /\ reclaiming
  /\ bytes' = FALSE /\ reclaiming' = FALSE /\ queued' = FALSE
  /\ UNCHANGED <<held, pending, remote, viewRemote, viewCopy>>

(* Terminal stuttering after reset and final removal keeps TLC deadlock
   checking enabled for every nonterminal state. *)
Reclaimed == /\ Unheld /\ ~bytes /\ ~queued /\ ~reclaiming
             /\ \A s \in Slots : ~remote[s]
             /\ UNCHANGED vars

Next == (\E s \in Slots : Hydrate(s) \/ Drop(s)
                         \/ ReloadIdentity(s) \/ RemoveLocalSlot(s))
        \/ ResetToPending \/ BeginReclaim \/ FinishReclaim \/ Reclaimed
Spec == Init /\ [][Next]_vars /\ WF_vars(BeginReclaim) /\ WF_vars(FinishReclaim)

TypeOK == /\ {held, pending, remote, viewRemote, viewCopy} \subseteq [Slots -> BOOLEAN]
          /\ {bytes, queued, reclaiming} \subseteq BOOLEAN
(* A slot whose row names the copy never loses its bytes: hydration skips a
   slot it already holds, so lost bytes would never be downloaded again. *)
HeldCopyPresent == \A s \in Slots : (held[s] \/ pending[s]) => bytes
(* A queued copy nobody holds is eventually deleted, unless a slot takes it
   back first. *)
UnheldCopyReclaimed == (queued /\ bytes /\ Unheld) ~> (~bytes \/ ~Unheld)
=============================================================================
