---------------------- MODULE AttachmentReaddReconcile ----------------------
EXTENDS Naturals
CONSTANTS CheckBeforeDetach, RecheckAfterDetach, SettleOnCommitted
ASSUME {CheckBeforeDetach, RecheckAfterDetach, SettleOnCommitted}
         \subseteq BOOLEAN

(* One slot this device removed from a synced document, whose detach marker
   (a detached row naming the held copy) is still pending. Another pane or a
   pull can commit the slot again with the same copy or with other bytes, a
   pane can stage a re-add that rolls back, and the detach worker checks,
   dispatches, and settles the marker in separate steps. *)
VARIABLES committed, staged, row, binding, bytes, queued, worker, target
vars == <<committed, staged, row, binding, bytes, queued, worker, target>>

Slots == {"removed", "same", "other"}
Rows == {"detached", "live", "none"}
Bindings == {"same", "other", "none"}
Workers == {"idle", "dispatching", "settling"}

Init == /\ committed = "removed" /\ staged = FALSE /\ row = "detached"
        /\ binding = "same" /\ bytes = TRUE /\ queued = FALSE
        /\ worker = "idle" /\ target = "none"

(* What a settle reads: committed history, or (negative control) the live
   document of a pane that holds a staged re-add. *)
View == IF ~SettleOnCommitted /\ staged THEN "same" ELSE committed

(* attachmentRemovalMarkerMachine.ts from an open state. *)
Settle(from, view) ==
  CASE row = "none" -> "superseded"
    [] view = "removed" ->
         IF from = "awaitingDetach" THEN "awaitingDetach" ELSE "dropped"
    [] view = "same" ->
         IF from = "awaitingDetach" THEN "held" ELSE "rebinding"
    [] OTHER -> IF row = "detached" THEN "dropped" ELSE "held"

(* attachmentMarkerRowEffect applied to the marker copy's row. *)
RowAfter(next) ==
  CASE next \in {"awaitingDetach", "remoteDetached"} -> "detached"
    [] next \in {"held", "rebinding"} -> "live"
    [] next = "dropped" -> "none"
    [] OTHER -> row

(* Another pane or a pull commits the slot again while the marker is pending.
   Other bytes arrive with their own binding, which replaces the slot's. *)
ReaddSame ==
  /\ committed = "removed" /\ row = "detached"
  /\ committed' = "same"
  /\ UNCHANGED <<staged, row, binding, bytes, queued, worker, target>>

ReaddOther ==
  /\ committed = "removed" /\ row = "detached"
  /\ committed' = "other" /\ binding' = "other"
  /\ UNCHANGED <<staged, row, bytes, queued, worker, target>>

(* A pane stages a re-add in its live document; the commit fails. *)
Stage ==
  /\ committed = "removed" /\ ~staged
  /\ staged' = TRUE
  /\ UNCHANGED <<committed, row, binding, bytes, queued, worker, target>>

Rollback ==
  /\ staged
  /\ staged' = FALSE
  /\ UNCHANGED <<committed, row, binding, bytes, queued, worker, target>>

(* The pass lists bindings, then settles the marker before any detach. A
   live row of a removed slot is a marker too. The negative control trusts the
   stale marker as the old pass did. *)
Check ==
  /\ worker = "idle"
  /\ \/ row = "detached"
     \/ row = "live" /\ committed = "removed"
  /\ LET from == IF binding = "none" THEN "remoteDetached"
                 ELSE "awaitingDetach"
         next == IF CheckBeforeDetach THEN Settle(from, View)
                 ELSE IF binding = "none" THEN "dropped"
                 ELSE "awaitingDetach"
     IN /\ row' = RowAfter(next)
        /\ queued' = (queued \/ next = "rebinding")
        /\ worker' = IF next = "awaitingDetach" THEN "dispatching" ELSE "idle"
        /\ target' = IF next = "awaitingDetach" THEN binding ELSE "none"
  /\ UNCHANGED <<committed, staged, binding, bytes>>

(* The signed detach names the listed binding; a replaced one refuses it. *)
Land ==
  /\ worker = "dispatching"
  /\ IF binding = target
       THEN binding' = "none" /\ worker' = "settling"
       ELSE UNCHANGED binding /\ worker' = "idle"
  /\ target' = "none"
  /\ UNCHANGED <<committed, staged, row, bytes, queued>>

(* The post-detach settle; the negative control drops without rechecking. *)
SettleAfter ==
  /\ worker = "settling"
  /\ LET next == IF RecheckAfterDetach
                   THEN Settle("remoteDetached", View) ELSE "dropped"
     IN /\ row' = RowAfter(next)
        /\ queued' = (queued \/ next = "rebinding")
  /\ worker' = "idle"
  /\ UNCHANGED <<committed, staged, binding, bytes, target>>

(* The upload lane binds the requeued held copy. *)
Upload ==
  /\ queued /\ bytes
  /\ binding' = "same" /\ queued' = FALSE
  /\ UNCHANGED <<committed, staged, row, bytes, worker, target>>

(* Reference-checked reclaim: a held or queued row keeps the bytes. *)
Reclaim ==
  /\ bytes /\ row = "none" /\ ~queued
  /\ bytes' = FALSE
  /\ UNCHANGED <<committed, staged, row, binding, queued, worker, target>>

Idle == UNCHANGED vars

Next == ReaddSame \/ ReaddOther \/ Stage \/ Rollback \/ Check \/ Land
        \/ SettleAfter \/ Upload \/ Reclaim \/ Idle
Spec == Init /\ [][Next]_vars
        /\ WF_vars(Rollback) /\ WF_vars(Check) /\ WF_vars(Land)
        /\ WF_vars(SettleAfter) /\ WF_vars(Upload) /\ WF_vars(Reclaim)

TypeOK == /\ committed \in Slots /\ staged \in BOOLEAN /\ row \in Rows
          /\ binding \in Bindings /\ bytes \in BOOLEAN /\ queued \in BOOLEAN
          /\ worker \in Workers /\ target \in Bindings
(* The plaintext of a copy committed again is never reclaimed. *)
ReaddedCopyKept == committed = "same" => bytes
(* No detach removes the binding of other bytes committed for the slot. *)
ReaddedOtherBindingKept == committed = "other" => binding = "other"
(* Held bytes are queued to bind only for a slot committed again, never for
   a staged re-add that may roll back. *)
RebindOnlyCommitted == queued => committed = "same"
(* A same copy committed again ends up bound, even after a detach landed. *)
ReaddedCopyEventuallyBound == committed = "same" ~> binding = "same"
(* Other bytes free the slot's first download: the earlier copy goes. *)
ReaddedOtherFreesDownload == committed = "other" ~> row = "none"
(* A removal that stands, a rolled-back re-add included, is cleaned up. *)
RemovalEventuallyCleaned ==
  committed = "removed" ~>
    (committed # "removed" \/ (row = "none" /\ binding = "none" /\ ~bytes))
=============================================================================
