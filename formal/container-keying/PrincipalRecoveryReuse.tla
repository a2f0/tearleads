----------------------- MODULE PrincipalRecoveryReuse -----------------------
EXTENDS Naturals

(***************************************************************************)
(* Reuse of authenticated organization-directory recovery inside one       *)
(* workflow operation (#2522). An honest server advances the directory     *)
(* head (a revocation is a rotation, so it is an advance). Each operation  *)
(* reads the server-current head once (the bare discovery read), then      *)
(* recovers that exact head. A completed local stage of the exact pinned   *)
(* head is accepted without a confirmation read; a stored current that     *)
(* fails its check is replayed online instead of refused. Later            *)
(* collections in the same operation reuse the recovered directory until a *)
(* realtime hint or a durable pin past the memoized head evicts it; the    *)
(* memo never outlives its operation. Production is not atomic: hints and  *)
(* pins may change between a collection's reads and the entry it stores,   *)
(* so an entry carries the epoch observed before its reads (a derived      *)
(* citation keeps its source's). A value handed out from the memo stays    *)
(* bound to its producer's lifetime until its point of use. memo is the    *)
(* only in-memory reuse of recovered directory and Admins evidence; a      *)
(* caller's policy cache keeps bare policies and resolves scoped evidence  *)
(* through it. Organization provisioning pins the founding head the      *)
(* device signed once the server acknowledges the commit; priming then     *)
(* verifies those states into a completed durable stage in a later step,   *)
(* and writes nothing once the provisioning identity or database changed.  *)
(* Priming writes no memo entry, so later collections follow every rule   *)
(* above. Each parameter is a production guard; negative controls disable *)
(* one at a time.                                                          *)
(*                                                                         *)
(* In production an operation is one reconciliation pass or one user       *)
(* workflow: its root mints an operation token, every warmer created with  *)
(* it shares one memo, and a warmer without a token is its own operation.  *)
(* Freshness is therefore established at pass start (BeginOperation),      *)
(* which FreshPerOperation already states. Discovery may name the head of  *)
(* the held verified prefix (ConditionalDiscovery); the device reuses that *)
(* head only when an `unchanged` reply names exactly it, and any other     *)
(* reply falls back to the bare read.                                      *)
(***************************************************************************)

CONSTANTS MaxHead, MaxOps, MaxHints,
          DiscoverEachOperation,       \* the bare discovery read stays per operation
          ShortcutRequiresComplete,    \* only a completed stage of the pinned head skips its read
          ReplayRejectedStoredCurrent, \* a rejected stored current replays online
          MemoPerOperation,            \* the memo dies with its operation
          EvictOnHint,                 \* a realtime hint naming the organization evicts
          EvictOnCheckpoint,           \* a durable pin past the memoized head evicts
          StampObservedEpoch,          \* an entry keeps the epoch observed before its reads
          CarryProducerLifetime,       \* a reused value checks its producer at the point of use
          PrimeRequiresAcknowledgement,\* priming follows the server's commit acknowledgement
          PrimeChecksScope,            \* priming writes only in its provisioning scope
          UnchangedNamesHeld           \* an `unchanged` reply is reused only if it names the held head

ASSUME /\ MaxHead \in Nat \ {0}
       /\ MaxOps \in Nat \ {0}
       /\ MaxHints \in Nat
       /\ {DiscoverEachOperation, ShortcutRequiresComplete,
           ReplayRejectedStoredCurrent, MemoPerOperation, EvictOnHint,
           EvictOnCheckpoint, StampObservedEpoch, CarryProducerLifetime,
           PrimeRequiresAcknowledgement, PrimeChecksScope,
           UnchangedNamesHeld} \subseteq BOOLEAN

Heads == 1..MaxHead
StageStates == {"none", "partial", "complete", "rejected"}
NoMemo == [head |-> 0, op |-> 0, epoch |-> 0, alive |-> FALSE]
Kinds == {"none", "discover", "derive", "reuse"}
NoPending == [kind |-> "none", head |-> 0, epoch |-> 0, floor |-> 0,
              alive |-> TRUE]
NoUse == [head |-> 0, start |-> 0, floor |-> 0, pin |-> 0, verified |-> TRUE]

VARIABLES serverHead,  \* honest current directory head
          pin,         \* durable local checkpoint (0: none)
          stage,       \* local recovery stage per exact head
          op,          \* current operation id (0: none yet)
          active,      \* an operation is running
          startHead,   \* server head when the current operation began
          memo,        \* the operation's recovered directory
          pending,     \* a collection between its reads and its stored entry
          epoch,       \* realtime hints delivered for the organization
          floor,       \* server head when the last hint was sent
          lastUse,     \* ghost: the last directory a collection accepted
          refused,     \* ghost: an honest server's directory was refused
          usedExpired, \* ghost: a value was used after its producer expired
          behindPin,   \* ghost: the memo handed out a head below the durable pin
          primeHead,   \* founding head awaiting priming (0: none)
          switched,    \* the provisioning identity or database is no longer active
          foreignPrime \* ghost: priming wrote after its scope switched

primeVars == <<primeHead, switched, foreignPrime>>
vars == <<serverHead, pin, stage, op, active, startHead, memo, pending, epoch,
          floor, lastUse, refused, usedExpired, behindPin, primeHead, switched,
          foreignPrime>>

TypeOK ==
  /\ serverHead \in Heads
  /\ pin \in 0..MaxHead
  /\ stage \in [Heads -> StageStates]
  /\ op \in 0..MaxOps
  /\ active \in BOOLEAN
  /\ startHead \in 0..MaxHead
  /\ memo \in [head: 0..MaxHead, op: 0..MaxOps, epoch: 0..MaxHints,
               alive: BOOLEAN]
  /\ pending \in [kind: Kinds, head: 0..MaxHead, epoch: 0..MaxHints,
                  floor: 0..MaxHead, alive: BOOLEAN]
  /\ usedExpired \in BOOLEAN
  /\ behindPin \in BOOLEAN
  /\ epoch \in 0..MaxHints
  /\ floor \in 0..MaxHead
  /\ lastUse \in [head: 0..MaxHead, start: 0..MaxHead, floor: 0..MaxHead,
                  pin: 0..MaxHead, verified: BOOLEAN]
  /\ refused \in BOOLEAN
  /\ primeHead \in 0..MaxHead
  /\ switched \in BOOLEAN
  /\ foreignPrime \in BOOLEAN

Init ==
  /\ serverHead = 1
  /\ pin = 0
  /\ stage = [h \in Heads |-> "none"]
  /\ op = 0
  /\ active = FALSE
  /\ startHead = 0
  /\ memo = NoMemo
  /\ pending = NoPending
  /\ epoch = 0
  /\ floor = 0
  /\ lastUse = NoUse
  /\ refused = FALSE
  /\ usedExpired = FALSE
  /\ behindPin = FALSE
  /\ primeHead = 0
  /\ switched = FALSE
  /\ foreignPrime = FALSE

(* A membership removal or other directory successor; rotation advances.   *)
ServerAdvance ==
  /\ serverHead < MaxHead
  /\ serverHead' = serverHead + 1
  /\ UNCHANGED <<pin, stage, op, active, startHead, memo, pending, epoch,
                 floor, lastUse, refused, usedExpired, behindPin>>

(* Hints are lossy: one may follow any advance, or never arrive.           *)
Hint ==
  /\ epoch < MaxHints
  /\ epoch' = epoch + 1
  /\ floor' = serverHead
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo,
                 pending, lastUse, refused, usedExpired, behindPin>>

(* Another local operation recovers and admits a head the server served. *)
AdmitPin(h) ==
  /\ pin < h /\ h <= serverHead
  /\ pin' = h
  /\ stage' = [stage EXCEPT ![h] = "complete"]
  /\ UNCHANGED <<serverHead, op, active, startHead, memo, pending, epoch,
                 floor, lastUse, refused, usedExpired, behindPin>>

(* Provisioning, before the first operation: the device signed the       *)
(* founding head, and its bootstrap pins it (checking the identity inside *)
(* that transaction) only after the server acknowledged that commit.       *)
ProvisionPin(h) ==
  /\ op = 0 /\ pin = 0 /\ primeHead = 0 /\ ~switched
  /\ ~PrimeRequiresAcknowledgement \/ h <= serverHead
  /\ pin' = h
  /\ primeHead' = h
  /\ UNCHANGED <<serverHead, stage, op, active, startHead, memo, pending,
                 epoch, floor, lastUse, refused, usedExpired, behindPin,
                 switched, foreignPrime>>

(* The host replaces the identity or database the bootstrap committed to.   *)
SwitchScope ==
  /\ ~switched
  /\ switched' = TRUE
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, pending,
                 epoch, floor, lastUse, refused, usedExpired, behindPin,
                 primeHead, foreignPrime>>

(* Priming is a later step, not part of the bootstrap transaction. Its     *)
(* progress write rechecks the provisioning scope inside its transaction;  *)
(* after a switch it aborts and writes nothing.                            *)
FinishPrime ==
  /\ primeHead # 0
  /\ IF PrimeChecksScope /\ switched
       THEN UNCHANGED <<stage, foreignPrime>>
       ELSE /\ stage' = [stage EXCEPT ![primeHead] = "complete"]
            /\ foreignPrime' = (foreignPrime \/ switched)
  /\ primeHead' = 0
  /\ UNCHANGED <<serverHead, pin, op, active, startHead, memo, pending,
                 epoch, floor, lastUse, refused, usedExpired, behindPin,
                 switched>>

(* An interrupted recovery leaves partial progress; an earlier dishonest  *)
(* final page leaves a completed stage whose stored current is rejected.  *)
Interrupt(h) ==
  /\ h <= serverHead /\ stage[h] = "none"
  /\ stage' = [stage EXCEPT ![h] = "partial"]
  /\ UNCHANGED <<serverHead, pin, op, active, startHead, memo, pending,
                 epoch, floor, lastUse, refused, usedExpired, behindPin>>

StoreRejectedCurrent(h) ==
  /\ h <= serverHead /\ stage[h] \in {"none", "partial"}
  /\ stage' = [stage EXCEPT ![h] = "rejected"]
  /\ UNCHANGED <<serverHead, pin, op, active, startHead, memo, pending,
                 epoch, floor, lastUse, refused, usedExpired, behindPin>>

BeginOperation ==
  /\ ~active /\ op < MaxOps
  /\ active' = TRUE
  /\ op' = op + 1
  /\ startHead' = serverHead
  /\ memo' = IF MemoPerOperation THEN NoMemo ELSE memo
  /\ UNCHANGED <<serverHead, pin, stage, pending, epoch, floor, lastUse,
                 refused, usedExpired, behindPin>>

(* An operation ends after its collections finish.                       *)
EndOperation ==
  /\ active /\ pending.kind = "none"
  /\ active' = FALSE
  /\ UNCHANGED <<serverHead, pin, stage, op, startHead, memo, pending, epoch,
                 floor, lastUse, refused, usedExpired, behindPin>>

MemoUsable ==
  /\ memo.head # 0 /\ memo.alive
  /\ ~MemoPerOperation \/ memo.op = op
  /\ ~EvictOnHint \/ memo.epoch = epoch
  /\ ~EvictOnCheckpoint \/ memo.head >= pin

(* A collection is held to the hint floor when it began its reads.         *)
Accept(h, verified, startFloor) ==
  lastUse' = [head |-> h, start |-> startHead, floor |-> startFloor,
              pin |-> pin, verified |-> verified]

(* A later collection takes the recovered directory from the memo; it is  *)
(* used in a later step, so its producer may expire in between.            *)
BeginReuse ==
  /\ active /\ pending.kind = "none" /\ MemoUsable
  /\ pending' = [kind |-> "reuse", head |-> memo.head, epoch |-> memo.epoch,
                 floor |-> floor, alive |-> TRUE]
  /\ behindPin' = (behindPin \/ memo.head < pin)
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, epoch,
                 floor, lastUse, refused, usedExpired>>

(* The producer of the memo entry ends (its caller's generation, lease or  *)
(* identity); a value already handed out from it shares that lifetime.     *)
ExpireProducer ==
  /\ memo.alive
  /\ memo' = [memo EXCEPT !.alive = FALSE]
  /\ pending' = IF pending.kind \in {"derive", "reuse"}
                 THEN [pending EXCEPT !.alive = FALSE] ELSE pending
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, epoch, floor,
                 lastUse, refused, usedExpired, behindPin>>

(* The point of use. A value whose producer expired is cancelled.          *)
FinishReuse ==
  /\ pending.kind = "reuse" /\ pin <= pending.head
  /\ IF CarryProducerLifetime /\ ~pending.alive
       THEN UNCHANGED <<lastUse, usedExpired>>
       ELSE /\ Accept(pending.head, stage[pending.head] = "complete",
                      pending.floor)
            /\ usedExpired' = ~pending.alive
  /\ pending' = NoPending
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, epoch,
                 floor, refused, behindPin>>

(* Without a per-operation discovery the device trusts its newest local   *)
(* completed head; production always performs the bare discovery read.   *)
LocalHead(h) ==
  /\ stage[h] = "complete"
  /\ \A g \in Heads: stage[g] = "complete" => g <= h

(* A miss falls through to today's path: discover the head now, observing  *)
(* the epoch before the reads; recovery finishes in a later step.          *)
BeginCollect ==
  /\ active /\ pending.kind = "none" /\ ~MemoUsable
  /\ \E h \in Heads:
       /\ \/ DiscoverEachOperation /\ h = serverHead
          \/ ~DiscoverEachOperation /\ LocalHead(h) /\ h >= pin
          \/ /\ ~DiscoverEachOperation /\ h = serverHead
             /\ ~\E g \in Heads: stage[g] = "complete"
       /\ pending' = [kind |-> "discover", head |-> h, epoch |-> epoch,
                      floor |-> floor, alive |-> TRUE]
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, epoch,
                 floor, lastUse, refused, usedExpired, behindPin>>

(* The conditional form of the discovery read: the device sends the head  *)
(* of its held verified prefix (its newest completed stage) and the server *)
(* may answer `unchanged`. The device does not trust that flag: the reply  *)
(* names the server's current head, which may be any head relative to the *)
(* held one, and the held head is reused only when the two are equal.      *)
(* Otherwise the device reads the first page unconditionally, exactly as   *)
(* BeginCollect does. Without a held prefix it always reads the page.      *)
ConditionalDiscovery ==
  /\ DiscoverEachOperation
  /\ active /\ pending.kind = "none" /\ ~MemoUsable
  /\ \E held \in Heads:
       /\ LocalHead(held)
       /\ LET h == IF ~UnchangedNamesHeld \/ serverHead = held
                      THEN held ELSE serverHead
          IN pending' = [kind |-> "discover", head |-> h, epoch |-> epoch,
                         floor |-> floor, alive |-> TRUE]
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, epoch,
                 floor, lastUse, refused, usedExpired, behindPin>>

(* A new citation is derived from the reused directory; it keeps the      *)
(* source entry's epoch.                                                   *)
BeginDerive ==
  /\ active /\ pending.kind = "none" /\ MemoUsable
  /\ pending' = [kind |-> "derive", head |-> memo.head, epoch |-> memo.epoch,
                 floor |-> floor, alive |-> TRUE]
  /\ behindPin' = (behindPin \/ memo.head < pin)
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, epoch,
                 floor, lastUse, refused, usedExpired>>

(* Recover the pinned head and store the entry. A completed stage needs no *)
(* confirmation read; partial progress resumes online; a rejected stored   *)
(* current is discarded and replayed. A derived citation inherits its      *)
(* source's producer lifetime.                                             *)
FinishCollect ==
  /\ pending.kind \in {"discover", "derive"} /\ pin <= pending.head
  /\ CarryProducerLifetime => pending.alive
  /\ LET h == pending.head IN
     /\ stage' = [stage EXCEPT ![h] =
          CASE stage[h] = "complete" -> "complete"
            [] stage[h] = "partial" /\ ~ShortcutRequiresComplete -> "partial"
            [] stage[h] = "rejected" /\ ~ReplayRejectedStoredCurrent -> "rejected"
            [] OTHER -> "complete"]
     /\ refused' = (stage'[h] = "rejected")
     /\ IF stage'[h] = "rejected"
          THEN UNCHANGED <<lastUse, memo, usedExpired>>
          ELSE /\ Accept(h, stage'[h] = "complete", pending.floor)
               /\ memo' = [head |-> h, op |-> op,
                           epoch |-> IF StampObservedEpoch
                                       THEN pending.epoch ELSE epoch,
                           alive |-> pending.alive]
               /\ usedExpired' = ~pending.alive
  /\ pending' = NoPending
  /\ UNCHANGED <<serverHead, pin, op, active, startHead, epoch, floor,
                 behindPin>>

(* A derived citation whose source producer expired is cancelled.          *)
CancelDerive ==
  /\ CarryProducerLifetime /\ pending.kind = "derive" /\ ~pending.alive
  /\ pending' = NoPending
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, epoch,
                 floor, lastUse, refused, usedExpired, behindPin>>

(* A pin that advanced during the reads raises the recovery race error;   *)
(* the caller retries with a new collection.                               *)
AbortCollect ==
  /\ pending.kind # "none" /\ pending.head < pin
  /\ pending' = NoPending
  /\ UNCHANGED <<serverHead, pin, stage, op, active, startHead, memo, epoch,
                 floor, lastUse, refused, usedExpired, behindPin>>

(* The bounded exploration ends after its last operation.                  *)
Terminated == ~active /\ op = MaxOps /\ UNCHANGED vars

RecoveryNext ==
  \/ ServerAdvance \/ Hint \/ BeginOperation \/ EndOperation \/ Terminated
  \/ BeginReuse \/ FinishReuse \/ ExpireProducer \/ CancelDerive
  \/ BeginCollect \/ ConditionalDiscovery \/ BeginDerive \/ FinishCollect
  \/ AbortCollect
  \/ \E h \in Heads: AdmitPin(h) \/ Interrupt(h) \/ StoreRejectedCurrent(h)

Next ==
  \/ RecoveryNext /\ UNCHANGED primeVars
  \/ SwitchScope \/ FinishPrime
  \/ \E h \in Heads: ProvisionPin(h)

Spec == Init /\ [][Next]_vars

(* Revocation by rotation is noticed per operation: an accepted directory  *)
(* is at least the server head when the operation began.                   *)
FreshPerOperation == lastUse.head = 0 \/ lastUse.head >= lastUse.start

(* A collection that begins after a hint never accepts a directory older  *)
(* than the head the server had when it sent the hint.                     *)
NoStaleAfterHint == lastUse.head = 0 \/ lastUse.head >= lastUse.floor

(* No accepted head is below the durable pin; admission rechecks pins at  *)
(* the point of use (AbortCollect).                                        *)
NoRollback == lastUse.head = 0 \/ lastUse.head >= lastUse.pin

(* The memo never hands out a head the durable pin has moved past, so an   *)
(* operation does not keep reusing evidence admission must refuse.         *)
ReuseCoversPin == ~behindPin

(* Every accepted head has a completed, verified signed history.           *)
AcceptedHeadVerified == lastUse.verified

(* No value is used after the producer it came from expired.               *)
NoUseAfterProducerExpiry == ~usedExpired

(* The durable pin never names a head the honest server has not           *)
(* committed; otherwise every later collection refuses the server's head  *)
(* as a rollback (AbortCollect forever), the bricked-device shape.        *)
PinCommitted == pin <= serverHead

(* Priming never writes durable state for an identity or database other   *)
(* than the one that provisioned.                                          *)
NoPrimeAfterScopeSwitch == ~foreignPrime

(* A rejected stored current never refuses an honest server's head.        *)
HonestServerNeverRefused == ~refused
=============================================================================
