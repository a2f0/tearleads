------------------------- MODULE SessionRetryIdentity -------------------------
EXTENDS Naturals
CONSTANTS RequireKnownReplacement, BindRenewalCompletion, RecheckDispatch
ASSUME {RequireKnownReplacement, BindRenewalCompletion, RecheckDispatch} \subseteq BOOLEAN
VARIABLES token, revision, known, switched, phase, allowed, retriedAs
vars == <<token, revision, known, switched, phase, allowed, retriedAs>>
Init ==
  /\ token = "A0" /\ revision = 0 /\ known = "none" /\ switched = FALSE
  /\ phase = "waiting" /\ allowed = FALSE /\ retriedAs = "none"
SwitchIdentity ==
  /\ ~switched /\ phase # "done"
  /\ token' = "B" /\ revision' = revision + 1
  /\ switched' = TRUE /\ known' = "none"
  /\ UNCHANGED <<phase, allowed, retriedAs>>
ConcurrentRenewal ==
  /\ phase = "waiting" /\ token = "A0"
  /\ token' = "A1" /\ revision' = 1 /\ known' = "A1"
  /\ UNCHANGED <<switched, phase, allowed, retriedAs>>
Receive401 ==
  /\ phase = "waiting"
  /\ phase' = IF token = "A0" THEN "renewing" ELSE "ready"
  /\ allowed' = (token # "A0" /\ (~RequireKnownReplacement \/ known = token))
  /\ UNCHANGED <<token, revision, known, switched, retriedAs>>
InstallRenewal ==
  /\ phase = "renewing"
  /\ token' = IF switched THEN token ELSE "A1"
  /\ revision' = IF switched THEN revision ELSE revision + 1
  /\ phase' = IF switched THEN "ready" ELSE "finishing"
  /\ UNCHANGED <<known, switched, allowed, retriedAs>>
FinishRenewal ==
  /\ phase = "finishing"
  /\ known' = IF BindRenewalCompletion /\ revision # 1 THEN "none" ELSE token
  /\ allowed' = (~BindRenewalCompletion \/ revision = 1)
  /\ phase' = "ready"
  /\ UNCHANGED <<token, revision, switched, retriedAs>>
Dispatch ==
  /\ phase = "ready" /\ phase' = "done"
  /\ retriedAs' = IF allowed /\ (~RecheckDispatch \/ known = token)
                   THEN token ELSE "none"
  /\ UNCHANGED <<token, revision, known, switched, allowed>>
Next == SwitchIdentity \/ ConcurrentRenewal \/ Receive401 \/ InstallRenewal
        \/ FinishRenewal \/ Dispatch \/ (phase = "done" /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(Receive401) /\ WF_vars(InstallRenewal)
        /\ WF_vars(FinishRenewal) /\ WF_vars(Dispatch)
TypeOK ==
  /\ token \in {"A0", "A1", "B"} /\ revision \in 0..2
  /\ known \in {"none", "A1", "B"} /\ switched \in BOOLEAN
  /\ phase \in {"waiting", "renewing", "finishing", "ready", "done"}
  /\ allowed \in BOOLEAN /\ retriedAs \in {"none", "A1", "B"}
RetryKeepsActor == retriedAs # "B"
HonestRenewalReplays == (phase = "done" /\ ~switched) => retriedAs = "A1"
RequestTerminates == <>(phase = "done")
=============================================================================
