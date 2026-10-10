------------------------- MODULE SessionRetryIdentity -------------------------
EXTENDS Naturals
CONSTANTS RequireKnownReplacement, BindRenewalCompletion, RecheckDispatch, JoinPendingRenewal
ASSUME {RequireKnownReplacement, BindRenewalCompletion, RecheckDispatch, JoinPendingRenewal} \subseteq BOOLEAN
VARIABLES token, revision, known, switched, phase, allowed, retriedAs, concurrentPending
vars == <<token, revision, known, switched, phase, allowed, retriedAs, concurrentPending>>
Init ==
  /\ token = "A0" /\ revision = 0 /\ known = "none" /\ switched = FALSE
  /\ phase = "waiting" /\ allowed = FALSE /\ retriedAs = "none"
  /\ concurrentPending = FALSE
SwitchIdentity ==
  /\ ~switched /\ phase # "done"
  /\ token' = "B" /\ revision' = revision + 1
  /\ switched' = TRUE /\ known' = "none"
  /\ UNCHANGED <<phase, allowed, retriedAs, concurrentPending>>
ConcurrentInstall ==
  /\ phase = "waiting" /\ token = "A0"
  /\ token' = "A1" /\ revision' = 1 /\ concurrentPending' = TRUE
  /\ UNCHANGED <<known, switched, phase, allowed, retriedAs>>
FinishConcurrentRenewal ==
  /\ concurrentPending /\ concurrentPending' = FALSE
  /\ known' = IF BindRenewalCompletion /\ revision # 1 THEN "none" ELSE token
  /\ UNCHANGED <<token, revision, switched, phase, allowed, retriedAs>>
JoinRenewal ==
  /\ phase = "joining" /\ ~concurrentPending
  /\ allowed' = (known = token /\ known # "none") /\ phase' = "ready"
  /\ UNCHANGED <<token, revision, known, switched, retriedAs, concurrentPending>>
Receive401 ==
  /\ phase = "waiting"
  /\ phase' = IF token = "A0" THEN "renewing"
               ELSE IF JoinPendingRenewal /\ concurrentPending THEN "joining" ELSE "ready"
  /\ allowed' = (token # "A0" /\ (~RequireKnownReplacement \/ known = token))
  /\ UNCHANGED <<token, revision, known, switched, retriedAs, concurrentPending>>
InstallRenewal ==
  /\ phase = "renewing"
  /\ token' = IF switched THEN token ELSE "A1"
  /\ revision' = IF switched THEN revision ELSE revision + 1
  /\ phase' = IF switched THEN "ready" ELSE "finishing"
  /\ UNCHANGED <<known, switched, allowed, retriedAs, concurrentPending>>
FinishRenewal ==
  /\ phase = "finishing"
  /\ known' = IF BindRenewalCompletion /\ revision # 1 THEN "none" ELSE token
  /\ allowed' = (~BindRenewalCompletion \/ revision = 1)
  /\ phase' = "ready"
  /\ UNCHANGED <<token, revision, switched, retriedAs, concurrentPending>>
Dispatch ==
  /\ phase = "ready" /\ phase' = "done"
  /\ retriedAs' = IF allowed /\ (~RecheckDispatch \/ known = token)
                   THEN token ELSE "none"
  /\ UNCHANGED <<token, revision, known, switched, allowed, concurrentPending>>
Next == SwitchIdentity \/ ConcurrentInstall \/ FinishConcurrentRenewal \/ JoinRenewal
        \/ Receive401 \/ InstallRenewal
        \/ FinishRenewal \/ Dispatch \/ (phase = "done" /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(Receive401) /\ WF_vars(InstallRenewal)
        /\ WF_vars(FinishRenewal) /\ WF_vars(Dispatch)
        /\ WF_vars(FinishConcurrentRenewal) /\ WF_vars(JoinRenewal)
TypeOK ==
  /\ token \in {"A0", "A1", "B"} /\ revision \in 0..2
  /\ known \in {"none", "A1", "B"} /\ switched \in BOOLEAN
  /\ phase \in {"waiting", "renewing", "finishing", "joining", "ready", "done"}
  /\ concurrentPending \in BOOLEAN
  /\ allowed \in BOOLEAN /\ retriedAs \in {"none", "A1", "B"}
RetryKeepsActor == retriedAs # "B"
HonestRenewalReplays == (phase = "done" /\ ~switched) => retriedAs = "A1"
RequestTerminates == <>(phase = "done")
=============================================================================
