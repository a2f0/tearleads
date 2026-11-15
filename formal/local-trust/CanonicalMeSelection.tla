---------------------- MODULE CanonicalMeSelection ----------------------
EXTENDS Naturals, FiniteSets
CONSTANTS RequireCanonicalStream, RespectPersistedIdentity,
          RequireWritableTarget, CheckCurrentScope, PreserveExistingContent
ASSUME {RequireCanonicalStream, RespectPersistedIdentity, RequireWritableTarget,
        CheckCurrentScope, PreserveExistingContent} \subseteq BOOLEAN

Locals == {"canonical", "alias", "impostor"}
Scenarios == {"missing", "foreign", "canonical", "alias", "recovery",
              "currentWins", "occupied", "occupiedWithAlias", "shell",
              "readonly", "unsettled"}
Row(remote, recovery, content) ==
  [remote |-> remote, recovery |-> recovery, content |-> content]
Empty == Row("none", "none", "empty")
VARIABLES scenario, rows, retained, scope, phase, selected,
          acknowledgedIdentity, acknowledgedEligible, staleEffect
vars == <<scenario, rows, retained, scope, phase, selected,
          acknowledgedIdentity, acknowledgedEligible, staleEffect>>

Present(id) == rows[id].content # "empty"
Planned(id) == IF id = "canonical" THEN "me" ELSE "other"
ActualIdentity(id) ==
  IF rows[id].remote # "none" THEN rows[id].remote
  ELSE IF rows[id].recovery # "none" THEN rows[id].recovery
  ELSE Planned(id)
ResolvedIdentity(id) ==
  IF RespectPersistedIdentity THEN ActualIdentity(id) ELSE Planned(id)
Candidates == {id \in Locals : Present(id) /\
  (ResolvedIdentity(id) = "me" \/ (~RequireCanonicalStream /\ id = "impostor"))}
Eligible == scenario \notin {"shell", "readonly", "unsettled"}
Current == scope = 0
Admitted == Current \/ ~CheckCurrentScope

Init ==
  /\ scenario \in Scenarios
  /\ rows = [id \in Locals |->
       IF id = "canonical" /\ scenario \in {"canonical", "currentWins"}
         THEN Row("me", "other", "retained")
       ELSE IF id = "canonical" /\ scenario \in {"occupied", "occupiedWithAlias"}
         THEN Row("other", "none", "retained")
       ELSE IF id = "alias" /\ scenario = "recovery"
         THEN Row("none", "me", "retained")
       ELSE IF id = "alias" /\ scenario \in
               {"alias", "occupiedWithAlias", "shell", "readonly", "unsettled"}
         THEN Row("me", "none", "retained")
       ELSE IF id = "impostor" /\ scenario = "foreign"
         THEN Row("other", "none", "retained")
       ELSE Empty]
  /\ retained = [id \in Locals |-> rows[id].content]
  /\ scope = 0
  /\ phase = "reading"
  /\ selected = "none"
  /\ acknowledgedIdentity = "none"
  /\ acknowledgedEligible = FALSE
  /\ staleEffect = FALSE

(* Matching fields on the impostor are deliberately not stream identity. *)
FinishSelection ==
  /\ phase = "reading"
  /\ Admitted
  /\ selected' = IF Candidates # {} THEN CHOOSE id \in Candidates : TRUE
                  ELSE IF Present("canonical") THEN "none" ELSE "canonical"
  /\ phase' = IF selected' = "none" THEN "refused" ELSE "selected"
  /\ staleEffect' = (staleEffect \/ ~Current)
  /\ UNCHANGED <<scenario, rows, retained, scope, acknowledgedIdentity,
                  acknowledgedEligible>>

(* Selection, queued revalidation, initialization, and identity-only write *)
(* collapse here. Eligibility can refuse without overwriting any content. *)
EnsureSelected ==
  /\ phase = "selected"
  /\ Admitted
  /\ LET creates == ~Present(selected)
         remoteAlias == \E id \in Locals : Present(id) /\ rows[id].remote = "me"
         refused == (RequireWritableTarget /\ ~Eligible) \/ (creates /\ remoteAlias)
     IN /\ phase' = IF refused THEN "refused" ELSE "acknowledging"
        /\ rows' = IF refused THEN rows
                    ELSE IF creates
                      THEN [rows EXCEPT ![selected] = Row("me", "none", "seed")]
                    ELSE IF PreserveExistingContent THEN rows
                    ELSE [rows EXCEPT ![selected].content = "seed"]
        /\ retained' = IF ~refused /\ creates
                         THEN [retained EXCEPT ![selected] = "seed"] ELSE retained
        /\ staleEffect' = (staleEffect \/ (~refused /\ ~Current))
  /\ UNCHANGED <<scenario, scope, selected, acknowledgedIdentity,
                  acknowledgedEligible>>

Acknowledge ==
  /\ phase = "acknowledging"
  /\ Admitted
  /\ phase' = "done"
  /\ acknowledgedIdentity' = ActualIdentity(selected)
  /\ acknowledgedEligible' = Eligible
  /\ staleEffect' = (staleEffect \/ ~Current)
  /\ UNCHANGED <<scenario, rows, retained, scope, selected>>

ExpireScope ==
  /\ Current
  /\ scope' = 1
  /\ UNCHANGED <<scenario, rows, retained, phase, selected,
                  acknowledgedIdentity, acknowledgedEligible, staleEffect>>
AbortStale ==
  /\ ~Current
  /\ phase \in {"reading", "selected", "acknowledging"}
  /\ phase' = "refused"
  /\ UNCHANGED <<scenario, rows, retained, scope, selected,
                  acknowledgedIdentity, acknowledgedEligible, staleEffect>>
LocalWork == FinishSelection \/ EnsureSelected \/ Acknowledge \/ AbortStale
Next == LocalWork \/ ExpireScope \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars /\ WF_vars(LocalWork)

TypeOK ==
  /\ scenario \in Scenarios
  /\ rows \in [Locals -> [remote : {"none", "me", "other"},
                          recovery : {"none", "me", "other"},
                          content : {"empty", "retained", "seed"}]]
  /\ retained \in [Locals -> {"empty", "retained", "seed"}]
  /\ scope \in 0..1
  /\ phase \in {"reading", "selected", "acknowledging", "refused", "done"}
  /\ selected \in Locals \cup {"none"}
  /\ acknowledgedIdentity \in {"none", "me", "other"}
  /\ acknowledgedEligible \in BOOLEAN
  /\ staleEffect \in BOOLEAN
AcknowledgedOnlyCanonical == acknowledgedIdentity \in {"none", "me"}
AcknowledgedOnlyWritable == phase = "done" => acknowledgedEligible
CanonicalBirthUnique ==
  Cardinality({id \in Locals : Present(id) /\ ActualIdentity(id) = "me"}) <= 1
ExistingContentSurvives == \A id \in Locals : rows[id].content = retained[id]
NoStaleEffects == ~staleEffect
ValidCanonicalTargetCompletes ==
  (([]Current) /\ Eligible /\ scenario # "occupied") => <>(phase = "done")
=============================================================================
