------------------------- MODULE SessionRetryIdentity -------------------------
EXTENDS Naturals
CONSTANTS RequireKnownReplacement, BindRenewalCompletion, RecheckDispatch, JoinPendingRenewal,
          CheckRenewedUser, RecheckCallerScope
ASSUME {RequireKnownReplacement, BindRenewalCompletion, RecheckDispatch, JoinPendingRenewal,
        CheckRenewedUser, RecheckCallerScope} \subseteq BOOLEAN
(* A dishonest server may answer A's renewal with "C", a session for another *)
(* user; renewal counts only when the renewed session names the same user.  *)
(* The request's callers can also retire without a sign-in change, as an     *)
(* organization switch does; a shared read retires when all its callers do.  *)
VARIABLES token, revision, known, switched, phase, allowed, retriedAs, concurrentPending,
          otherUserRenewal, retired, renewedRetired, replayedRetired
retryVars == <<token, revision, known, switched, allowed, retriedAs, concurrentPending,
               otherUserRenewal>>
scopeVars == <<retired, renewedRetired, replayedRetired>>
vars == <<retryVars, phase, scopeVars>>
Init ==
  /\ token = "A0" /\ revision = 0 /\ known = "none" /\ switched = FALSE
  /\ phase = "waiting" /\ allowed = FALSE /\ retriedAs = "none"
  /\ concurrentPending = FALSE /\ otherUserRenewal = FALSE
  /\ retired = FALSE /\ renewedRetired = FALSE /\ replayedRetired = FALSE
SwitchIdentity ==
  /\ ~switched /\ phase # "done"
  /\ token' = "B" /\ revision' = revision + 1
  /\ switched' = TRUE /\ known' = "none"
  /\ UNCHANGED <<phase, allowed, retriedAs, concurrentPending, otherUserRenewal, scopeVars>>
RetireCallers ==
  /\ ~retired /\ phase # "done"
  /\ retired' = TRUE
  /\ UNCHANGED <<retryVars, phase, renewedRetired, replayedRetired>>
ConcurrentInstall ==
  /\ phase = "waiting" /\ token = "A0"
  /\ token' = "A1" /\ revision' = 1 /\ concurrentPending' = TRUE
  /\ UNCHANGED <<known, switched, phase, allowed, retriedAs, otherUserRenewal, scopeVars>>
FinishConcurrentRenewal ==
  /\ concurrentPending /\ concurrentPending' = FALSE
  /\ known' = IF BindRenewalCompletion /\ revision # 1 THEN "none" ELSE token
  /\ UNCHANGED <<token, revision, switched, phase, allowed, retriedAs, otherUserRenewal,
                  scopeVars>>
JoinRenewal ==
  /\ phase = "joining" /\ ~concurrentPending
  /\ allowed' = (known = token /\ known # "none") /\ phase' = "ready"
  /\ UNCHANGED <<token, revision, known, switched, retriedAs, concurrentPending,
                  otherUserRenewal, scopeVars>>
Receive401 ==
  /\ phase = "waiting"
  /\ IF RecheckCallerScope /\ retired
       THEN /\ phase' = "done"
            /\ UNCHANGED <<retryVars, scopeVars>>
       ELSE /\ phase' = IF token = "A0" THEN "renewing"
                        ELSE IF JoinPendingRenewal /\ concurrentPending THEN "joining"
                        ELSE "ready"
            /\ allowed' = (token # "A0" /\ (~RequireKnownReplacement \/ known = token))
            /\ renewedRetired' = (retired /\ token = "A0")
            /\ UNCHANGED <<token, revision, known, switched, retriedAs, concurrentPending,
                            otherUserRenewal, retired, replayedRetired>>
InstallRenewal ==
  /\ phase = "renewing"
  /\ token' \in IF switched THEN {token} ELSE {"A1", "C"}
  /\ otherUserRenewal' = (token' = "C")
  /\ revision' = IF switched THEN revision ELSE revision + 1
  /\ phase' = IF switched THEN "ready" ELSE "finishing"
  /\ UNCHANGED <<known, switched, allowed, retriedAs, concurrentPending, scopeVars>>
FinishRenewal ==
  /\ phase = "finishing"
  /\ LET sameUser == ~CheckRenewedUser \/ token # "C"
         recorded == (~BindRenewalCompletion \/ revision = 1) /\ sameUser
     IN /\ known' = IF recorded THEN token ELSE "none"
        /\ allowed' = recorded
  /\ phase' = "ready"
  /\ UNCHANGED <<token, revision, switched, retriedAs, concurrentPending, otherUserRenewal,
                  scopeVars>>
Dispatch ==
  /\ phase = "ready" /\ phase' = "done"
  /\ LET replay == /\ allowed /\ (~RecheckDispatch \/ known = token)
                   /\ ~(RecheckCallerScope /\ retired)
     IN /\ retriedAs' = IF replay THEN token ELSE "none"
        /\ replayedRetired' = (replay /\ retired)
  /\ UNCHANGED <<token, revision, known, switched, allowed, concurrentPending,
                  otherUserRenewal, retired, renewedRetired>>
Next == SwitchIdentity \/ RetireCallers \/ ConcurrentInstall \/ FinishConcurrentRenewal
        \/ JoinRenewal \/ Receive401 \/ InstallRenewal
        \/ FinishRenewal \/ Dispatch \/ (phase = "done" /\ UNCHANGED vars)
Spec == Init /\ [][Next]_vars /\ WF_vars(Receive401) /\ WF_vars(InstallRenewal)
        /\ WF_vars(FinishRenewal) /\ WF_vars(Dispatch)
        /\ WF_vars(FinishConcurrentRenewal) /\ WF_vars(JoinRenewal)
TypeOK ==
  /\ token \in {"A0", "A1", "B", "C"} /\ revision \in 0..2
  /\ known \in {"none", "A1", "B", "C"} /\ switched \in BOOLEAN
  /\ otherUserRenewal \in BOOLEAN
  /\ phase \in {"waiting", "renewing", "finishing", "joining", "ready", "done"}
  /\ concurrentPending \in BOOLEAN
  /\ allowed \in BOOLEAN /\ retriedAs \in {"none", "A1", "B", "C"}
  /\ retired \in BOOLEAN /\ renewedRetired \in BOOLEAN /\ replayedRetired \in BOOLEAN
RetryKeepsActor == retriedAs \in {"none", "A1"}
RetiredCallersNeitherRenewNorReplay == ~renewedRetired /\ ~replayedRetired
HonestRenewalReplays ==
  (phase = "done" /\ ~switched /\ ~otherUserRenewal /\ ~retired) => retriedAs = "A1"
RequestTerminates == <>(phase = "done")
=============================================================================
