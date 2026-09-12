------------------------- MODULE ContainerDeletion -------------------------
EXTENDS Naturals

(* One leaf container, one ordinary document, and its metadata document. *)
(* A ready create holds a shared head lock until its transaction commits. *)
(* A ready delete holds the exclusive lock while checking and deleting. *)
CONSTANTS CheckLiveContainer, SerializeDeletion, PreserveMetadataReservation,
          CheckMetadataScope
ASSUME {CheckLiveContainer, SerializeDeletion,
        PreserveMetadataReservation, CheckMetadataScope} \subseteq BOOLEAN

VARIABLES live, documentExists, metadataExists, metadataReserved,
          createPhase, deletePhase, metadataCreatePhase, metadataTarget
vars == <<live, documentExists, metadataExists, metadataReserved,
          createPhase, deletePhase, metadataCreatePhase, metadataTarget>>

Init ==
  /\ live = TRUE /\ documentExists = FALSE
  /\ metadataExists \in BOOLEAN /\ metadataReserved = TRUE
  /\ createPhase = "idle" /\ deletePhase = "idle"
  /\ metadataCreatePhase = "idle" /\ metadataTarget = "owner"

BeginCreate ==
  /\ createPhase = "idle"
  /\ ~SerializeDeletion \/ deletePhase # "ready"
  /\ ~CheckLiveContainer \/ live
  /\ createPhase' = "ready"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, deletePhase, metadataCreatePhase, metadataTarget>>

CommitCreate ==
  /\ createPhase = "ready"
  /\ documentExists' = TRUE /\ createPhase' = "done"
  /\ UNCHANGED <<live, metadataExists, metadataReserved, deletePhase, metadataCreatePhase, metadataTarget>>

BeginDelete ==
  /\ deletePhase = "idle" /\ live
  /\ ~SerializeDeletion \/ createPhase # "ready"
  /\ metadataCreatePhase # "ready"
  /\ deletePhase' = "ready"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, createPhase, metadataCreatePhase, metadataTarget>>

CommitDelete ==
  /\ deletePhase = "ready" /\ ~documentExists
  /\ live' = FALSE /\ metadataExists' = FALSE
  /\ metadataReserved' = PreserveMetadataReservation
  /\ deletePhase' = "done"
  /\ UNCHANGED <<documentExists, createPhase, metadataCreatePhase, metadataTarget>>

RefuseNonemptyDelete ==
  /\ deletePhase = "ready" /\ documentExists
  /\ deletePhase' = "done"
  /\ UNCHANGED <<live, documentExists, metadataExists,
                  metadataReserved, createPhase, metadataCreatePhase, metadataTarget>>

(* Metadata IDs are reserved to their owner while live and forever after *)
(* deletion. A create through another target still holds the lifecycle lock. *)
BeginMetadataCreate(target) ==
  /\ metadataCreatePhase = "idle" /\ ~metadataExists
  /\ (live \/ ~metadataReserved)
  /\ (~CheckMetadataScope \/ ~metadataReserved \/ target = "owner")
  /\ (target # "owner" \/ ~CheckLiveContainer \/ live)
  /\ deletePhase # "ready"
  /\ metadataCreatePhase' = "ready" /\ metadataTarget' = target
  /\ UNCHANGED <<live, documentExists, metadataExists, metadataReserved,
                  createPhase, deletePhase>>

CommitMetadataCreate ==
  /\ metadataCreatePhase = "ready"
  /\ metadataExists' = TRUE /\ metadataCreatePhase' = "done"
  /\ UNCHANGED <<live, documentExists, metadataReserved,
                  createPhase, deletePhase, metadataTarget>>

Next == BeginCreate \/ CommitCreate \/ BeginDelete \/ CommitDelete
        \/ RefuseNonemptyDelete \/ (\E target \in {"owner", "other"}: BeginMetadataCreate(target))
        \/ CommitMetadataCreate
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ {live, documentExists, metadataExists, metadataReserved} \subseteq BOOLEAN
  /\ {createPhase, deletePhase, metadataCreatePhase} \subseteq {"idle", "ready", "done"}
  /\ metadataTarget \in {"owner", "other"}
LinkedDocumentsHaveLiveContainer == documentExists => live
RetiredMetadataIsNeverRecreated == ~live => ~metadataExists
MetadataStaysWithOwner == (metadataExists /\ metadataReserved) => metadataTarget = "owner"
=============================================================================
