----------------------- MODULE PrincipalRecoveryReuse -----------------------
EXTENDS Naturals

(***************************************************************************)
(* Reuse of completed principal-history stages (#2522). An honest server   *)
(* advances the organization directory head; a revocation is a rotation,   *)
(* so it is an advance. Each scoped recovery batch reads the server-current *)
(* head once (the bare discovery read), then recovers that exact head. A   *)
(* completed local stage of the exact pinned head is accepted without a    *)
(* confirmation read; a stored current artifact that fails its check is    *)
(* replayed online instead of refused. Each parameter is a production      *)
(* guard; negative controls disable one at a time.                         *)
(***************************************************************************)

CONSTANTS MaxHead, MaxBatches,
          DiscoverEachBatch,           \* the bare discovery read stays per batch
          ShortcutRequiresComplete,    \* only a completed stage of the pinned head skips its read
          ReplayRejectedStoredCurrent  \* a rejected stored current replays online

ASSUME /\ MaxHead \in Nat \ {0}
       /\ MaxBatches \in Nat \ {0}
       /\ {DiscoverEachBatch, ShortcutRequiresComplete,
           ReplayRejectedStoredCurrent} \subseteq BOOLEAN

Heads == 1..MaxHead
StageStates == {"none", "partial", "complete", "rejected"}
NoUse == [head |-> 0, start |-> 0, pin |-> 0, verified |-> TRUE]

VARIABLES serverHead,  \* honest current directory head
          pin,         \* durable local checkpoint (0: none)
          stage,       \* local recovery stage per exact head
          batch,       \* current recovery batch id (0: none yet)
          active,      \* a batch is running
          startHead,   \* server head when the current batch began
          lastUse,     \* ghost: the last directory a batch accepted
          refused      \* ghost: an honest server's directory was refused

vars == <<serverHead, pin, stage, batch, active, startHead, lastUse, refused>>

TypeOK ==
  /\ serverHead \in Heads
  /\ pin \in 0..MaxHead
  /\ stage \in [Heads -> StageStates]
  /\ batch \in 0..MaxBatches
  /\ active \in BOOLEAN
  /\ startHead \in 0..MaxHead
  /\ lastUse \in [head: 0..MaxHead, start: 0..MaxHead, pin: 0..MaxHead,
                  verified: BOOLEAN]
  /\ refused \in BOOLEAN

Init ==
  /\ serverHead = 1
  /\ pin = 0
  /\ stage = [h \in Heads |-> "none"]
  /\ batch = 0
  /\ active = FALSE
  /\ startHead = 0
  /\ lastUse = NoUse
  /\ refused = FALSE

(* A membership removal or other directory successor; rotation advances.   *)
ServerAdvance ==
  /\ serverHead < MaxHead
  /\ serverHead' = serverHead + 1
  /\ UNCHANGED <<pin, stage, batch, active, startHead, lastUse, refused>>

(* Another local operation recovers and admits a head the server served.  *)
AdmitPin(h) ==
  /\ pin < h /\ h <= serverHead
  /\ pin' = h
  /\ stage' = [stage EXCEPT ![h] = "complete"]
  /\ UNCHANGED <<serverHead, batch, active, startHead, lastUse, refused>>

(* An interrupted recovery leaves partial progress; an earlier dishonest  *)
(* final page leaves a completed stage whose stored current is rejected.  *)
Interrupt(h) ==
  /\ h <= serverHead /\ stage[h] = "none"
  /\ stage' = [stage EXCEPT ![h] = "partial"]
  /\ UNCHANGED <<serverHead, pin, batch, active, startHead, lastUse, refused>>

StoreRejectedCurrent(h) ==
  /\ h <= serverHead /\ stage[h] \in {"none", "partial"}
  /\ stage' = [stage EXCEPT ![h] = "rejected"]
  /\ UNCHANGED <<serverHead, pin, batch, active, startHead, lastUse, refused>>

BeginBatch ==
  /\ ~active /\ batch < MaxBatches
  /\ active' = TRUE
  /\ batch' = batch + 1
  /\ startHead' = serverHead
  /\ UNCHANGED <<serverHead, pin, stage, lastUse, refused>>

(* Without a discovery read the device trusts its newest local completed  *)
(* head; production always performs the bare discovery read.              *)
LocalHead(h) ==
  /\ stage[h] = "complete"
  /\ \A g \in Heads: stage[g] = "complete" => g <= h

(* Recover the exact pinned head. A completed stage needs no confirmation *)
(* read; partial progress resumes online; a rejected stored current is    *)
(* discarded and replayed.                                                *)
Recover(h) ==
  /\ stage' = [stage EXCEPT ![h] =
       CASE stage[h] = "complete" -> "complete"
         [] stage[h] = "partial" /\ ~ShortcutRequiresComplete -> "partial"
         [] stage[h] = "rejected" /\ ~ReplayRejectedStoredCurrent -> "rejected"
         [] OTHER -> "complete"]
  /\ refused' = (stage'[h] = "rejected")
  /\ IF stage'[h] = "rejected"
       THEN UNCHANGED lastUse
       ELSE lastUse' = [head |-> h, start |-> startHead, pin |-> pin,
                        verified |-> stage'[h] = "complete"]

(* A batch accepts one directory view and ends.                           *)
Collect ==
  /\ active
  /\ \/ /\ DiscoverEachBatch
        /\ Recover(serverHead)
     \/ /\ ~DiscoverEachBatch
        /\ \E h \in Heads: LocalHead(h) /\ Recover(h)
     \/ /\ ~DiscoverEachBatch
        /\ ~\E h \in Heads: stage[h] = "complete"
        /\ Recover(serverHead)
  /\ active' = FALSE
  /\ UNCHANGED <<serverHead, pin, batch, startHead>>

(* The bounded exploration ends after its last batch.                     *)
Terminated == ~active /\ batch = MaxBatches /\ UNCHANGED vars

Next ==
  \/ ServerAdvance \/ BeginBatch \/ Collect \/ Terminated
  \/ \E h \in Heads: AdmitPin(h) \/ Interrupt(h) \/ StoreRejectedCurrent(h)

Spec == Init /\ [][Next]_vars

(* Revocation by rotation is noticed per batch: an accepted directory is   *)
(* at least the server head when the batch began.                          *)
FreshPerBatch == lastUse.head = 0 \/ lastUse.head >= lastUse.start

(* No accepted head is below the durable pin.                              *)
NoRollback == lastUse.head = 0 \/ lastUse.head >= lastUse.pin

(* Every accepted head has a completed, verified signed history.           *)
AcceptedHeadVerified == lastUse.verified

(* A rejected stored current never refuses an honest server's head.        *)
HonestServerNeverRefused == ~refused
=============================================================================
