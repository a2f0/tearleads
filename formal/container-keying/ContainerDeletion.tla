------------------------- MODULE ContainerDeletion -------------------------
EXTENDS Naturals

(* One leaf container, one ordinary document, and its metadata document. *)
(* A ready create holds a shared head lock until its transaction commits. *)
(* A ready delete holds the exclusive lock while checking and deleting. *)
CONSTANTS CheckLiveContainer, SerializeDeletion, PreserveMetadataReservation
ASSUME {CheckLiveContainer, SerializeDeletion,
        PreserveMetadataReservation} \subseteq BOOLEAN

VARIABLES live, documentExists, metadataExists, metadataReserved,
          createPhase, deletePhase
vars == <<live, documentExists, metadataExists, metadataReserved,
          createPhase, deletePhase>>

Init ==
  /\ live = TRUE /\ documentExists = FALSE
  /\ metadataExists = TRUE /\ metadataReserved = TRUE
  /\ createPhase = "idle" /\ deletePhase = "idle"

BeginCreate ==
  /\ createPhase = "idle"
  /\ ~SerializeDeletion \/ deletePhase # "ready"
  /\ ~CheckLiveContainer \/ live
  /\ createPhase' = "ready"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, deletePhase>>

CommitCreate ==
  /\ createPhase = "ready"
  /\ documentExists' = TRUE /\ createPhase' = "done"
  /\ UNCHANGED <<live, metadataExists, metadataReserved, deletePhase>>

BeginDelete ==
  /\ deletePhase = "idle" /\ live
  /\ ~SerializeDeletion \/ createPhase # "ready"
  /\ deletePhase' = "ready"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, createPhase>>

CommitDelete ==
  /\ deletePhase = "ready" /\ ~documentExists
  /\ live' = FALSE /\ metadataExists' = FALSE
  /\ metadataReserved' = PreserveMetadataReservation
  /\ deletePhase' = "done"
  /\ UNCHANGED <<documentExists, createPhase>>

RefuseNonemptyDelete ==
  /\ deletePhase = "ready" /\ documentExists
  /\ deletePhase' = "done"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, createPhase>>

(* A different live target cannot make a retired metadata ID available. *)
ReuseMetadataId ==
  /\ ~live /\ ~metadataExists /\ ~metadataReserved
  /\ metadataExists' = TRUE
  /\ UNCHANGED <<live, documentExists, metadataReserved,
                  createPhase, deletePhase>>

Next == BeginCreate \/ CommitCreate \/ BeginDelete \/ CommitDelete
        \/ RefuseNonemptyDelete \/ ReuseMetadataId \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ {live, documentExists, metadataExists, metadataReserved} \subseteq BOOLEAN
  /\ {createPhase, deletePhase} \subseteq {"idle", "ready", "done"}
LinkedDocumentsHaveLiveContainer == documentExists => live
RetiredMetadataIsNeverRecreated == ~live => ~metadataExists
=============================================================================
