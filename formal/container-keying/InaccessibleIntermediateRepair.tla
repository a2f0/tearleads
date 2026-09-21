-------------- MODULE InaccessibleIntermediateRepair --------------
EXTENDS Naturals

(* A path root -> mid -> leaf. Members with access at the root inherit     *)
(* access and keys down the whole path. The leaf writer's only grant is on *)
(* the leaf. Rotating the root revokes a member who keeps every root key   *)
(* minted so far, and through the parent wraps and sealed keyrings every   *)
(* descendant key still pinned beneath them.                               *)
(*                                                                         *)
(* Three rules are modeled, each with a negative control:                  *)
(*   WholePathCurrency      new ciphertext requires every pin on the path  *)
(*                          to be current, not only the writer's own edge. *)
(*   RotationCarriesRepairs a rotation atomically re-keys every descendant *)
(*                          that sits above a granted container, so no     *)
(*                          writer ever waits on another device's write.   *)
(*   WriterGivenMidKey      the rejected alternative: unblock the leaf     *)
(*                          writer by handing it the intermediate's key.   *)
(*                                                                         *)
(* Fairness follows NoBrickedDevice: only the blocked device's own steps   *)
(* are fair. Another member MAY repair the intermediate, but nothing may   *)
(* depend on it. Signatures, ciphertext, and authorization are abstracted. *)
CONSTANTS MaxEpoch, WholePathCurrency, RotationCarriesRepairs,
          WriterGivenMidKey

ASSUME /\ MaxEpoch \in Nat \ {0, 1}
       /\ WholePathCurrency \in BOOLEAN
       /\ RotationCarriesRepairs \in BOOLEAN
       /\ WriterGivenMidKey \in BOOLEAN

Epochs == 1..MaxEpoch

VARIABLES rootEpoch,       \* current root key epoch
          midEpoch,        \* current mid key epoch
          leafEpoch,       \* current leaf key epoch
          midPinOf,        \* mid epoch -> root epoch it was wrapped to (0 = unminted)
          leafPinOf,       \* leaf epoch -> mid epoch it was wrapped to (0 = unminted)
          revokedThrough,  \* the revoked member holds root epochs 1..this
          writerHoldsMid,  \* the leaf writer was given an intermediate key
          leakedWrite      \* content was encrypted under a key the revoked member reaches

vars == <<rootEpoch, midEpoch, leafEpoch, midPinOf, leafPinOf,
          revokedThrough, writerHoldsMid, leakedWrite>>

TypeOK ==
  /\ rootEpoch \in Epochs
  /\ midEpoch \in Epochs
  /\ leafEpoch \in Epochs
  /\ midPinOf \in [Epochs -> 0..MaxEpoch]
  /\ leafPinOf \in [Epochs -> 0..MaxEpoch]
  /\ revokedThrough \in 0..MaxEpoch
  /\ writerHoldsMid \in BOOLEAN
  /\ leakedWrite \in BOOLEAN

Init ==
  /\ rootEpoch = 1
  /\ midEpoch = 1
  /\ leafEpoch = 1
  /\ midPinOf = [e \in Epochs |-> IF e = 1 THEN 1 ELSE 0]
  /\ leafPinOf = [e \in Epochs |-> IF e = 1 THEN 1 ELSE 0]
  /\ revokedThrough = 0
  /\ writerHoldsMid = FALSE
  /\ leakedWrite = FALSE

MidCurrent == midPinOf[midEpoch] = rootEpoch
LeafCurrent == leafPinOf[leafEpoch] = midEpoch

(* Holding one epoch of a container opens every earlier one through its    *)
(* sealed keyring, and a parent epoch opens the child epochs wrapped to it. *)
RevokedReachesMid ==
  {e \in 1..midEpoch :
     \E k \in e..midEpoch : midPinOf[k] \in 1..revokedThrough}
RevokedReachesLeaf ==
  {e \in 1..leafEpoch :
     \E k \in e..leafEpoch : leafPinOf[k] \in RevokedReachesMid}

(* A revocation by a member with access at the root. `mid` sits above the  *)
(* granted leaf, so the rotation must carry its re-key in one transaction: *)
(* the rotator holds every key beneath the root, so it always can. The     *)
(* leaf is the writer's own to repair and is never part of the set.        *)
RotateRoot ==
  /\ rootEpoch < MaxEpoch
  /\ revokedThrough' = rootEpoch
  /\ rootEpoch' = rootEpoch + 1
  /\ IF RotationCarriesRepairs
       THEN /\ midEpoch' = midEpoch + 1
            /\ midPinOf' = [midPinOf EXCEPT ![midEpoch + 1] = rootEpoch + 1]
       ELSE UNCHANGED <<midEpoch, midPinOf>>
  /\ UNCHANGED <<leafEpoch, leafPinOf, writerHoldsMid, leakedWrite>>

MintMid ==
  /\ ~MidCurrent
  /\ midEpoch < MaxEpoch
  /\ midEpoch' = midEpoch + 1
  /\ midPinOf' = [midPinOf EXCEPT ![midEpoch + 1] = rootEpoch]

(* Another member with access at `mid` happens to write beneath it and     *)
(* repairs it on the way. Possible, never owed: this step is not fair.     *)
OtherMemberRepairsMid ==
  /\ MintMid
  /\ UNCHANGED <<rootEpoch, leafEpoch, leafPinOf, revokedThrough,
                 writerHoldsMid, leakedWrite>>

(* The rejected design: serve the leaf writer the stale intermediate key.  *)
WriterRepairMid ==
  /\ WriterGivenMidKey
  /\ MintMid
  /\ writerHoldsMid' = TRUE
  /\ UNCHANGED <<rootEpoch, leafEpoch, leafPinOf, revokedThrough, leakedWrite>>

(* Public parent wrapping: below a current parent the leaf writer re-keys  *)
(* its own container with the parent's public key alone.                   *)
WriterRepairLeaf ==
  /\ MidCurrent
  /\ ~LeafCurrent
  /\ leafEpoch < MaxEpoch
  /\ leafEpoch' = leafEpoch + 1
  /\ leafPinOf' = [leafPinOf EXCEPT ![leafEpoch + 1] = midEpoch]
  /\ UNCHANGED <<rootEpoch, midEpoch, midPinOf, revokedThrough,
                 writerHoldsMid, leakedWrite>>

WriteAccepts ==
  IF WholePathCurrency THEN MidCurrent /\ LeafCurrent ELSE LeafCurrent

(* A refused write parks: the queue keeps it and nothing else changes.     *)
WriterWrites ==
  /\ WriteAccepts
  /\ leakedWrite' = (leakedWrite \/ leafEpoch \in RevokedReachesLeaf)
  /\ UNCHANGED <<rootEpoch, midEpoch, leafEpoch, midPinOf, leafPinOf,
                 revokedThrough, writerHoldsMid>>

Next ==
  \/ RotateRoot
  \/ OtherMemberRepairsMid
  \/ WriterRepairMid
  \/ WriterRepairLeaf
  \/ WriterWrites
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars
(* Only the blocked writer's own repair is fair.                           *)
FairSpec == Spec /\ WF_vars(WriterRepairLeaf)

(* Revocation is forward-only, and that is all it is: nothing written      *)
(* after it may sit under a key the revoked member can still open.         *)
NoWriteUnderRevokedReach == ~leakedWrite

(* The leaf writer's grant covers the leaf. An intermediate key would also *)
(* open that container's other children.                                   *)
WriterHoldsOnlyGrantedKeys == ~writerHoldsMid

(* No-brick for writes: whatever the other devices do or never do again,   *)
(* the leaf writer restores write currency by its own steps alone.         *)
WriterEventuallyUnblocked == <>[](MidCurrent /\ LeafCurrent)

(* The safety face of the same rule: the levels above the writer's grant   *)
(* are never left stale by a committed rotation.                           *)
GrantedPathNeverStranded == RotationCarriesRepairs => MidCurrent

=============================================================================
