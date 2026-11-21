---------------------- MODULE AttachmentReaddReconcile ----------------------
CONSTANTS OwnBindingOnly, DetachSighted, RestartRebinds, RecheckAfterDetach,
          SettleOnCommitted
ASSUME {OwnBindingOnly, DetachSighted, RestartRebinds, RecheckAfterDetach,
        SettleOnCommitted} \subseteq BOOLEAN

(* One slot this device removed from a synced document, whose detach marker
   (a detached row naming the held copy and the blob it was bound as) is still
   pending. The marker's copy is bound ("mine"), or never bound because it
   replaced a bound copy offline; the slot's binding is then that earlier
   copy's ("old"), as it is when the removal overtook a download of another
   device's replacement. Another device can add the slot back with the same
   bytes or with other bytes: it binds its own blob ("theirs") and pushes the
   content update that records the slot in one sync pass, and this device
   pulls that update later. A concurrent merge can also bring the slot back
   with no new binding, here or through a pull that lands before the pass
   rechecks. A pane can stage a re-add that rolls back, and the
   detach worker checks, dispatches, and settles in separate steps, with or
   without a pull before it. `sighted` is the foreign binding a check listed
   for the still-removed slot, and `sightPulled` whether a pull completed
   since. A restart, at most once, abandons the pass, forgets `sighted`, and
   settles the marker before any binding list. *)
VARIABLES committed, pushed, sightPulled, staged, row, bound, binding, bytes,
          queued, worker, target, sighted, remote, readdPushed, restarted
vars == <<committed, pushed, sightPulled, staged, row, bound, binding, bytes,
          queued, worker, target, sighted, remote, readdPushed, restarted>>

Slots == {"removed", "same", "other"}
Rows == {"detached", "live", "none"}
Bindings == {"mine", "old", "theirs", "none"}
Workers == {"idle", "dispatching", "settling"}
Remotes == {"idle", "same", "other", "merged"}

Init == /\ committed = "removed" /\ pushed = "removed" /\ staged = FALSE
        /\ row = "detached" /\ bound \in BOOLEAN
        /\ binding = (IF bound THEN "mine" ELSE "old") /\ bytes = TRUE
        /\ queued = FALSE /\ worker = "idle" /\ target = "none"
        /\ sighted = "none" /\ remote = "idle" /\ readdPushed = FALSE
        /\ restarted = FALSE /\ sightPulled = FALSE

(* What a settle reads: committed history, or (negative control) the live
   document of a pane that holds a staged re-add. *)
View == IF ~SettleOnCommitted /\ staged THEN "same" ELSE committed

(* observeMarkerBinding over a fresh listing. Negative controls own whatever
   binding is active, as the old pass did, or never own a sighted one. *)
From == CASE binding = "none" -> "remoteDetached"
          [] binding = "mine" \/ ~OwnBindingOnly
             \/ (DetachSighted /\ binding = sighted /\ sightPulled) ->
               "awaitingDetach"
          [] OTHER -> "bindingReplaced"

(* attachmentRemovalMarkerMachine.ts from an open state. *)
Settle(from, view) ==
  CASE row = "none" -> "superseded"
    [] view = "removed" ->
         IF from = "remoteDetached" THEN "dropped" ELSE from
    [] view = "same" ->
         IF from = "remoteDetached"
            \/ (row = "detached"
                /\ (~bound \/ (RestartRebinds /\ from = "bindingUnknown")))
           THEN "rebinding" ELSE "held"
    [] OTHER -> IF row = "detached" THEN "dropped" ELSE "held"

Open == {"awaitingDetach", "bindingReplaced", "bindingUnknown"}

(* attachmentMarkerRowEffect applied to the marker copy's row. *)
RowAfter(next) ==
  CASE next \in Open -> "detached"
    [] next \in {"held", "rebinding"} -> "live"
    [] next = "dropped" -> "none"
    [] OTHER -> row

(* Another device re-adds the slot: its bind, then, in the same sync pass,
   the push of the content update that records it. *)
ReaddBind(kind) ==
  /\ pushed = "removed" /\ row = "detached" /\ remote = "idle"
  /\ binding' = "theirs" /\ remote' = kind
  /\ UNCHANGED <<committed, pushed, sightPulled, staged, row, bound, bytes,
                 queued, worker, target, sighted, readdPushed, restarted>>

ReaddPush ==
  /\ remote \in {"same", "other"} /\ ~readdPushed
  /\ pushed' = remote /\ readdPushed' = TRUE
  /\ UNCHANGED <<committed, sightPulled, staged, row, bound, binding, bytes,
                 queued, worker, target, sighted, remote, restarted>>

(* A pane on this database restores the slot, or a pulled merge records it
   again, with no new binding. *)
Resurrect ==
  /\ committed = "removed" /\ pushed = "removed" /\ row = "detached"
  /\ remote = "idle"
  /\ committed' = "same" /\ pushed' = "same" /\ remote' = "merged"
  /\ UNCHANGED <<sightPulled, staged, row, bound, binding, bytes, queued, worker,
                 target, sighted, readdPushed, restarted>>

(* A pull after another device's bind brings the content update it pushed in
   the same pass: the device lost between the two is the remaining window. *)
Pull ==
  /\ committed # pushed \/ (sighted # "none" /\ ~sightPulled)
  /\ remote \in {"same", "other"} => readdPushed
  /\ committed' = pushed /\ sightPulled' = (sighted # "none")
  /\ UNCHANGED <<pushed, staged, row, bound, binding, bytes, queued, worker,
                 target, sighted, remote, readdPushed, restarted>>

(* A pane stages a re-add in its live document; the commit fails. *)
Stage ==
  /\ committed = "removed" /\ ~staged
  /\ staged' = TRUE
  /\ UNCHANGED <<committed, pushed, sightPulled, row, bound, binding, bytes,
                 queued, worker, target, sighted, remote, readdPushed,
                 restarted>>

Rollback ==
  /\ staged
  /\ staged' = FALSE
  /\ UNCHANGED <<committed, pushed, sightPulled, row, bound, binding, bytes,
                 queued, worker, target, sighted, remote, readdPushed,
                 restarted>>

(* The pass pulls, lists bindings, then settles before any detach. A live
   row of a removed slot is a marker too. *)
Check ==
  /\ worker = "idle"
  /\ \/ row = "detached"
     \/ row = "live" /\ committed = "removed"
  /\ LET next == Settle(From, View)
     IN /\ row' = RowAfter(next)
        /\ queued' = (queued \/ next = "rebinding")
        /\ worker' = IF next = "awaitingDetach" THEN "dispatching" ELSE "idle"
        /\ target' = IF next = "awaitingDetach" THEN binding ELSE "none"
        /\ sighted' = IF next = "bindingReplaced" THEN binding ELSE "none"
        /\ sightPulled' = (next = "bindingReplaced" /\ sighted = binding
                           /\ sightPulled)
  /\ UNCHANGED <<committed, pushed, staged, bound, binding, bytes, remote,
                 readdPushed, restarted>>

(* The signed detach names the listed binding; a replaced one refuses it. *)
Land ==
  /\ worker = "dispatching"
  /\ IF binding = target
       THEN binding' = "none" /\ worker' = "settling"
       ELSE UNCHANGED binding /\ worker' = "idle"
  /\ target' = "none"
  /\ UNCHANGED <<committed, pushed, sightPulled, staged, row, bound, bytes,
                 queued, sighted, remote, readdPushed, restarted>>

(* remoteDetachSettled, then the settle; the negative control drops without
   rechecking. *)
SettleAfter ==
  /\ worker = "settling"
  /\ LET next == IF RecheckAfterDetach
                   THEN Settle("remoteDetached", View) ELSE "dropped"
     IN /\ row' = RowAfter(next)
        /\ queued' = (queued \/ next = "rebinding")
  /\ worker' = "idle"
  /\ UNCHANGED <<committed, pushed, sightPulled, staged, bound, binding, bytes,
                 target, sighted, remote, readdPushed, restarted>>

(* A restart abandons the pass, even between a landed detach and its
   recheck, and settles the marker before any binding list. *)
Restart ==
  /\ ~restarted /\ row = "detached" /\ ~staged
  /\ LET next == Settle("bindingUnknown", committed)
     IN /\ row' = RowAfter(next)
        /\ queued' = (queued \/ next = "rebinding")
  /\ worker' = "idle" /\ target' = "none" /\ sighted' = "none"
  /\ sightPulled' = FALSE
  /\ restarted' = TRUE
  /\ UNCHANGED <<committed, pushed, staged, bound, binding, bytes,
                 remote, readdPushed>>

(* The upload lane binds the requeued held copy. *)
Upload ==
  /\ queued /\ bytes
  /\ binding' = "mine" /\ bound' = TRUE /\ queued' = FALSE
  /\ UNCHANGED <<committed, pushed, sightPulled, staged, row, bytes, worker,
                 target, sighted, remote, readdPushed, restarted>>

(* Reference-checked reclaim: a held or queued row keeps the bytes. *)
Reclaim ==
  /\ bytes /\ row = "none" /\ ~queued
  /\ bytes' = FALSE
  /\ UNCHANGED <<committed, pushed, sightPulled, staged, row, bound, binding,
                 queued, worker, target, sighted, remote, readdPushed,
                 restarted>>

Idle == UNCHANGED vars

Next == \/ ReaddBind("same") \/ ReaddBind("other") \/ ReaddPush
        \/ Resurrect \/ Pull \/ Stage \/ Rollback \/ Check \/ Land
        \/ SettleAfter \/ Restart \/ Upload \/ Reclaim \/ Idle
Spec == Init /\ [][Next]_vars
        /\ WF_vars(ReaddPush) /\ WF_vars(Pull) /\ WF_vars(Rollback)
        /\ WF_vars(Check)
        /\ WF_vars(Land) /\ WF_vars(SettleAfter) /\ WF_vars(Upload)
        /\ WF_vars(Reclaim)

TypeOK == /\ committed \in Slots /\ pushed \in Slots /\ sightPulled \in BOOLEAN
          /\ staged \in BOOLEAN /\ readdPushed \in BOOLEAN
          /\ row \in Rows /\ bound \in BOOLEAN /\ binding \in Bindings
          /\ bytes \in BOOLEAN /\ queued \in BOOLEAN /\ worker \in Workers
          /\ target \in Bindings /\ sighted \in Bindings
          /\ remote \in Remotes /\ restarted \in BOOLEAN
(* Another device's re-add of other bytes keeps its binding. *)
ReaddedOtherBindingKept == remote = "other" => binding = "theirs"
(* Another device's re-add of the same bytes stays bound: its own binding, or
   this device's identical copy when that device bound and pushed in the
   instant between this device's detach landing and its recheck. *)
ReaddedSameStaysBound == remote = "same" => binding # "none"
(* With no other device's binding to download from, the plaintext of a copy
   committed again is never reclaimed. *)
ReaddedCopyKept == committed = "same" /\ binding # "theirs" => bytes
(* Held bytes are queued to bind only for a slot committed again, never for
   a staged re-add that may roll back. *)
RebindOnlyCommitted == queued => committed = "same"
(* A copy committed again ends up bound to its own bytes or another
   device's identical ones, even after a detach landed. *)
ReaddedCopyEventuallyBound ==
  committed = "same" ~> binding \in {"mine", "theirs"}
(* Other bytes free the slot's first download: the earlier copy goes. *)
ReaddedOtherFreesDownload == committed = "other" ~> row = "none"
(* A removal that stands, a rolled-back re-add included, is cleaned up: the
   binding it owes goes, whichever copy it binds. *)
RemovalEventuallyCleaned ==
  pushed = "removed" ~>
    (pushed # "removed" \/ (row = "none" /\ binding = "none" /\ ~bytes))
=============================================================================
