--------------------- MODULE OrganizationDirectoryKey ---------------------
(* The organization directory key follows the Admins projection (#2903     *)
(* P18). A directory write that keeps the admins keeps the key, epoch and *)
(* envelopes; one that only adds admins keeps the key and wraps it for the *)
(* added admins; any removal rotates to a fresh key wrapped for every      *)
(* remaining admin. `learned[u]` is every key epoch user u has ever        *)
(* unwrapped: an envelope, once served, cannot be taken back. `verifiable` *)
(* is whether the writing admin can open the signed key with its own       *)
(* envelope and check it; when it cannot, the write rotates.               *)
EXTENDS Naturals, FiniteSets
CONSTANTS Users, MaxEpoch, RotateOnShrink, KeepWhenVerifiable
ASSUME RotateOnShrink \in BOOLEAN /\ KeepWhenVerifiable \in BOOLEAN

VARIABLES admins, epoch, learned, verifiable
vars == <<admins, epoch, learned, verifiable>>

Init ==
  \E first \in Users:
    /\ admins = {first}
    /\ epoch = 1
    /\ learned = [u \in Users |-> IF u = first THEN {1} ELSE {}]
    /\ verifiable = TRUE

(* A fresh key wrapped for every admin of the successor projection. *)
Rotate(next) ==
  /\ epoch < MaxEpoch
  /\ admins' = next
  /\ epoch' = epoch + 1
  /\ learned' = [u \in Users |->
       IF u \in next THEN learned[u] \cup {epoch + 1} ELSE learned[u]]
  /\ verifiable' = TRUE

(* The held key, re-served unchanged and wrapped for the given admins. *)
Keep(next) ==
  /\ admins' = next
  /\ UNCHANGED epoch
  /\ learned' = [u \in Users |->
       IF u \in next THEN learned[u] \cup {epoch} ELSE learned[u]]
  /\ UNCHANGED verifiable

(* The writer loses or regains the means to check the signed key: its KEM  *)
(* secret on this device, and a served envelope and key that verify.       *)
VerificationChanges ==
  /\ verifiable' = ~verifiable
  /\ UNCHANGED <<admins, epoch, learned>>

(* A kept or grown key needs the signer's envelope to open the signed key; *)
(* when it does not, the write rotates instead.                            *)
KeepOrRotate(next) ==
  IF verifiable /\ KeepWhenVerifiable THEN Keep(next) ELSE Rotate(next)

Unchanged == KeepOrRotate(admins)

Grow(u) ==
  /\ u \notin admins
  /\ KeepOrRotate(admins \cup {u})

Shrink(u) ==
  /\ u \in admins /\ admins # {u}
  /\ IF RotateOnShrink THEN Rotate(admins \ {u}) ELSE Keep(admins \ {u})

Next ==
  \/ Unchanged
  \/ VerificationChanges
  \/ \E u \in Users: Grow(u) \/ Shrink(u)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ admins \subseteq Users /\ admins # {}
  /\ epoch \in 1..MaxEpoch
  /\ learned \in [Users -> SUBSET (1..MaxEpoch)]
  /\ verifiable \in BOOLEAN

(* Revocation by rotation: a removed admin never holds the current key. *)
RemovedAdminLacksCurrentKey ==
  \A u \in Users \ admins: epoch \notin learned[u]
(* Every current admin can open the current directory key, given that each *)
(* envelope opens for its admin; the SDK checks only the signer's own.     *)
AdminsHoldCurrentKey ==
  \A u \in admins: epoch \in learned[u]
(* The key epoch holds across every write that removes no admin, while the *)
(* writer can verify the held key: a builder that always rotates fails.   *)
EpochHeldUnlessShrink ==
  [][verifiable /\ admins \subseteq admins' => epoch' = epoch]_vars
=============================================================================
