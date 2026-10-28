-------------------- MODULE AncestorRecovery --------------------
EXTENDS Naturals

(* Honest rotations retain signed lineage and sealed historical keys.    *)
(* Pins model root -> child -> grandchild. Reads verify each pin against *)
(* the parent's retained signed history; writes require current pins     *)
(* along the entire path. A dishonest server may serve a child pinned to *)
(* a root epoch it invented, which no signed history contains. This     *)
(* model covers availability and currency, not signature or ciphertext   *)
(* implementations.                                                      *)
CONSTANTS MaxEpoch,
          StrictReadParentPin, \* reads accept only the parent's current epoch
          CheckSignedLineage,  \* reads accept only epochs in signed history
          CheckWriteCurrency,  \* writes require current pins on the path
          WriterRepairs        \* the writer may re-key its own path

ASSUME /\ MaxEpoch \in Nat \ {0}
       /\ {StrictReadParentPin, CheckSignedLineage, CheckWriteCurrency,
           WriterRepairs} \subseteq BOOLEAN

VARIABLES rootEpoch,      \* current root epoch; 1..rootEpoch are signed
          childEpoch,     \* current child epoch; 1..childEpoch are signed
          childPin,       \* root epoch the current child manifest pins
          grandchildPin,  \* child epoch the grandchild manifest pins
          servedRootPin,  \* root epoch a served child manifest pins
          readRefused,    \* the device refused an honest read
          inventedRead,   \* the device accepted an invented root epoch
          staleWrite,     \* a write committed over a stale pin
          wrote           \* the device's write committed
vars == << rootEpoch, childEpoch, childPin, grandchildPin, servedRootPin,
           readRefused, inventedRead, staleWrite, wrote >>

(* Signed lineage the device can verify: every epoch the parent has had. *)
SignedRootEpochs == 1..rootEpoch
SignedChildEpochs == 1..childEpoch

TypeOK ==
  /\ rootEpoch \in 1..MaxEpoch
  /\ childEpoch \in 1..MaxEpoch
  /\ childPin \in SignedRootEpochs
  /\ grandchildPin \in SignedChildEpochs
  /\ servedRootPin \in 1..(MaxEpoch + 1)
  /\ {readRefused, inventedRead, staleWrite, wrote} \subseteq BOOLEAN

Init ==
  /\ rootEpoch = 1
  /\ childEpoch = 1
  /\ childPin = 1
  /\ grandchildPin = 1
  /\ servedRootPin = 1
  /\ readRefused = FALSE
  /\ inventedRead = FALSE
  /\ staleWrite = FALSE
  /\ wrote = FALSE

(* A historical pin is readable when it names a signed epoch of its       *)
(* parent. Strict mode is the withdrawn rule that refuses any old pin;    *)
(* without the lineage check a bare numeric range is trusted.            *)
ReadAccepts(pin, current, signed) ==
  IF StrictReadParentPin THEN pin = current
  ELSE IF CheckSignedLineage THEN pin \in signed
  ELSE pin \in 1..(MaxEpoch + 1)

WriteAccepts == childPin = rootEpoch /\ grandchildPin = childEpoch

serverOnly == << readRefused, inventedRead, staleWrite, wrote >>

RotateRoot ==
  /\ rootEpoch < MaxEpoch
  /\ rootEpoch' = rootEpoch + 1
  /\ UNCHANGED << childEpoch, childPin, grandchildPin, servedRootPin >>
  /\ UNCHANGED serverOnly

(* The writer re-keys the child under the current root. The grandchild    *)
(* still pins the child's previous epoch until it is repaired too.        *)
RepairChild ==
  /\ WriterRepairs
  /\ childPin # rootEpoch
  /\ childEpoch < MaxEpoch
  /\ childEpoch' = childEpoch + 1
  /\ childPin' = rootEpoch
  /\ UNCHANGED << rootEpoch, grandchildPin, servedRootPin >>
  /\ UNCHANGED serverOnly

RepairGrandchild ==
  /\ WriterRepairs
  /\ childPin = rootEpoch
  /\ grandchildPin # childEpoch
  /\ grandchildPin' = childEpoch
  /\ UNCHANGED << rootEpoch, childEpoch, childPin, servedRootPin >>
  /\ UNCHANGED serverOnly

(* The server serves the child manifest it holds, or a dishonest one      *)
(* pinned to any root epoch, including one it invented.                   *)
ServeChild ==
  /\ servedRootPin' \in {childPin} \cup 1..(MaxEpoch + 1)
  /\ UNCHANGED << rootEpoch, childEpoch, childPin, grandchildPin >>
  /\ UNCHANGED serverOnly

(* The device reads the whole path as served. An honest path must be     *)
(* readable; an accepted pin outside signed history is an invented read. *)
Read ==
  /\ LET honest == servedRootPin = childPin
         accepted ==
           /\ ReadAccepts(servedRootPin, rootEpoch, SignedRootEpochs)
           /\ ReadAccepts(grandchildPin, childEpoch, SignedChildEpochs)
     IN /\ readRefused' = (readRefused \/ (honest /\ ~accepted))
        /\ inventedRead' =
             (inventedRead \/ (accepted /\ servedRootPin \notin SignedRootEpochs))
  /\ UNCHANGED << rootEpoch, childEpoch, childPin, grandchildPin,
                  servedRootPin, staleWrite, wrote >>

Write ==
  /\ ~wrote
  /\ CheckWriteCurrency => WriteAccepts
  /\ wrote' = TRUE
  /\ staleWrite' = (staleWrite \/ ~WriteAccepts)
  /\ UNCHANGED << rootEpoch, childEpoch, childPin, grandchildPin,
                  servedRootPin, readRefused, inventedRead >>

Next ==
  \/ RotateRoot \/ RepairChild \/ RepairGrandchild
  \/ ServeChild \/ Read \/ Write
  \/ UNCHANGED vars

(* Only the writer's own steps are fair: no other device must act first. *)
Spec ==
  /\ Init
  /\ [][Next]_vars
  /\ WF_vars(RepairChild)
  /\ WF_vars(RepairGrandchild)
  /\ WF_vars(Write)

HonestReadsAvailable == ~readRefused

(* An epoch the root never signed is refused, even in recovery mode:     *)
(* membership comes from signed lineage, not from a numeric range.       *)
UnknownEpochRefused == ~inventedRead

StaleWritesRefused == ~staleWrite

(* The writer can always bring its own path current and write. *)
WriterEventuallyWrites == <>wrote

=================================================================
