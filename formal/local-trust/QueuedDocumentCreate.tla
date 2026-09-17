------------------------- MODULE QueuedDocumentCreate -------------------------
EXTENDS Naturals

CONSTANTS CheckDurableRow, CheckCurrentGeneration
ASSUME {CheckDurableRow, CheckCurrentGeneration} \subseteq BOOLEAN

VARIABLES durable, storePresent, generation, observedGeneration, observedExists,
          phase, startedFromMissingRow, clearedReplacement
vars == <<durable, storePresent, generation, observedGeneration, observedExists,
          phase, startedFromMissingRow, clearedReplacement>>

Init ==
  /\ durable = TRUE /\ storePresent = TRUE
  /\ generation = 0 /\ observedGeneration = 0 /\ observedExists = TRUE
  /\ phase = "queued"
  /\ startedFromMissingRow = FALSE /\ clearedReplacement = FALSE

(* Purging local storage does not synchronously retire every queued store. *)
Purge ==
  /\ durable /\ durable' = FALSE
  /\ UNCHANGED <<storePresent, generation, observedGeneration, observedExists,
                  phase, startedFromMissingRow, clearedReplacement>>

ReadDurableRow ==
  /\ phase = "queued" /\ phase' = "checking"
  /\ observedExists' = durable /\ observedGeneration' = generation
  /\ UNCHANGED <<durable, storePresent, generation,
                  startedFromMissingRow, clearedReplacement>>

(* Another store generation may win while the durable read is pending. *)
ReplaceGeneration ==
  /\ phase = "checking" /\ generation = 0
  /\ generation' = 1 /\ storePresent' = TRUE
  /\ UNCHANGED <<durable, observedGeneration, observedExists, phase,
                  startedFromMissingRow, clearedReplacement>>

Current == ~CheckCurrentGeneration \/ generation = observedGeneration
Discard == Current /\ CheckDurableRow /\ ~observedExists
Start == Current /\ (~CheckDurableRow \/ observedExists)
FinishRead ==
  /\ phase = "checking"
  /\ phase' = IF ~Current THEN "cancelled"
              ELSE IF Discard THEN "discarded" ELSE "started"
  /\ storePresent' = IF Discard THEN FALSE ELSE storePresent
  /\ startedFromMissingRow' = (Start /\ ~observedExists)
  /\ clearedReplacement' = (Discard /\ generation # observedGeneration)
  /\ UNCHANGED <<durable, generation, observedGeneration, observedExists>>

TypeOK ==
  /\ {durable, storePresent, observedExists,
       startedFromMissingRow, clearedReplacement} \subseteq BOOLEAN
  /\ generation \in 0..1 /\ observedGeneration \in 0..1
  /\ phase \in {"queued", "checking", "cancelled", "discarded", "started"}
PurgedQueueDoesNotStart == ~startedFromMissingRow
ReplacementStoreSurvives == ~clearedReplacement

Next == Purge \/ ReadDurableRow \/ ReplaceGeneration \/ FinishRead
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
=============================================================================
