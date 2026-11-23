------------------- MODULE AttachmentRemovedSlotDetach -------------------
CONSTANTS CheckDocumentVersion, WaitForBindVersion, CoverBindVersion,
          DetachFromSyncedView, DetachUnheldSlots, DetachIgnoresCursor,
          CursorAheadOfVersion
ASSUME {CheckDocumentVersion, WaitForBindVersion, CoverBindVersion,
        DetachFromSyncedView, DetachUnheldSlots, DetachIgnoresCursor,
        CursorAheadOfVersion}
         \subseteq BOOLEAN

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
   - "oc": a dishonest writer's overclaim, whose signed span names ops
     nobody carries. Readers void it, so no version ever holds it.

   CheckDocumentVersion and WaitForBindVersion are the API's two detach
   checks: the detach version holds every committed op, and every op of the
   bind version is committed. CoverBindVersion is the rule the second
   replaced, that the detach version hold every op of the bind version.
   DetachFromSyncedView is the client's rule that a detach cites only a
   version with none of its own ops unsent, and DetachUnheldSlots whether a
   device that never held the bytes detaches at all. `observedCursor` is the
   observer's processed cursor: the committed updates it had judged when it
   read its view, each imported into that view or voided. *)
VARIABLES made, committed, binding, bindVersion, restore, observer,
          observedView, observedBinding, observedCursor, detachedNamed
vars == <<made, committed, binding, bindVersion, restore, observer,
          observedView, observedBinding, observedCursor, detachedNamed>>

Ops == {"rm", "iu", "rs", "re", "oc"}
Bindings == {"none", "fixture", "other"}

(* The ops a client's document can hold: never an overclaim's. *)
Held(ops) == ops \ {"oc"}

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
  /\ observedCursor = {} /\ detachedNamed = FALSE

(* The importer pulled every committed update and the slot still asks for
   its fixture, so the bind's version check passes; the bind records the
   version it checked, which may hold the importer's own unsent op. It may
   also name a committed overclaim's ops (`named`): a dishonest uploader can
   send any committed counter, and an uploader may hold an update the
   observer voided. *)
ImporterBind(ahead, named) ==
  /\ binding = "none" /\ "iu" \notin made
  /\ "rm" \notin committed
  /\ named => "oc" \in committed
  /\ made' = IF ahead THEN made \cup {"iu"} ELSE made
  /\ binding' = "fixture"
  /\ bindVersion' = Held(committed)
                    \cup (IF ahead THEN {"iu"} ELSE {})
                    \cup (IF named THEN {"oc"} ELSE {})
  /\ UNCHANGED <<committed, restore, observer, observedView, observedBinding,
                 observedCursor, detachedNamed>>

Push(op) ==
  /\ op \in made \ committed
  /\ op = "re" => restore = "bound"
  /\ committed' = committed \cup {op}
  /\ UNCHANGED <<made, binding, bindVersion, restore, observer, observedView,
                 observedBinding, observedCursor, detachedNamed>>

(* A device that pulled the committed removal restores the slot. The same
   bytes reuse the active binding; other bytes are bound first. *)
Restore(kind) ==
  /\ restore = "none" /\ "rm" \in committed
  /\ restore' = kind
  /\ made' = made \cup {IF kind = "same" THEN "rs" ELSE "re"}
  /\ UNCHANGED <<committed, binding, bindVersion, observer, observedView,
                 observedBinding, observedCursor, detachedNamed>>

(* The restoring device lists the slot's binding and replaces it with its
   own bytes at its version: everything committed plus its unsent re-add. *)
(* A dishonest writer commits an overclaim. The server stores its declared
   span; no client view ever holds its ops. *)
Overclaim ==
  /\ "oc" \notin made
  /\ made' = made \cup {"oc"} /\ committed' = committed \cup {"oc"}
  /\ UNCHANGED <<binding, bindVersion, restore, observer, observedView,
                 observedBinding, observedCursor, detachedNamed>>

RestoreBind ==
  /\ restore = "other"
  /\ restore' = "bound"
  /\ binding' = "other"
  /\ bindVersion' = Held(committed) \cup {"re"}
  /\ UNCHANGED <<made, committed, observer, observedView, observedBinding,
                 observedCursor, detachedNamed>>

(* Any device with write access that saw the slot removed lists the slot's
   binding and reads its document. The store does so only once its own ops
   are pushed, so its version holds no op the server lacks; the remover that
   still holds its removal unsent is the negative control. *)
Observe(view) ==
  /\ observer = "idle"
  /\ observer' = "read"
  /\ observedView' = Held(view)
  /\ observedBinding' = binding
  /\ observedCursor' = committed
  /\ UNCHANGED <<made, committed, binding, bindVersion, restore, detachedNamed>>

ObserveSynced == Observe(committed)
ObserveUnsynced ==
  /\ ~DetachFromSyncedView /\ "rm" \in made \ committed
  /\ Observe(committed \cup {"rm"})

(* What the detach's version check weighs: the committed ops after the
   cursor it sends. The client sends the cursor recorded with the version it
   read, or, in the negative control, the one it holds when it detaches. *)
SentCursor ==
  IF DetachIgnoresCursor THEN {}
  ELSE IF CursorAheadOfVersion THEN committed
  ELSE observedCursor

(* The detach names the listed binding and carries the version the device
   read. The API refuses an inactive binding, a version missing a committed
   op, and a binding whose bind version holds an op not yet committed. A
   device that never held the bytes detaches only when DetachUnheldSlots. *)
Detach ==
  /\ observer = "read"
  /\ observer' = "idle"
  /\ IF /\ DetachUnheldSlots
        /\ observedBinding # "none"
        /\ SlotAt(observedView) = "removed"
        /\ binding = observedBinding
        /\ ~CheckDocumentVersion \/ committed \ SentCursor \subseteq observedView
        /\ ~WaitForBindVersion \/ bindVersion \subseteq committed
        /\ ~CoverBindVersion \/ bindVersion \subseteq observedView
       THEN /\ binding' = "none" /\ bindVersion' = {}
            /\ detachedNamed' = (detachedNamed \/ SlotAt(committed) # "removed")
       ELSE UNCHANGED <<binding, bindVersion, detachedNamed>>
  /\ UNCHANGED <<made, committed, restore, observedView, observedBinding,
                 observedCursor>>

Next ==
  \/ \E ahead, named \in BOOLEAN : ImporterBind(ahead, named)
  \/ \E op \in Ops : Push(op)
  \/ \E kind \in {"same", "other"} : Restore(kind)
  \/ RestoreBind \/ ObserveSynced \/ ObserveUnsynced \/ Detach
  \/ Overclaim

(* Fairness covers only the observing device's own steps: the importer, the
   remover, and the restoring device may stop at any point (no-brick). *)
Spec == Init /\ [][Next]_vars /\ WF_vars(ObserveSynced) /\ WF_vars(Detach)

TypeOK ==
  /\ made \subseteq Ops /\ committed \subseteq made
  /\ binding \in Bindings /\ bindVersion \subseteq Ops
  /\ restore \in {"none", "same", "other", "bound"}
  /\ observer \in {"idle", "read"}
  /\ observedView \subseteq Ops /\ observedBinding \in Bindings
  /\ observedCursor \subseteq committed /\ detachedNamed \in BOOLEAN

(* A detach commits only while the committed document lacks the slot, so it
   never unbinds bytes the document asks for. *)
DetachOnlyRemovedSlot == ~detachedNamed

(* A restore with other bytes keeps its binding, including while its content
   update is still unsent and the committed document still lacks the slot. *)
RestoreKeepsBinding == [][binding = "other" => binding' = "other"]_vars

(* Once the removal stands and the importer's bind version is committed,
   the fixture binding goes, even when that version names ops no reader
   holds. An importer that never pushes the op its bind version holds keeps
   the binding: its content may yet ask for the slot. *)
RemovalStands ==
  /\ SlotAt(committed) = "removed"
  /\ bindVersion \subseteq committed
RemovedSlotEventuallyUnbound ==
  <>[]RemovalStands => <>[](binding # "fixture")
=============================================================================
