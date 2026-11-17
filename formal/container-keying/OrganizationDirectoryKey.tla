--------------------- MODULE OrganizationDirectoryKey ---------------------
(* The organization directory key follows the Admins projection (#2903     *)
(* P18). A directory write that keeps the admins keeps the key, epoch and *)
(* envelopes; one that only adds admins keeps the key and wraps it for the *)
(* added admins; any removal rotates to a fresh key wrapped for every      *)
(* remaining admin. `learned[u]` is every key epoch user u has ever        *)
(* unwrapped: an envelope, once served, cannot be taken back.              *)
EXTENDS Naturals, FiniteSets
CONSTANTS Users, MaxEpoch, RotateOnShrink, KeepOnGrow
ASSUME RotateOnShrink \in BOOLEAN /\ KeepOnGrow \in BOOLEAN

VARIABLES admins, epoch, learned
vars == <<admins, epoch, learned>>

Init ==
  \E first \in Users:
    /\ admins = {first}
    /\ epoch = 1
    /\ learned = [u \in Users |-> IF u = first THEN {1} ELSE {}]

(* A fresh key wrapped for every admin of the successor projection. *)
Rotate(next) ==
  /\ epoch < MaxEpoch
  /\ admins' = next
  /\ epoch' = epoch + 1
  /\ learned' = [u \in Users |->
       IF u \in next THEN learned[u] \cup {epoch + 1} ELSE learned[u]]

(* The held key, re-served unchanged and wrapped for the given admins. *)
Keep(next) ==
  /\ admins' = next
  /\ UNCHANGED epoch
  /\ learned' = [u \in Users |->
       IF u \in next THEN learned[u] \cup {epoch} ELSE learned[u]]

(* A kept or grown key needs the signer's envelope to open the signed key; *)
(* when it does not, the write rotates instead, so each write may do either. *)
Unchanged == Keep(admins) \/ Rotate(admins)

Grow(u) ==
  /\ u \notin admins
  /\ IF KeepOnGrow
       THEN Keep(admins \cup {u}) \/ Rotate(admins \cup {u})
       ELSE Rotate(admins \cup {u})

Shrink(u) ==
  /\ u \in admins /\ admins # {u}
  /\ IF RotateOnShrink THEN Rotate(admins \ {u}) ELSE Keep(admins \ {u})

Next ==
  \/ Unchanged
  \/ \E u \in Users: Grow(u) \/ Shrink(u)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ admins \subseteq Users /\ admins # {}
  /\ epoch \in 1..MaxEpoch
  /\ learned \in [Users -> SUBSET (1..MaxEpoch)]

(* Revocation by rotation: a removed admin never holds the current key. *)
RemovedAdminLacksCurrentKey ==
  \A u \in Users \ admins: epoch \notin learned[u]
(* Every current admin can open the current directory key, given that each *)
(* envelope opens for its admin; the SDK checks only the signer's own.     *)
AdminsHoldCurrentKey ==
  \A u \in admins: epoch \in learned[u]
=============================================================================
