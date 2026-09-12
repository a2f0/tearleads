------------------------- MODULE ContainerDeletion -------------------------
EXTENDS Naturals

(* One leaf container, one ordinary document, and its metadata document. *)
(* A ready create holds a shared head lock until its transaction commits. *)
(* A ready delete holds the exclusive lock while checking and deleting. *)
CONSTANTS CheckLiveContainer, SerializeDeletion, PreserveMetadataReservation,
          SerializeMetadataLifecycle
ASSUME {CheckLiveContainer, SerializeDeletion,
        PreserveMetadataReservation, SerializeMetadataLifecycle} \subseteq BOOLEAN

VARIABLES live, documentExists, metadataExists, metadataReserved,
          createPhase, deletePhase, metadataCreatePhase
vars == <<live, documentExists, metadataExists, metadataReserved,
          createPhase, deletePhase, metadataCreatePhase>>

Init ==
  /\ live = TRUE /\ documentExists = FALSE
  /\ metadataExists \in BOOLEAN /\ metadataReserved = TRUE
  /\ createPhase = "idle" /\ deletePhase = "idle"
  /\ metadataCreatePhase = "idle"

BeginCreate ==
  /\ createPhase = "idle"
  /\ ~SerializeDeletion \/ deletePhase # "ready"
  /\ ~CheckLiveContainer \/ live
  /\ createPhase' = "ready"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, deletePhase, metadataCreatePhase>>

CommitCreate ==
  /\ createPhase = "ready"
  /\ documentExists' = TRUE /\ createPhase' = "done"
  /\ UNCHANGED <<live, metadataExists, metadataReserved, deletePhase, metadataCreatePhase>>

BeginDelete ==
  /\ deletePhase = "idle" /\ live
  /\ ~SerializeDeletion \/ createPhase # "ready"
  /\ (~SerializeMetadataLifecycle \/ metadataCreatePhase # "ready")
  /\ deletePhase' = "ready"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, createPhase, metadataCreatePhase>>

CommitDelete ==
  /\ deletePhase = "ready" /\ ~documentExists
  /\ live' = FALSE /\ metadataExists' = FALSE
  /\ metadataReserved' = PreserveMetadataReservation
  /\ deletePhase' = "done"
  /\ UNCHANGED <<documentExists, createPhase, metadataCreatePhase>>

RefuseNonemptyDelete ==
  /\ deletePhase = "ready" /\ documentExists
  /\ deletePhase' = "done"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, createPhase, metadataCreatePhase>>

(* A create through another live target can pass the retired-ID check while *)
(* the reserved container is live. The lifecycle lock protects that decision *)
(* until the document commit; the container-head lock need not overlap.      *)
BeginMetadataCreate ==
  /\ metadataCreatePhase = "idle" /\ ~metadataExists
  /\ (live \/ ~metadataReserved)
  /\ (~SerializeMetadataLifecycle \/ deletePhase # "ready")
  /\ metadataCreatePhase' = "ready"
  /\ UNCHANGED <<live, documentExists, metadataExists, metadataReserved,
                  createPhase, deletePhase>>

CommitMetadataCreate ==
  /\ metadataCreatePhase = "ready"
  /\ metadataExists' = TRUE /\ metadataCreatePhase' = "done"
  /\ UNCHANGED <<live, documentExists, metadataReserved,
                  createPhase, deletePhase>>

Next == BeginCreate \/ CommitCreate \/ BeginDelete \/ CommitDelete
        \/ RefuseNonemptyDelete \/ BeginMetadataCreate \/ CommitMetadataCreate
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ {live, documentExists, metadataExists, metadataReserved} \subseteq BOOLEAN
  /\ {createPhase, deletePhase, metadataCreatePhase} \subseteq {"idle", "ready", "done"}
LinkedDocumentsHaveLiveContainer == documentExists => live
RetiredMetadataIsNeverRecreated == ~live => ~metadataExists
=============================================================================
