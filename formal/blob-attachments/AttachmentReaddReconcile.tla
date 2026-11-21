---------------------- MODULE AttachmentReaddReconcile ----------------------
CONSTANTS OwnBindingOnly, RecheckAfterDetach, SettleOnCommitted
ASSUME {OwnBindingOnly, RecheckAfterDetach, SettleOnCommitted}
         \subseteq BOOLEAN

(* One slot this device removed from a synced document, whose detach marker
   (a detached row naming the held copy and the blob it was bound as) is still
   pending. Another device can add the slot back with the same bytes or with
   other bytes: it binds its own blob first and sends the content update that
   records the slot afterwards. A concurrent merge can also bring the slot
   back with no new binding. A pane can stage a re-add that rolls back, and
   the detach worker checks, dispatches, and settles the marker in separate
   steps. `binding` is the slot's active binding: the marker's own blob,
   another device's, or none. *)
VARIABLES committed, staged, row, binding, bytes, queued, worker, target,
          remote
vars == <<committed, staged, row, binding, bytes, queued, worker, target,
          remote>>

Slots == {"removed", "same", "other"}
Rows == {"detached", "live", "none"}
Bindings == {"mine", "theirs", "none"}
Workers == {"idle", "dispatching", "settling"}
Remotes == {"idle", "same", "other", "done", "merged"}

Init == /\ committed = "removed" /\ staged = FALSE /\ row = "detached"
        /\ binding = "mine" /\ bytes = TRUE /\ queued = FALSE
        /\ worker = "idle" /\ target = "none" /\ remote = "idle"

(* What a settle reads: committed history, or (negative control) the live
   document of a pane that holds a staged re-add. *)
View == IF ~SettleOnCommitted /\ staged THEN "same" ELSE committed

(* observeMarkerBinding over the fresh listing. The negative control owns
   whatever binding is active, as the old pass did. *)
From == CASE binding = "none" -> "remoteDetached"
          [] binding = "mine" \/ ~OwnBindingOnly -> "awaitingDetach"
          [] OTHER -> "bindingReplaced"

(* attachmentRemovalMarkerMachine.ts from an open state. *)
Settle(from, view) ==
  CASE row = "none" -> "superseded"
    [] view = "removed" ->
         IF from = "awaitingDetach" THEN "awaitingDetach" ELSE "dropped"
    [] view = "same" ->
         IF from = "remoteDetached" THEN "rebinding" ELSE "held"
    [] OTHER -> IF row = "detached" THEN "dropped" ELSE "held"

(* attachmentMarkerRowEffect applied to the marker copy's row. *)
RowAfter(next) ==
  CASE next = "awaitingDetach" -> "detached"
    [] next \in {"held", "rebinding"} -> "live"
    [] next = "dropped" -> "none"
    [] OTHER -> row

(* Another device binds its re-add of the slot, replacing the active
   binding; the content update that records it follows separately. *)
ReaddBind(kind) ==
  /\ committed = "removed" /\ row = "detached" /\ remote = "idle"
  /\ binding' = "theirs" /\ remote' = kind
  /\ UNCHANGED <<committed, staged, row, bytes, queued, worker, target>>

ReaddCommit ==
  /\ remote \in {"same", "other"}
  /\ committed' = remote /\ remote' = "done"
  /\ UNCHANGED <<staged, row, binding, bytes, queued, worker, target>>

(* A concurrent merge records the slot again with no new binding. *)
Resurrect ==
  /\ committed = "removed" /\ row = "detached" /\ remote = "idle"
  /\ committed' = "same" /\ remote' = "merged"
  /\ UNCHANGED <<staged, row, binding, bytes, queued, worker, target>>

(* A pane stages a re-add in its live document; the commit fails. *)
Stage ==
  /\ committed = "removed" /\ ~staged
  /\ staged' = TRUE
  /\ UNCHANGED <<committed, row, binding, bytes, queued, worker, target,
                 remote>>

Rollback ==
  /\ staged
  /\ staged' = FALSE
  /\ UNCHANGED <<committed, row, binding, bytes, queued, worker, target,
                 remote>>

(* The pass lists bindings, then settles the marker before any detach. A
   live row of a removed slot is a marker too. *)
Check ==
  /\ worker = "idle"
  /\ \/ row = "detached"
     \/ row = "live" /\ committed = "removed"
  /\ LET next == Settle(From, View)
     IN /\ row' = RowAfter(next)
        /\ queued' = (queued \/ next = "rebinding")
        /\ worker' = IF next = "awaitingDetach" THEN "dispatching" ELSE "idle"
        /\ target' = IF next = "awaitingDetach" THEN binding ELSE "none"
  /\ UNCHANGED <<committed, staged, binding, bytes, remote>>

(* The signed detach names the listed binding; a replaced one refuses it. *)
Land ==
  /\ worker = "dispatching"
  /\ IF binding = target
       THEN binding' = "none" /\ worker' = "settling"
       ELSE UNCHANGED binding /\ worker' = "idle"
  /\ target' = "none"
  /\ UNCHANGED <<committed, staged, row, bytes, queued, remote>>

(* remoteDetachSettled, then the settle; the negative control drops without
   rechecking. *)
SettleAfter ==
  /\ worker = "settling"
  /\ LET next == IF RecheckAfterDetach
                   THEN Settle("remoteDetached", View) ELSE "dropped"
     IN /\ row' = RowAfter(next)
        /\ queued' = (queued \/ next = "rebinding")
  /\ worker' = "idle"
  /\ UNCHANGED <<committed, staged, binding, bytes, target, remote>>

(* The upload lane binds the requeued held copy. *)
Upload ==
  /\ queued /\ bytes
  /\ binding' = "mine" /\ queued' = FALSE
  /\ UNCHANGED <<committed, staged, row, bytes, worker, target, remote>>

(* Reference-checked reclaim: a held or queued row keeps the bytes. *)
Reclaim ==
  /\ bytes /\ row = "none" /\ ~queued
  /\ bytes' = FALSE
  /\ UNCHANGED <<committed, staged, row, binding, queued, worker, target,
                 remote>>

Idle == UNCHANGED vars

Next == \/ ReaddBind("same") \/ ReaddBind("other") \/ ReaddCommit
        \/ Resurrect \/ Stage \/ Rollback \/ Check \/ Land \/ SettleAfter
        \/ Upload \/ Reclaim \/ Idle
Spec == Init /\ [][Next]_vars
        /\ WF_vars(ReaddCommit) /\ WF_vars(Rollback) /\ WF_vars(Check)
        /\ WF_vars(Land) /\ WF_vars(SettleAfter) /\ WF_vars(Upload)
        /\ WF_vars(Reclaim)

TypeOK == /\ committed \in Slots /\ staged \in BOOLEAN /\ row \in Rows
          /\ binding \in Bindings /\ bytes \in BOOLEAN /\ queued \in BOOLEAN
          /\ worker \in Workers /\ target \in Bindings /\ remote \in Remotes
(* Another device's re-add of other bytes keeps its binding, before and after
   the content update that records it arrives. *)
ReaddedOtherBindingKept ==
  (remote = "other" \/ (remote = "done" /\ committed = "other")) =>
    binding = "theirs"
(* Another device's re-add of the same bytes stays bound: its own binding, or
   this device's identical copy when that device bound and committed in the
   instant between this device's detach landing and its recheck. *)
ReaddedSameStaysBound ==
  (remote = "same" \/ (remote = "done" /\ committed = "same")) =>
    binding # "none"
(* With no other device's binding to download from, the plaintext of a copy
   committed again is never reclaimed. *)
ReaddedCopyKept == committed = "same" /\ binding # "theirs" => bytes
(* Held bytes are queued to bind only for a slot committed again, never for
   a staged re-add that may roll back. *)
RebindOnlyCommitted == queued => committed = "same"
(* A copy committed again ends up bound, even after a detach landed. *)
ReaddedCopyEventuallyBound == committed = "same" ~> binding # "none"
(* Other bytes free the slot's first download: the earlier copy goes. *)
ReaddedOtherFreesDownload == committed = "other" ~> row = "none"
(* A removal that stands, a rolled-back re-add included, is cleaned up. *)
RemovalEventuallyCleaned ==
  committed = "removed" ~>
    (committed # "removed" \/ (row = "none" /\ binding = "none" /\ ~bytes))
=============================================================================
