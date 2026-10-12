----------------------- MODULE PendingAttachmentDetach -----------------------
EXTENDS Naturals
CONSTANTS KeepPendingMarker, InstallPendingMarker
ASSUME {KeepPendingMarker, InstallPendingMarker} \subseteq BOOLEAN
VARIABLES pending, held, remoteBound, removed, marker, opened, mapped, bytes
vars == <<pending, held, remoteBound, removed, marker, opened, mapped, bytes>>

(* The pending row already carries a durable upload identity. The client
   cannot tell whether a lost bind response committed on the server. *)
Init == /\ pending = TRUE /\ held = FALSE /\ remoteBound = FALSE
        /\ removed = FALSE /\ marker = FALSE /\ opened = TRUE
        /\ mapped = FALSE /\ bytes = TRUE

UploadCommitted ==
  /\ pending /\ ~remoteBound
  /\ remoteBound' = TRUE
  /\ UNCHANGED <<pending, held, removed, marker, opened, mapped, bytes>>

Settle ==
  /\ pending /\ remoteBound /\ opened
  /\ pending' = FALSE /\ held' = TRUE /\ mapped' = TRUE
  /\ UNCHANGED <<remoteBound, removed, marker, opened, bytes>>

Remove ==
  /\ opened /\ ~removed /\ (pending \/ held)
  /\ removed' = TRUE /\ pending' = FALSE /\ held' = FALSE
  /\ marker' = (held \/ KeepPendingMarker)
  /\ mapped' = (held \/ InstallPendingMarker)
  /\ UNCHANGED <<remoteBound, opened, bytes>>

Crash ==
  /\ opened
  /\ opened' = FALSE /\ mapped' = FALSE
  /\ UNCHANGED <<pending, held, remoteBound, removed, marker, bytes>>

Reload ==
  /\ ~opened
  /\ opened' = TRUE /\ mapped' = (held \/ marker)
  /\ UNCHANGED <<pending, held, remoteBound, removed, marker, bytes>>

(* Sync lists the remote bindings before cleaning a marker, so this also
   handles an upload whose bind never committed, and idempotent retries. *)
Detach ==
  /\ opened /\ removed /\ mapped /\ remoteBound
  /\ remoteBound' = FALSE
  /\ UNCHANGED <<pending, held, removed, marker, opened, mapped, bytes>>

Drop ==
  /\ opened /\ removed /\ mapped /\ ~remoteBound
  /\ marker' = FALSE /\ mapped' = FALSE
  /\ UNCHANGED <<pending, held, remoteBound, removed, opened, bytes>>

Reclaim ==
  /\ ~pending /\ ~held /\ ~marker /\ bytes
  /\ bytes' = FALSE
  /\ UNCHANGED <<pending, held, remoteBound, removed, marker, opened, mapped>>

Idle == UNCHANGED vars
Next == UploadCommitted \/ Settle \/ Remove \/ Crash \/ Reload
        \/ Detach \/ Drop \/ Reclaim \/ Idle
(* Strong fairness of detach permits arbitrary restarts but assumes the
   client eventually gets a successful online turn while open. *)
Spec == Init /\ [][Next]_vars /\ WF_vars(Reload) /\ SF_vars(Detach)
TypeOK == {pending, held, remoteBound, removed, marker, opened, mapped, bytes}
          \subseteq BOOLEAN
RemovedBindingHasMarker == (removed /\ remoteBound) => marker
OpenRemovalIsMapped == (opened /\ removed /\ marker) => mapped
ReferencedBytesRemain == (pending \/ held \/ marker) => bytes
RemovedBindingEventuallyDetached == (removed /\ remoteBound) ~> ~remoteBound
=============================================================================
