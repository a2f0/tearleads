------------------- MODULE AttachmentRemovedSlotDetach -------------------
CONSTANTS CheckDocumentVersion, CoverBindVersion, DetachFromSyncedView,
          DetachUnheldSlots
ASSUME {CheckDocumentVersion, CoverBindVersion, DetachFromSyncedView,
        DetachUnheldSlots} \subseteq BOOLEAN

(* One attachment slot whose signed document content asks for the importer's
   fixture bytes. Documents are sets of ops: `made` holds every op a device
   has created, `committed` the ones the server holds. The server cannot read
   content, so only clients can tell what a version says about the slot.

   - "rm": a device removes the slot offline, before the importer's bind,
     and pushes the removal later.
   - "iu": an op the importer may still hold unsent when it binds.
   - "rs": a restore of the slot with the fixture bytes, which adopts the
     active fixture binding rather than binding again.
   - "re": a restore with other bytes, bound before its content is pushed.

   CheckDocumentVersion and CoverBindVersion are the API's two detach
   checks, DetachFromSyncedView the client's rule that a detach cites only a
   version with none of its own ops unsent, and DetachUnheldSlots whether a
   device that never held the bytes detaches at all. *)
VARIABLES made, committed, binding, bindVersion, restore, observer,
          observedView, observedBinding, detachedNamed
vars == <<made, committed, binding, bindVersion, restore, observer,
          observedView, observedBinding, detachedNamed>>

Ops == {"rm", "iu", "rs", "re"}
Bindings == {"none", "fixture", "other"}

(* What a document version asks the slot for. A restore follows the
   removal it saw, so it wins whenever both are present. *)
SlotAt(view) ==
  IF "re" \in view THEN "other"
  ELSE IF "rs" \in view THEN "fixture"
  ELSE IF "rm" \in view THEN "removed"
  ELSE "fixture"

Init ==
  /\ made = {"rm"} /\ committed = {}
  /\ binding = "none" /\ bindVersion = {}
  /\ restore = "none"
  /\ observer = "idle" /\ observedView = {} /\ observedBinding = "none"
  /\ detachedNamed = FALSE

(* The importer pulled every committed update and the slot still asks for
   its fixture, so the bind's version check passes; the bind records the
   version it checked, which may hold the importer's own unsent op. *)
ImporterBind(ahead) ==
  /\ binding = "none" /\ "iu" \notin made
  /\ "rm" \notin committed
  /\ made' = IF ahead THEN made \cup {"iu"} ELSE made
  /\ binding' = "fixture"
  /\ bindVersion' = IF ahead THEN committed \cup {"iu"} ELSE committed
  /\ UNCHANGED <<committed, restore, observer, observedView, observedBinding,
                 detachedNamed>>

Push(op) ==
  /\ op \in made \ committed
  /\ op = "re" => restore = "bound"
  /\ committed' = committed \cup {op}
  /\ UNCHANGED <<made, binding, bindVersion, restore, observer, observedView,
                 observedBinding, detachedNamed>>

(* A device that pulled the committed removal restores the slot. The same
   bytes reuse the active binding; other bytes are bound first. *)
Restore(kind) ==
  /\ restore = "none" /\ "rm" \in committed
  /\ restore' = kind
  /\ made' = made \cup {IF kind = "same" THEN "rs" ELSE "re"}
  /\ UNCHANGED <<committed, binding, bindVersion, observer, observedView,
                 observedBinding, detachedNamed>>

(* The restoring device lists the slot's binding and replaces it with its
   own bytes at its version: everything committed plus its unsent re-add. *)
RestoreBind ==
  /\ restore = "other"
  /\ restore' = "bound"
  /\ binding' = "other"
  /\ bindVersion' = committed \cup {"re"}
  /\ UNCHANGED <<made, committed, observer, observedView, observedBinding,
                 detachedNamed>>

(* Any device with write access that saw the slot removed lists the slot's
   binding and reads its document. The store does so only once its own ops
   are pushed, so its version holds no op the server lacks; the remover that
   still holds its removal unsent is the negative control. *)
Observe(view) ==
  /\ observer = "idle"
  /\ observer' = "read"
  /\ observedView' = view
  /\ observedBinding' = binding
  /\ UNCHANGED <<made, committed, binding, bindVersion, restore, detachedNamed>>

ObserveSynced == Observe(committed)
ObserveUnsynced ==
  /\ ~DetachFromSyncedView /\ "rm" \in made \ committed
  /\ Observe(committed \cup {"rm"})

(* The detach names the listed binding and carries the version the device
   read. The API refuses an inactive binding, a version missing a committed
   op, and a binding whose bind version holds an op that version lacks. A
   device that never held the bytes detaches only when DetachUnheldSlots. *)
Detach ==
  /\ observer = "read"
  /\ observer' = "idle"
  /\ IF /\ DetachUnheldSlots
        /\ observedBinding # "none"
        /\ SlotAt(observedView) = "removed"
        /\ binding = observedBinding
        /\ ~CheckDocumentVersion \/ committed \subseteq observedView
        /\ ~CoverBindVersion \/ bindVersion \subseteq observedView
       THEN /\ binding' = "none" /\ bindVersion' = {}
            /\ detachedNamed' = (detachedNamed \/ SlotAt(committed) # "removed")
       ELSE UNCHANGED <<binding, bindVersion, detachedNamed>>
  /\ UNCHANGED <<made, committed, restore, observedView, observedBinding>>

Next ==
  \/ \E ahead \in BOOLEAN : ImporterBind(ahead)
  \/ \E op \in Ops : Push(op)
  \/ \E kind \in {"same", "other"} : Restore(kind)
  \/ RestoreBind \/ ObserveSynced \/ ObserveUnsynced \/ Detach

(* Fairness covers only the observing device's own steps: the importer, the
   remover, and the restoring device may stop at any point (no-brick). *)
Spec == Init /\ [][Next]_vars /\ WF_vars(ObserveSynced) /\ WF_vars(Detach)

TypeOK ==
  /\ made \subseteq Ops /\ committed \subseteq made
  /\ binding \in Bindings /\ bindVersion \subseteq Ops
  /\ restore \in {"none", "same", "other", "bound"}
  /\ observer \in {"idle", "read"}
  /\ observedView \subseteq Ops /\ observedBinding \in Bindings
  /\ detachedNamed \in BOOLEAN

(* A detach commits only while the committed document lacks the slot, so it
   never unbinds bytes the document asks for. *)
DetachOnlyRemovedSlot == ~detachedNamed

(* A restore with other bytes keeps its binding, including while its content
   update is still unsent and the committed document still lacks the slot. *)
RestoreKeepsBinding == [][binding = "other" => binding' = "other"]_vars

(* Once the removal stands and the importer's view is committed, the
   fixture binding goes. An importer that never pushes the op its bind
   version holds keeps the binding: its content may yet ask for the slot. *)
RemovalStands ==
  /\ SlotAt(committed) = "removed"
  /\ bindVersion \subseteq committed
RemovedSlotEventuallyUnbound ==
  <>[]RemovalStands => <>[](binding # "fixture")
=============================================================================
