-------------------- MODULE AttachmentBindDocumentVersion --------------------
EXTENDS Naturals
CONSTANTS MaxEdits, CheckDocumentVersion, RecheckOnRefresh, PullOnRefusal
ASSUME /\ MaxEdits \in Nat
       /\ {CheckDocumentVersion, RecheckOnRefresh, PullOnRefusal}
            \subseteq BOOLEAN

(* One slot whose signed document content asks the uploader for its fixture
   bytes. Another device keeps editing the document; the server orders its
   committed updates, so a document version is the count of edits the
   uploader has pulled. `boundSlot` is a ghost: what the committed document
   asked for when the binding committed, which the server cannot read. *)
VARIABLES slot, edits, binding, boundSlot, uploader, checked
vars == <<slot, edits, binding, boundSlot, uploader, checked>>

SlotStates == {"fixture", "removed", "other"}
Bindings == {"none", "fixture", "other"}
UploaderStates == {"check", "ready", "refused", "bound", "abandoned"}

Init == /\ slot = "fixture" /\ edits = 0
        /\ binding = "none" /\ boundSlot = "none"
        /\ uploader = "check" /\ checked = 0

(* The uploader pulls every committed update, then checks that the slot still
   asks for its bytes and holds no binding. Otherwise it leaves the slot to
   the edit (Continuity throws; the web store drops the pending upload). *)
Check ==
  /\ uploader = "check"
  /\ checked' = edits
  /\ uploader' = IF slot = "fixture" /\ binding = "none"
                   THEN "ready" ELSE "abandoned"
  /\ UNCHANGED <<slot, edits, binding, boundSlot>>

(* The bind transaction locks the document head, under which no update
   commits, so its version check and its insert are one atomic step. A bind
   at a version missing a committed update is refused. `expectedBindingId` is
   null, so a binding that committed meanwhile also refuses it. *)
Bind ==
  /\ uploader = "ready"
  /\ IF CheckDocumentVersion /\ checked < edits
       THEN /\ uploader' = "refused"
            /\ UNCHANGED <<slot, edits, binding, boundSlot, checked>>
       ELSE IF binding # "none"
       THEN /\ uploader' = "check"
            /\ UNCHANGED <<slot, edits, binding, boundSlot, checked>>
       ELSE /\ binding' = "fixture" /\ boundSlot' = slot
            /\ uploader' = "bound"
            /\ UNCHANGED <<slot, edits, checked>>

(* After a refusal the uploader pulls and checks the slot again. Without a
   re-check it retries at once, adopting the pulled version if it pulled. *)
Retry ==
  /\ uploader = "refused"
  /\ uploader' = IF RecheckOnRefresh THEN "check" ELSE "ready"
  /\ checked' = IF RecheckOnRefresh \/ ~PullOnRefusal THEN checked ELSE edits
  /\ UNCHANGED <<slot, edits, binding, boundSlot>>

(* Another device's edits commit regardless of any binding: the server never
   refuses an update because of an attachment. *)
Edit(next) ==
  /\ edits < MaxEdits
  /\ slot' = next /\ edits' = edits + 1
  /\ UNCHANGED <<binding, boundSlot, uploader, checked>>

Remove == Edit("removed")
(* A rename, or a time-machine restore, asks for the same bytes again. *)
Restore == Edit("fixture")
Replace == Edit("other")
Unrelated == Edit(slot)

(* The replacing device binds its own bytes over whatever it saw. *)
OtherBind ==
  /\ slot = "other" /\ binding # "other"
  /\ binding' = "other" /\ boundSlot' = slot
  /\ UNCHANGED <<slot, edits, uploader, checked>>

Idle == UNCHANGED vars
Next == Check \/ Bind \/ Retry \/ Remove \/ Restore \/ Replace
        \/ Unrelated \/ OtherBind \/ Idle
(* Fairness covers only the uploader's own steps: no-brick forbids waiting
   on another device's write, which may never come. *)
Spec == Init /\ [][Next]_vars
        /\ WF_vars(Check) /\ WF_vars(Bind) /\ WF_vars(Retry)

TypeOK == /\ slot \in SlotStates /\ edits \in 0..MaxEdits
          /\ binding \in Bindings /\ boundSlot \in {"none"} \cup SlotStates
          /\ uploader \in UploaderStates /\ checked \in 0..MaxEdits

(* The uploader binds only when the committed document still asks for its
   bytes, so an edit committed before the bind always wins. An edit that
   commits after the bind (the other interleaving) may still remove the
   slot; detaching that binding is reconciliation outside this model. *)
FixtureBindingWasRequested == binding = "fixture" => boundSlot = "fixture"

(* The uploader never replaces bytes another device restored into the slot. *)
OtherBytesKept == [][binding = "other" => binding' = "other"]_vars

(* With finitely many foreign edits, the uploader's own pulls and binds end
   in a binding or in leaving the slot to the edit. *)
UploadSettles == <>[](uploader \in {"bound", "abandoned"})
=============================================================================
