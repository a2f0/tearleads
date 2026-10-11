---------------------------- MODULE SharedCopyReclaim ----------------------------
(* One hydrated storage copy is shared by every slot that holds the same blob
   (#2365 finding #18). Dropping a slot's row queues the copy for a reclaim
   that deletes its bytes only while no row still holds them. *)
EXTENDS Naturals
CONSTANTS Slots, CheckReferences, LockReclaim, CheckPendingReferences,
          QueueLocalRemoval, ResolvePendingRemoval, QueueDroppedPending
ASSUME /\ Slots # {}
       /\ {CheckReferences, LockReclaim, CheckPendingReferences,
           QueueLocalRemoval, ResolvePendingRemoval,
           QueueDroppedPending} \subseteq BOOLEAN
VARIABLES held, pending, remote, viewRemote, viewCopy, bytes, queued, reclaiming,
          removed
vars == <<held, pending, remote, viewRemote, viewCopy, bytes, queued, reclaiming,
          removed>>

Unheld == \A s \in Slots : ~held[s] /\ ~pending[s]
NoCheckedReferences ==
  \A s \in Slots : ~held[s] /\ (~CheckPendingReferences \/ ~pending[s])

Init == /\ held = [s \in Slots |-> FALSE] /\ bytes = FALSE
        /\ pending = [s \in Slots |-> FALSE]
        /\ remote = [s \in Slots |-> TRUE]
        /\ viewRemote = remote /\ viewCopy = held
        /\ queued = FALSE /\ reclaiming = FALSE
        /\ removed = [s \in Slots |-> FALSE]

(* Hydration writes the copy and commits the slot's row under the copy's
   lock, which a reclaim holds from its reference check to its delete. *)
Hydrate(s) ==
  /\ ~held[s] /\ ~pending[s] /\ remote[s]
  /\ ~(LockReclaim /\ reclaiming)
  /\ held' = [held EXCEPT ![s] = TRUE] /\ bytes' = TRUE
  /\ viewCopy' = [viewCopy EXCEPT ![s] = TRUE]
  /\ UNCHANGED <<pending, remote, viewRemote, queued, reclaiming, removed>>

(* Deleting a slot's row queues the copy in the same transaction. *)
Drop(s) ==
  /\ held[s]
  /\ held' = [held EXCEPT ![s] = FALSE] /\ queued' = TRUE
  /\ viewCopy' = [viewCopy EXCEPT ![s] = FALSE]
  /\ UNCHANGED <<pending, remote, viewRemote, bytes, reclaiming, removed>>

(* Reset moves the durable reference to the upload queue without changing its
   storage key. An open store still holds its original copy map. *)
ResetToPending ==
  /\ \E s \in Slots : held[s] /\ remote[s]
  /\ held' = [s \in Slots |-> FALSE]
  /\ pending' = [s \in Slots |-> pending[s] \/ held[s]]
  /\ remote' = [s \in Slots |-> FALSE]
  /\ UNCHANGED <<viewRemote, viewCopy, bytes, queued, reclaiming, removed>>

ReloadIdentity(s) ==
  /\ viewRemote[s] # remote[s]
  /\ viewRemote' = [viewRemote EXCEPT ![s] = remote[s]]
  /\ UNCHANGED <<held, pending, remote, viewCopy, bytes, queued, reclaiming,
                  removed>>

(* A store opened after reset derives its copy map from held rows only, so a
   slot whose only reference became a pending upload has no mapped copy. *)
ColdReload(s) ==
  /\ viewCopy[s] # held[s] \/ viewRemote[s] # remote[s]
  /\ viewCopy' = [viewCopy EXCEPT ![s] = held[s]]
  /\ viewRemote' = [viewRemote EXCEPT ![s] = remote[s]]
  /\ UNCHANGED <<held, pending, remote, bytes, queued, reclaiming, removed>>

(* Removing that slot resolves its key from the pending upload and queues it
   in the removal transaction. *)
ColdRemove(s) ==
  /\ ~viewRemote[s] /\ ~viewCopy[s] /\ pending[s] /\ ~removed[s]
  /\ removed' = [removed EXCEPT ![s] = TRUE]
  /\ pending' = IF ResolvePendingRemoval THEN [pending EXCEPT ![s] = FALSE]
                ELSE pending
  /\ queued' = (queued \/ ResolvePendingRemoval)
  /\ UNCHANGED <<held, remote, viewRemote, viewCopy, bytes, reclaiming>>

(* Startup recovery restores a slot that still has a pending upload. *)
Restart(s) ==
  /\ removed[s] /\ pending[s]
  /\ removed' = [removed EXCEPT ![s] = FALSE]
  /\ UNCHANGED <<held, pending, remote, viewRemote, viewCopy, bytes, queued,
                  reclaiming>>

(* Sync drops an unavailable or superseded pending upload; its row may have
   been the copy's last reference. *)
DropPending(s) ==
  /\ pending[s]
  /\ pending' = [pending EXCEPT ![s] = FALSE]
  /\ queued' = (queued \/ QueueDroppedPending)
  /\ UNCHANGED <<held, remote, viewRemote, viewCopy, bytes, reclaiming, removed>>

(* The old delete-mode follow-up removed bytes immediately, even though the
   durable removal already queued them for reference-checked reclaim. *)
RemoveLocalSlot(s) ==
  /\ ~viewRemote[s] /\ viewCopy[s] /\ pending[s]
  /\ pending' = [pending EXCEPT ![s] = FALSE]
  /\ viewCopy' = [viewCopy EXCEPT ![s] = FALSE]
  /\ queued' = TRUE
  /\ bytes' = IF QueueLocalRemoval THEN bytes ELSE FALSE
  /\ removed' = [removed EXCEPT ![s] = TRUE]
  /\ UNCHANGED <<held, remote, viewRemote, reclaiming>>

(* A copy some row still holds is acknowledged and kept; otherwise the
   reclaim proceeds to delete it. *)
BeginReclaim ==
  /\ queued /\ ~reclaiming
  /\ IF ~CheckReferences \/ NoCheckedReferences
       THEN reclaiming' = TRUE /\ UNCHANGED queued
       ELSE queued' = FALSE /\ UNCHANGED reclaiming
  /\ UNCHANGED <<held, pending, remote, viewRemote, viewCopy, bytes, removed>>

FinishReclaim ==
  /\ reclaiming
  /\ bytes' = FALSE /\ reclaiming' = FALSE /\ queued' = FALSE
  /\ UNCHANGED <<held, pending, remote, viewRemote, viewCopy, removed>>

(* Terminal stuttering after reset and final removal keeps TLC deadlock
   checking enabled for every nonterminal state. *)
Reclaimed == /\ Unheld /\ ~bytes /\ ~queued /\ ~reclaiming
             /\ \A s \in Slots : ~remote[s]
             /\ UNCHANGED vars

Next == (\E s \in Slots : Hydrate(s) \/ Drop(s)
                         \/ ReloadIdentity(s) \/ RemoveLocalSlot(s)
                         \/ ColdReload(s) \/ ColdRemove(s) \/ Restart(s)
                         \/ DropPending(s))
        \/ ResetToPending \/ BeginReclaim \/ FinishReclaim \/ Reclaimed
Spec == Init /\ [][Next]_vars /\ WF_vars(BeginReclaim) /\ WF_vars(FinishReclaim)

TypeOK == /\ {held, pending, remote, viewRemote, viewCopy, removed}
               \subseteq [Slots -> BOOLEAN]
          /\ {bytes, queued, reclaiming} \subseteq BOOLEAN
(* A slot whose row names the copy never loses its bytes: hydration skips a
   slot it already holds, so lost bytes would never be downloaded again. *)
HeldCopyPresent == \A s \in Slots : (held[s] \/ pending[s]) => bytes
(* Removing a copy's last reference queues it in the same step. *)
UnheldCopyQueued == (bytes /\ Unheld) => (queued \/ reclaiming)
(* Every copy nobody holds is eventually deleted, unless a slot takes it back
   first. *)
UnheldCopyReclaimed == (bytes /\ Unheld) ~> (~bytes \/ ~Unheld)
(* A removed slot stays removed; startup recovery must not find its upload. *)
RemovalIsDurable == [][\A s \in Slots : removed[s] => removed'[s]]_vars
=============================================================================
