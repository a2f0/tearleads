------------------- MODULE KeyringReachability -------------------
EXTENDS FiniteSets, Naturals

(* Container KEK history as three immutable rotation artifacts (#1939):    *)
(* member wraps (retained per epoch, owned by the members they address),   *)
(* a write-once predecessor bridge (the append-only log), and a sealed     *)
(* keyring snapshot of all predecessor keys. Per-entry material-id         *)
(* verification makes a poisoned artifact detected, never silently used,   *)
(* so integrity is modeled as a boolean: honest or unusable.               *)
(*                                                                         *)
(* Recovery is member-scoped: a wrap anchors recovery only for a member it *)
(* addresses, and only members with current access hold the current KEK.   *)
(* A rotator can always mint an honest bridge (it holds the current key),  *)
(* but can seal an HONEST keyring only when the full history is            *)
(* recoverable to that rotator personally -- the exact-count structural    *)
(* check rejects anything less. Repair is an ordinary honest rotation.     *)
(*                                                                         *)
(* Descendants (children created under this container) pin the PARENT      *)
(* epoch current when their key epoch was minted; rotations do not rewrite *)
(* that pin. Verification of a descendant must admit a pin covered by the  *)
(* parent's retained history (the sealed keyring ladder), so an ancestor   *)
(* rotation never strands the subtree and a lazy rekey stays performable.  *)
(* StrictParentEpochPin models the vulnerable rule that accepts only the   *)
(* parent's CURRENT epoch: one rotation strands every descendant pinned    *)
(* earlier. Reads shipped that way until #2330; they now resolve the pin   *)
(* through `resolveContainerKekParentBinding`. Writes still demand current *)
(* pins, and InaccessibleIntermediateRepair covers who restores them.      *)

CONSTANTS MaxEpoch, Members, Descendants, StrictParentEpochPin

ASSUME /\ MaxEpoch \in Nat \ {0, 1}
       /\ Members # {}
       /\ Descendants # {}
       /\ IsFiniteSet(Members)
       /\ IsFiniteSet(Descendants)
       /\ StrictParentEpochPin \in BOOLEAN

Epochs == 1..MaxEpoch
RotatedEpochs == 2..MaxEpoch

VARIABLES epoch,          \* current key epoch
          bridgeIntact,   \* e -> the write-once bridge from e to e-1 is honest
          keyringHonest,  \* e -> the keyring sealed at e passes verification
          wrapHolders,    \* e -> members whose retained wrap for e is usable
          membersAtEpoch, \* e -> membership when e was minted (history var)
          currentMembers, \* members with current access
          childPin        \* child -> the parent epoch its key epoch pins

vars == << epoch, bridgeIntact, keyringHonest, wrapHolders, membersAtEpoch,
           currentMembers, childPin >>

TypeOK ==
  /\ epoch \in Epochs
  /\ bridgeIntact \in [RotatedEpochs -> BOOLEAN]
  /\ keyringHonest \in [RotatedEpochs -> BOOLEAN]
  /\ wrapHolders \in [Epochs -> SUBSET Members]
  /\ membersAtEpoch \in [Epochs -> SUBSET Members]
  /\ currentMembers \in (SUBSET Members) \ {{}}
  /\ childPin \in [Descendants -> Epochs]

(* Wraps address only the members present when their epoch was minted --   *)
(* the write path derives recipient targets from the manifest.             *)
WrapsRespectMembership ==
  \A e \in 1..epoch : wrapHolders[e] \subseteq membersAtEpoch[e]

(* One recovery step from a set of held keys: an intact bridge at e yields *)
(* e-1; an honest retained keyring at e yields every epoch below e (the    *)
(* fallback ladder -- historical keyrings are immutable rows).             *)
Expand(S) ==
  S \cup { e - 1 :
           e \in { x \in S \cap (2..epoch) : bridgeIntact[x] } }
    \cup UNION { 1..(e - 1) :
                 e \in { x \in S \cap (2..epoch) : keyringHonest[x] } }

RECURSIVE Iterate(_, _)
Iterate(S, n) == IF n = 0 THEN S ELSE Iterate(Expand(S), n - 1)

(* Recovery steps only descend, so MaxEpoch iterations reach the fixpoint. *)
Closure(S) == Iterate(S, MaxEpoch)

(* What one CURRENT member can deterministically recover from              *)
(* server-persisted state: the current KEK (their current wrap) plus their *)
(* OWN retained historical wraps, closed under the log and the keyring     *)
(* ladder. Another member's wrap never anchors this member's recovery, and *)
(* a revoked member is not a recovery agent at all.                        *)
PersonalRecoverable(m) ==
  Closure({epoch} \cup { e \in 1..epoch : m \in wrapHolders[e] })

FullHistory == 1..epoch

Init ==
  /\ epoch = 1
  /\ bridgeIntact = [e \in RotatedEpochs |-> TRUE]
  /\ keyringHonest = [e \in RotatedEpochs |-> TRUE]
  /\ currentMembers \in (SUBSET Members) \ {{}}
  /\ membersAtEpoch = [e \in Epochs |-> IF e = 1 THEN currentMembers ELSE {}]
  /\ childPin = [child \in Descendants |-> 1]
  /\ \E holders \in SUBSET currentMembers :
       wrapHolders = [e \in Epochs |-> IF e = 1 THEN holders ELSE {}]

(* A child is created (or later re-pinned by its own create/rekey/move)    *)
(* against the parent epoch current at that moment. Rotation never rewrites *)
(* the pin: production stores parentContainerKeyEpochId with the child's   *)
(* signed key epoch and no descendant update accompanies a rotation.       *)
PinChild(child) ==
  /\ childPin' = [childPin EXCEPT ![child] = epoch]
  /\ UNCHANGED <<epoch, bridgeIntact, keyringHonest, wrapHolders,
                 membersAtEpoch, currentMembers>>

(* A rotation appends immutable artifacts and may change membership        *)
(* (revocations are rotations; additive grants fold in conservatively).    *)
(* Nothing already written ever changes: old bridges, keyrings, wraps, and *)
(* the membership history are append-only. An honest keyring is possible   *)
(* exactly when the ROTATOR -- a current member -- can personally recover  *)
(* the complete history; a poisoned artifact models a buggy or malicious   *)
(* rotator whose output is detected downstream.                            *)
Rotate(honestBridge, honestKeyring) ==
  /\ epoch < MaxEpoch
  /\ \E rotator \in currentMembers :
       honestKeyring => PersonalRecoverable(rotator) = FullHistory
  /\ \E nextMembers \in (SUBSET Members) \ {{}} :
       \E holders \in SUBSET nextMembers :
         /\ currentMembers' = nextMembers
         /\ wrapHolders' = [wrapHolders EXCEPT ![epoch + 1] = holders]
         /\ membersAtEpoch' = [membersAtEpoch EXCEPT ![epoch + 1] = nextMembers]
  /\ epoch' = epoch + 1
  /\ bridgeIntact' = [bridgeIntact EXCEPT ![epoch + 1] = honestBridge]
  /\ keyringHonest' = [keyringHonest EXCEPT ![epoch + 1] = honestKeyring]
  /\ childPin' = childPin

Next ==
  \/ \E hb \in BOOLEAN, hk \in BOOLEAN : Rotate(hb, hk)
  \/ \E child \in Descendants : PinChild(child)
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars

(* The append-only log is ground truth: while every bridge is intact, any  *)
(* current member rebuilds the complete history from the current KEK       *)
(* alone, regardless of wrap ownership and of how many keyring snapshots   *)
(* were poisoned.                                                          *)
LogGroundTruth ==
  (\A e \in 2..epoch : bridgeIntact[e]) => Closure({epoch}) = FullHistory

(* Severance damage is bounded: an epoch whose bridge suffix is intact is  *)
(* always reachable from the current key alone; a broken bridge orphans    *)
(* only epochs below it.                                                   *)
BoundedSeverance ==
  \A e \in 1..epoch :
    (\A b \in (e + 1)..epoch : bridgeIntact[b]) => e \in Closure({epoch})

(* An honest current snapshot is a complete claim for EVERY current        *)
(* member, including members who own no historical wraps at all (e.g. a    *)
(* newcomer granted after every rotation): whenever the served keyring     *)
(* verifies, each current member personally recovers the full history.     *)
HonestSnapshotComplete ==
  (epoch > 1 /\ keyringHonest[epoch]) =>
    \A m \in currentMembers : PersonalRecoverable(m) = FullHistory

(* The retained-wrap backstop is member-scoped and composes with the log:  *)
(* an epoch anchored by a wrap the member OWNS at or above it is           *)
(* recoverable by that member even under a poisoned snapshot, provided     *)
(* the bridge path between them held. Ownership matters: the anchor must   *)
(* be m's own wrap or the current KEK.                                     *)
WrapBackstop ==
  \A m \in currentMembers :
    \A e \in 1..epoch :
      \A a \in e..epoch :
        ((m \in wrapHolders[a] \/ a = epoch)
          /\ (\A b \in (e + 1)..a : bridgeIntact[b]))
            => e \in PersonalRecoverable(m)

(* The descendant pin rule. The fixed rule accepts a pin covered by the     *)
(* parent's retained history -- exactly the epochs Closure({epoch}) reaches *)
(* through intact bridges and honest keyrings, which is what an honest      *)
(* server can still unwrap for a descendant (the keyring ladder keeps every *)
(* predecessor epoch). The vulnerable rule accepts only the parent's        *)
(* CURRENT epoch, so an ordinary rotation strands every earlier-pinned      *)
(* descendant even though the parent's retained history still covers it.    *)
PinnedEpochVerifiable(child) ==
  IF StrictParentEpochPin
    THEN childPin[child] = epoch
    ELSE childPin[child] \in Closure({epoch})

(* Honest serving is the append-only log ground truth: while every bridge   *)
(* is intact, the current key reaches every retained epoch, so no           *)
(* descendant may be refused. A child is refused only when a poisoned       *)
(* artifact genuinely severs its pinned epoch -- an honest failure the      *)
(* server's own state cannot serve, never a stranding of honest data.       *)
HonestServesNeverStranded ==
  (\A e \in 2..epoch : bridgeIntact[e]) =>
    \A child \in Descendants : PinnedEpochVerifiable(child)

=============================================================================
