--------------------- MODULE ProfileDocumentIdentity ---------------------
EXTENDS Naturals, FiniteSets

CONSTANTS PreferKnownPointer, RespectPersistedIdentity, ReuseDiscovered,
          CheckCurrentScope, PreserveExistingPayload, RefuseAliasBirth,
          AllowPointerBirth
ASSUME {PreferKnownPointer, RespectPersistedIdentity, ReuseDiscovered,
        CheckCurrentScope, PreserveExistingPayload, RefuseAliasBirth,
        AllowPointerBirth}
       \subseteq BOOLEAN

Locals == {"preferred", "alias"}
Streams == {"none", "planned", "target", "other"}
Scenarios == {"fresh", "discovered", "current", "recovery", "recoveryAlias",
              "pointer", "missingPointer", "racing"}
EmptyRow == [remote |-> "none", recovery |-> "none", payload |-> "empty"]
Row(remote, recovery, payload) ==
  [remote |-> remote, recovery |-> recovery, payload |-> payload]

VARIABLES scenario, rows, retained, scope, phase, desired, lookupResult,
          selected, discoveryDone, staleEffect, openedIdentity
vars == <<scenario, rows, retained, scope, phase, desired, lookupResult,
          selected, discoveryDone, staleEffect, openedIdentity>>

Expected == IF scenario \in {"fresh", "discovered", "recoveryAlias", "racing"}
            THEN "planned" ELSE "target"
KnownPointer == IF scenario \in {"pointer", "missingPointer"}
                THEN "target" ELSE "none"
Planned(id) == IF id = "preferred" THEN "planned" ELSE "other"
Present(id) == rows[id].payload # "empty"
ActualIdentity(id) ==
  IF rows[id].remote # "none" THEN rows[id].remote
  ELSE IF rows[id].recovery # "none" THEN rows[id].recovery
  ELSE Planned(id)
ResolvedIdentity(id) ==
  IF RespectPersistedIdentity THEN ActualIdentity(id) ELSE Planned(id)
Aliases(stream) == {id \in Locals : Present(id) /\ ActualIdentity(id) = stream}
RemoteAliases(stream) == {id \in Locals : Present(id) /\ rows[id].remote = stream}
Current == scope = 0
Admitted == ~CheckCurrentScope \/ Current

Init ==
  /\ scenario \in Scenarios
  /\ rows = [id \in Locals |->
       IF id = "preferred" /\ scenario = "current"
         THEN Row("target", "other", "original")
       ELSE IF id = "preferred" /\ scenario = "recovery"
         THEN Row("none", "target", "original")
       ELSE IF id = "preferred" /\ scenario = "pointer"
         THEN Row("other", "none", "unrelated")
       ELSE IF id = "alias" /\ scenario \in {"pointer", "discovered"}
         THEN Row(Expected, "none", "original")
       ELSE IF id = "alias" /\ scenario = "recoveryAlias"
         THEN Row("none", Expected, "original")
       ELSE EmptyRow]
  /\ retained = [id \in Locals |-> rows[id].payload]
  /\ scope = 0
  /\ phase = "preferredRead"
  /\ desired = "none"
  /\ lookupResult = "none"
  /\ selected = "none"
  /\ discoveryDone = (scenario # "racing")
  /\ staleEffect = FALSE
  /\ openedIdentity = "none"

(* All reads and opens use the one workflow runtime captured at entry.     *)
(* Scope expiry can interrupt each awaited completion, not rebind that DB. *)
FinishPreferredRead ==
  /\ phase = "preferredRead"
  /\ Admitted
  /\ desired' =
       IF PreferKnownPointer /\ KnownPointer # "none" THEN KnownPointer
       ELSE IF Present("preferred") THEN ResolvedIdentity("preferred")
       ELSE Planned("preferred")
  /\ phase' = "lookupStart"
  /\ UNCHANGED <<scenario, rows, retained, scope, lookupResult, selected,
                  discoveryDone, staleEffect, openedIdentity>>

BeginLookup ==
  /\ phase = "lookupStart"
  /\ Admitted
  /\ lookupResult' =
       IF ReuseDiscovered /\ Aliases(desired) # {}
         THEN CHOOSE id \in Aliases(desired) : TRUE
         ELSE "none"
  /\ phase' = "lookupPending"
  /\ UNCHANGED <<scenario, rows, retained, scope, desired, selected,
                  discoveryDone, staleEffect, openedIdentity>>

FinishLookup ==
  /\ phase = "lookupPending"
  /\ Admitted
  /\ selected' =
       IF lookupResult # "none" THEN lookupResult
       ELSE IF Present("preferred") /\ ResolvedIdentity("preferred") = desired
         THEN "preferred" ELSE "none"
  /\ phase' = IF selected' # "none" THEN "open"
               ELSE IF Present("preferred")
                       \/ (KnownPointer # "none" /\ ~AllowPointerBirth)
                 THEN "refused" ELSE "birth"
  /\ staleEffect' = (staleEffect \/ ~Current)
  /\ UNCHANGED <<scenario, rows, retained, scope, desired, lookupResult,
                  discoveryDone, openedIdentity>>

OpenExisting ==
  /\ phase = "open"
  /\ Admitted
  /\ rows' = IF PreserveExistingPayload THEN rows
             ELSE [rows EXCEPT ![selected].payload = "seed"]
  /\ openedIdentity' = ActualIdentity(selected)
  /\ phase' = "opening"
  /\ staleEffect' = (staleEffect \/ ~Current)
  /\ UNCHANGED <<scenario, retained, scope, desired, lookupResult, selected,
                  discoveryDone>>

(* The generic transaction refuses an alias, even after a stale miss.       *)
(* It does not adopt or merge the alias. A later caller may resolve again.  *)
AttemptBirth ==
  /\ phase = "birth"
  /\ Admitted
  /\ LET refused == Present("preferred")
                     \/ (RefuseAliasBirth /\ RemoteAliases(desired) # {}) IN
       /\ phase' = IF refused THEN "refused" ELSE "opening"
       /\ rows' = IF refused THEN rows
                  ELSE [rows EXCEPT !["preferred"] = Row(desired, "none", "seed")]
       /\ retained' = IF refused THEN retained
                      ELSE [retained EXCEPT !["preferred"] = "seed"]
       /\ selected' = IF refused THEN selected ELSE "preferred"
       /\ openedIdentity' = IF refused THEN openedIdentity ELSE desired
       /\ staleEffect' = (staleEffect \/ (~refused /\ ~Current))
  /\ UNCHANGED <<scenario, scope, desired, lookupResult, discoveryDone>>

FinishOpen ==
  /\ phase = "opening"
  /\ Admitted
  /\ phase' = "ready"
  /\ staleEffect' = (staleEffect \/ ~Current)
  /\ UNCHANGED <<scenario, rows, retained, scope, desired, lookupResult,
                  selected, discoveryDone, openedIdentity>>

(* Discovery before birth materializes an alias. After birth it reuses the *)
(* same stream's local row and does not overwrite the already held payload. *)
Discover ==
  /\ ~discoveryDone
  /\ discoveryDone' = TRUE
  /\ LET needsAlias == Aliases(Expected) = {} IN
       /\ rows' = IF needsAlias
                    THEN [rows EXCEPT !["alias"] = Row(Expected, "none", "original")]
                    ELSE rows
       /\ retained' = IF needsAlias
                        THEN [retained EXCEPT !["alias"] = "original"]
                        ELSE retained
  /\ UNCHANGED <<scenario, scope, phase, desired, lookupResult, selected,
                  staleEffect, openedIdentity>>

ExpireScope ==
  /\ Current
  /\ scope' = 1
  /\ UNCHANGED <<scenario, rows, retained, phase, desired, lookupResult,
                  selected, discoveryDone, staleEffect, openedIdentity>>

AbortStale ==
  /\ ~Current
  /\ phase \notin {"ready", "refused", "aborted"}
  /\ phase' = "aborted"
  /\ UNCHANGED <<scenario, rows, retained, scope, desired, lookupResult,
                  selected, discoveryDone, staleEffect, openedIdentity>>

LocalWork == FinishPreferredRead \/ BeginLookup \/ FinishLookup
             \/ OpenExisting \/ AttemptBirth \/ FinishOpen \/ AbortStale
Next == LocalWork \/ Discover \/ ExpireScope \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars /\ WF_vars(LocalWork)

TypeOK ==
  /\ scenario \in Scenarios
  /\ rows \in [Locals -> [remote : Streams, recovery : Streams,
                          payload : {"empty", "original", "unrelated", "seed"}]]
  /\ retained \in [Locals -> {"empty", "original", "unrelated", "seed"}]
  /\ scope \in 0..1
  /\ phase \in {"preferredRead", "lookupStart", "lookupPending", "open",
                 "birth", "opening", "ready", "refused", "aborted"}
  /\ desired \in Streams
  /\ lookupResult \in Locals \cup {"none"}
  /\ selected \in Locals \cup {"none"}
  /\ discoveryDone \in BOOLEAN
  /\ staleEffect \in BOOLEAN
  /\ openedIdentity \in Streams

NoDuplicateStreamBirths ==
  \A stream \in Streams \ {"none"} : Cardinality(Aliases(stream)) <= 1
ExistingPayloadSurvives == \A id \in Locals : rows[id].payload = retained[id]
ExplicitPointerNeverCreates ==
  KnownPointer # "none" => rows["preferred"].payload # "seed"
ResolvedTargetIsExpected == desired \in {"none", Expected}
OpenedExpectedStream == openedIdentity \in {"none", Expected}
NoStaleEffects == ~staleEffect

(* Stable scope and returning local work must actually open a materialized *)
(* profile. Refusing all aliases fails this property. The racing scenario  *)
(* may legitimately refuse when discovery arrives after a negative lookup. *)
RequestedProfileEventuallyOpens ==
  (([]Current) /\ scenario \notin {"racing", "missingPointer"})
    => <>(phase = "ready")
=============================================================================
