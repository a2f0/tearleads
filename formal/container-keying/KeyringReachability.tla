------------------- MODULE KeyringReachability -------------------
EXTENDS FiniteSets, Naturals

(* Container KEK history as three immutable rotation artifacts (#1939):    *)
(* member wraps (retained per epoch), a write-once predecessor bridge      *)
(* (the append-only log), and a sealed keyring snapshot of all predecessor *)
(* keys. Per-entry material-id verification makes a poisoned artifact      *)
(* detected, never silently used, so integrity is modeled as a boolean:    *)
(* an artifact is either honest or unusable.                               *)
(*                                                                         *)
(* A rotator can always mint an honest bridge (it holds the current key),  *)
(* but can seal an HONEST keyring only when the full history is            *)
(* recoverable to it -- the exact-count structural check rejects anything  *)
(* less. Repair is an ordinary honest rotation.                            *)

CONSTANTS MaxEpoch

ASSUME MaxEpoch \in Nat \ {0, 1}

Epochs == 1..MaxEpoch
RotatedEpochs == 2..MaxEpoch

VARIABLES epoch,          \* current key epoch
          bridgeIntact,   \* e -> the write-once bridge from e to e-1 is honest
          keyringHonest,  \* e -> the keyring sealed at e passes verification
          wrapRecoverable \* e -> some retained member wrap for e is usable

vars == << epoch, bridgeIntact, keyringHonest, wrapRecoverable >>

TypeOK ==
  /\ epoch \in Epochs
  /\ bridgeIntact \in [RotatedEpochs -> BOOLEAN]
  /\ keyringHonest \in [RotatedEpochs -> BOOLEAN]
  /\ wrapRecoverable \in [Epochs -> BOOLEAN]

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

(* Everything a current member can deterministically recover from          *)
(* server-persisted state: the current key plus every retained wrap,       *)
(* closed under the log and the keyring ladder. No client caches anywhere. *)
RecoverableEpochs ==
  Closure({epoch} \cup { e \in 1..epoch : wrapRecoverable[e] })

FullHistory == 1..epoch

Init ==
  /\ epoch = 1
  /\ bridgeIntact = [e \in RotatedEpochs |-> TRUE]
  /\ keyringHonest = [e \in RotatedEpochs |-> TRUE]
  /\ wrapRecoverable \in [Epochs -> BOOLEAN]

(* A rotation appends immutable artifacts; nothing already written ever    *)
(* changes. An honest keyring is possible exactly when the rotator can     *)
(* recover the complete history; a poisoned bridge or keyring models a     *)
(* buggy or malicious rotator whose output is detected downstream.        *)
Rotate(honestBridge, honestKeyring) ==
  /\ epoch < MaxEpoch
  /\ honestKeyring => RecoverableEpochs = FullHistory
  /\ epoch' = epoch + 1
  /\ bridgeIntact' = [bridgeIntact EXCEPT ![epoch + 1] = honestBridge]
  /\ keyringHonest' = [keyringHonest EXCEPT ![epoch + 1] = honestKeyring]
  /\ \E wr \in BOOLEAN :
       wrapRecoverable' = [wrapRecoverable EXCEPT ![epoch + 1] = wr]

Next ==
  \/ \E hb \in BOOLEAN, hk \in BOOLEAN : Rotate(hb, hk)
  \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars

(* The append-only log is ground truth: while every bridge is intact, a    *)
(* cold current member rebuilds the complete history regardless of how     *)
(* many keyring snapshots were poisoned.                                   *)
LogGroundTruth ==
  (\A e \in 2..epoch : bridgeIntact[e]) => Closure({epoch}) = FullHistory

(* Severance damage is bounded: an epoch whose bridge suffix is intact is  *)
(* always reachable from the current key alone; a broken bridge orphans    *)
(* only epochs below it.                                                   *)
BoundedSeverance ==
  \A e \in 1..epoch :
    (\A b \in (e + 1)..epoch : bridgeIntact[b]) => e \in Closure({epoch})

(* An honest current snapshot is a complete claim: whenever the served     *)
(* keyring verifies, the full history really is recoverable. This is the   *)
(* composed guarantee that sealing requires full recoverability and no     *)
(* later action can shrink it (artifacts are immutable, wraps retained).   *)
HonestSnapshotComplete ==
  (epoch > 1 /\ keyringHonest[epoch]) => RecoverableEpochs = FullHistory

(* The retained-wrap backstop composes with the log: any epoch anchored by *)
(* a usable wrap at or above it is recoverable even under a poisoned       *)
(* snapshot, provided the bridge path between them held.                   *)
WrapBackstop ==
  \A e \in 1..epoch :
    \A a \in e..epoch :
      ((wrapRecoverable[a] \/ a = epoch)
        /\ (\A b \in (e + 1)..a : bridgeIntact[b]))
          => e \in RecoverableEpochs

=============================================================================
