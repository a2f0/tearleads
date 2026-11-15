---------------------- MODULE ContactAddressRecovery ----------------------
EXTENDS Naturals, FiniteSets
CONSTANTS RequireAdmission, KeepOriginalAuthority, RequireCleanReconciliation,
          PreserveUncertainty, TrustAllocatedId, CheckCompletionScope
ASSUME {RequireAdmission, KeepOriginalAuthority, RequireCleanReconciliation,
        PreserveUncertainty, TrustAllocatedId, CheckCompletionScope}
       \subseteq BOOLEAN

Rows == {"a", "b"}
VARIABLES operation, phase, attempts, live, durable, visible, dirty, row,
          liveApplied, durableApplied, uncertain, owedRecovery,
          callerCurrent, originalCurrent, badAdmission, ackDurable, ackCurrent
storeVars == <<live, durable, visible, dirty, liveApplied, durableApplied>>
resultVars == <<badAdmission, ackDurable, ackCurrent>>
vars == <<operation, phase, attempts, storeVars, row, uncertain, owedRecovery,
          callerCurrent, originalCurrent, resultVars>>

Authorized == callerCurrent /\ (operation # "add" \/ originalCurrent)
Admitted == (~RequireAdmission \/ callerCurrent) /\
            (~KeepOriginalAuthority \/ operation # "add" \/ originalCurrent)
IntentDurable == durableApplied /\
  (IF operation = "remove" THEN row \notin durable ELSE row \in durable)

Init ==
  /\ operation \in {"add", "update", "remove"}
  /\ phase = "editing"
  /\ attempts = 0
  /\ live = IF operation = "add" THEN {} ELSE {"a"}
  /\ durable = live
  /\ visible = live
  /\ dirty = FALSE
  /\ row = "a"
  /\ liveApplied = FALSE
  /\ durableApplied = FALSE
  /\ uncertain = FALSE
  /\ owedRecovery = FALSE
  /\ callerCurrent = TRUE
  /\ originalCurrent = TRUE
  /\ badAdmission = FALSE
  /\ ackDurable = FALSE
  /\ ackCurrent = FALSE

Submit ==
  /\ phase \in {"editing", "failed"}
  /\ attempts < 2
  /\ phase' = "queued"
  /\ attempts' = attempts + 1
  /\ UNCHANGED <<operation, storeVars, row, uncertain, owedRecovery,
                  callerCurrent, originalCurrent, resultVars>>

Admit ==
  /\ phase = "queued"
  /\ Admitted
  /\ phase' = IF uncertain THEN "reconciling" ELSE "mutating"
  /\ UNCHANGED <<operation, attempts, storeVars, row, uncertain, owedRecovery,
                  callerCurrent, originalCurrent, resultVars>>

(* Only an explicit no-effect refusal may restore pre-attempt certainty. *)
(* It never forgives the older, uncertain attempt on the same draft.      *)
RefuseAttempt ==
  /\ phase = "queued"
  /\ operation # "add"
  /\ phase' = "failed"
  /\ uncertain' = IF PreserveUncertainty THEN uncertain ELSE FALSE
  /\ UNCHANGED <<operation, attempts, storeVars, row, owedRecovery,
                  callerCurrent, originalCurrent, resultVars>>

(* addRow can return an allocated id without applying any mutation. *)
NoEffectReturn ==
  /\ phase \in {"queued", "mutating"}
  /\ phase' = "returned"
  /\ UNCHANGED <<operation, attempts, storeVars, row, uncertain, owedRecovery,
                  callerCurrent, originalCurrent, resultVars>>

(* Flush is an admitted effect, separate from deciding whether an id exists. *)
FlushPending ==
  /\ phase = "reconciling"
  /\ dirty
  /\ Admitted
  /\ durable' = live
  /\ visible' = live
  /\ durableApplied' = liveApplied
  /\ dirty' = FALSE
  /\ badAdmission' = (badAdmission \/ ~Authorized)
  /\ UNCHANGED <<operation, phase, attempts, live, liveApplied, row,
                  uncertain, owedRecovery, callerCurrent, originalCurrent,
                  ackDurable, ackCurrent>>

(* A failed add can be absent from the published rows while live Loro holds *)
(* it. Only a clean snapshot permits deciding whether another add is safe. *)
(* The fault bypasses the entire flush-and-clean barrier, not just one      *)
(* production cleanliness predicate; it permits skipping FlushPending.     *)
Reconcile ==
  /\ phase = "reconciling"
  /\ Admitted
  /\ RequireCleanReconciliation => ~dirty
  /\ row' = IF operation = "add" /\ row \notin visible THEN "b" ELSE row
  /\ phase' = "mutating"
  /\ UNCHANGED <<operation, attempts, storeVars, uncertain, owedRecovery,
                  callerCurrent, originalCurrent, resultVars>>

ApplyMutation ==
  /\ phase = "mutating"
  /\ Admitted
  /\ live' = CASE operation = "add" -> live \cup {row}
                [] operation = "remove" -> live \ {row}
                [] OTHER -> live
  /\ visible' \in {visible, live'}
  /\ dirty' = TRUE
  /\ liveApplied' = TRUE
  /\ badAdmission' = (badAdmission \/ ~Authorized)
  /\ phase' = "persisting"
  /\ UNCHANGED <<operation, attempts, durable, durableApplied, row,
                  uncertain, owedRecovery, callerCurrent, originalCurrent,
                  ackDurable, ackCurrent>>

(* Expiry after admission does not roll back live state or stop this save. *)
FinishPersistence(success) ==
  /\ phase = "persisting"
  /\ success \in BOOLEAN
  /\ durable' = IF success THEN live ELSE durable
  /\ durableApplied' = IF success THEN liveApplied ELSE durableApplied
  /\ visible' = IF success THEN live ELSE visible
  /\ dirty' = ~success
  /\ phase' = "returned"
  /\ UNCHANGED <<operation, attempts, live, liveApplied, row,
                  uncertain, owedRecovery, callerCurrent, originalCurrent,
                  resultVars>>

FinishAttempt ==
  /\ phase = "returned"
  /\ LET accepted == (Authorized \/ ~CheckCompletionScope) /\
         ((~dirty /\ IntentDurable) \/ (TrustAllocatedId /\ operation = "add"))
     IN /\ phase' = IF accepted THEN "done" ELSE "failed"
        /\ uncertain' = ~accepted
        /\ owedRecovery' = ~accepted
        /\ ackDurable' = IF accepted THEN ~dirty /\ IntentDurable ELSE ackDurable
        /\ ackCurrent' = IF accepted THEN Authorized ELSE ackCurrent
  /\ UNCHANGED <<operation, attempts, storeVars, row,
                  callerCurrent, originalCurrent, badAdmission>>

Cancel ==
  /\ phase \in {"editing", "failed"}
  /\ ~uncertain
  /\ phase' = "cancelled"
  /\ UNCHANGED <<operation, attempts, storeVars, row, uncertain, owedRecovery,
                  callerCurrent, originalCurrent, resultVars>>
ExpireCaller ==
  /\ callerCurrent
  /\ callerCurrent' = FALSE
  /\ UNCHANGED <<operation, phase, attempts, storeVars, row, uncertain,
                  owedRecovery, originalCurrent, resultVars>>
ExpireOriginal ==
  /\ originalCurrent
  /\ operation = "add"
  /\ ((attempts = 1 /\ phase = "failed") \/ attempts = 2)
  /\ originalCurrent' = FALSE
  /\ UNCHANGED <<operation, phase, attempts, storeVars, row, uncertain,
                  owedRecovery, callerCurrent, resultVars>>

Next == Submit \/ Admit \/ RefuseAttempt \/ NoEffectReturn
        \/ FlushPending \/ Reconcile
        \/ ApplyMutation \/ (\E success \in BOOLEAN : FinishPersistence(success))
        \/ FinishAttempt \/ Cancel \/ ExpireCaller \/ ExpireOriginal
        \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ operation \in {"add", "update", "remove"}
  /\ phase \in {"editing", "queued", "reconciling", "mutating", "persisting",
                 "returned", "failed", "done", "cancelled"}
  /\ attempts \in 0..2
  /\ live \subseteq Rows
  /\ durable \subseteq Rows
  /\ visible \subseteq Rows
  /\ row \in Rows
  /\ {dirty, liveApplied, durableApplied, uncertain, owedRecovery, callerCurrent,
       originalCurrent, badAdmission, ackDurable, ackCurrent} \subseteq BOOLEAN
OnlyAdmittedEffects == ~badAdmission
OneRowPerDraft == operation = "add" => Cardinality(live) <= 1
AcknowledgementIsDurable == phase = "done" => ackDurable
NoStaleAcknowledgement == phase = "done" => ackCurrent
UncertainCannotCancel == phase = "cancelled" => ~owedRecovery
=============================================================================
