-------------------- MODULE AncestorRecovery --------------------
EXTENDS Naturals

(* Honest rotations retain signed lineage and sealed historical keys.    *)
(* Pins model root -> child -> grandchild. Reads verify historical pins; *)
(* writes require current pins along the entire path. This model covers  *)
(* availability/currency, not signature or ciphertext implementations.    *)
CONSTANTS MaxEpoch, StrictReadParentPin
VARIABLES rootEpoch, childEpoch, childPin, grandchildPin
vars == <<rootEpoch, childEpoch, childPin, grandchildPin>>

TypeOK ==
  /\ rootEpoch \in 1..MaxEpoch
  /\ childEpoch \in 1..MaxEpoch
  /\ childPin \in 1..rootEpoch
  /\ grandchildPin \in 1..childEpoch

Init ==
  /\ rootEpoch = 1
  /\ childEpoch = 1
  /\ childPin = 1
  /\ grandchildPin = 1

RotateRoot ==
  /\ rootEpoch < MaxEpoch
  /\ rootEpoch' = rootEpoch + 1
  /\ UNCHANGED <<childEpoch, childPin, grandchildPin>>

RepairChild ==
  /\ childEpoch < MaxEpoch
  /\ childEpoch' = childEpoch + 1
  /\ childPin' = rootEpoch
  /\ UNCHANGED <<rootEpoch, grandchildPin>>

RepairGrandchild ==
  /\ childPin = rootEpoch
  /\ grandchildPin' = childEpoch
  /\ UNCHANGED <<rootEpoch, childEpoch, childPin>>

Next == RotateRoot \/ RepairChild \/ RepairGrandchild \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

ReadAccepts(pin, current) ==
  IF StrictReadParentPin THEN pin = current ELSE pin \in 1..current

HonestReadsAvailable ==
  /\ ReadAccepts(childPin, rootEpoch)
  /\ ReadAccepts(grandchildPin, childEpoch)

(* False for an invented epoch, even in recovery mode. Actual membership  *)
(* is established by signed lineage, not by accepting a numeric range.   *)
UnknownEpochRefused == ~ReadAccepts(rootEpoch + 1, rootEpoch)

WriteAccepts == childPin = rootEpoch /\ grandchildPin = childEpoch
StaleWritesRefused ==
  (childPin # rootEpoch \/ grandchildPin # childEpoch) => ~WriteAccepts

=================================================================
