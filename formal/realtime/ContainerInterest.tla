------------------------ MODULE ContainerInterest ------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS AuthorizeInterest, InvalidateOnAccessChange, CheckSocketOpen,
          ScopeInvalidation, ScopeQueryChanges, NotifyPrincipalChanges,
          CheckRestoreDependencies, CheckSessionLiveness,
          EnforceSessionDeadline, ConfirmOnlyLiveReads
Containers == {"child", "other"}
\* Time units a session may go unconfirmed by the session store.
MaxUnconfirmed == 2
Min(a, b) == IF a < b THEN a ELSE b
Dependencies(container) == IF container = "child"
                          THEN {"root", "child", "group"} ELSE {"other"}
\* observed: the pass's session read, "none" until the store is read.
\* readAfterEnd: that read answered after the session had ended.
\* sinceConfirmed: time since the store last confirmed the session live.
\* deadlineAge: time since production last armed the session deadline.
VARIABLES access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry, cached, cacheInvalidated, cacheReadable,
          sessionLive, servedEndedSession, observed, readAfterEnd,
          sinceConfirmed, deadlineAge, servedUnconfirmed
sessionVars == <<sessionLive, servedEndedSession, observed, readAfterEnd,
                 sinceConfirmed, deadlineAge, servedUnconfirmed>>
vars == <<access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry, cached, cacheInvalidated, cacheReadable,
          sessionVars>>
interestVars == <<access, revision, pending, queryAccess, queryChanged,
                  unrelatedRetry, cached, cacheInvalidated, cacheReadable>>
Readable(container) == \A dependency \in Dependencies(container): access[dependency]
QueryDependencies == IF queryAccess THEN Dependencies("child") ELSE {"child"}
RelevantQueryChange == queryChanged \cap QueryDependencies # {}
NeedsRetry == IF ScopeQueryChanges THEN RelevantQueryChange ELSE queryChanged # {}

Init == /\ access = [dependency \in {"root", "child", "group", "other"} |-> dependency # "root"]
        /\ revision = 0 /\ open = TRUE /\ indexed = {"other"}
        /\ pending = FALSE /\ queryAccess = FALSE
        /\ queryChanged = {} /\ unrelatedRetry = FALSE
        /\ cached = FALSE /\ cacheInvalidated = FALSE /\ cacheReadable = FALSE
        /\ sessionLive = TRUE /\ servedEndedSession = FALSE
        /\ observed = "none" /\ readAfterEnd = FALSE
        /\ sinceConfirmed = 0 /\ deadlineAge = 0 /\ servedUnconfirmed = FALSE

BeginAuthorization ==
    /\ open /\ ~pending
    /\ pending' = TRUE /\ queryAccess' = Readable("child")
    /\ queryChanged' = {}
    /\ UNCHANGED <<access, revision, open, indexed, unrelatedRetry,
                    cached, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED sessionVars

ApplyAuthorization ==
    /\ pending /\ (~CheckSocketOpen \/ open)
    /\ ~NeedsRetry
    /\ indexed' = IF ~AuthorizeInterest \/ queryAccess
                   THEN indexed \cup {"child"} ELSE indexed \ {"child"}
    /\ pending' = FALSE
    /\ cached' = TRUE /\ cacheInvalidated' = FALSE /\ cacheReadable' = queryAccess
    /\ UNCHANGED <<access, revision, open, queryAccess, queryChanged, unrelatedRetry>>
    /\ UNCHANGED sessionVars

RetryAuthorization ==
    /\ open /\ pending /\ NeedsRetry
    /\ unrelatedRetry' = (unrelatedRetry \/ ~RelevantQueryChange)
    /\ queryAccess' = Readable("child") /\ queryChanged' = {}
    /\ UNCHANGED <<access, revision, open, indexed, pending,
                    cached, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED sessionVars

ReuseRestoredAuthorization ==
    /\ open /\ ~pending /\ cached
    /\ (~CheckRestoreDependencies \/ ~cacheInvalidated)
    /\ indexed' = IF cacheReadable THEN indexed \cup {"child"}
                   ELSE indexed \ {"child"}
    /\ cached' = FALSE
    /\ UNCHANGED <<access, revision, open, pending, queryAccess, queryChanged,
                    unrelatedRetry, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED sessionVars

ObserveChange(dependency) == InvalidateOnAccessChange /\ (dependency # "group" \/ NotifyPrincipalChanges)

ChangeAccess(dependency) ==
    /\ revision < 2
    /\ revision' = revision + 1
    /\ access' = IF dependency = "outside" THEN access
                  ELSE [access EXCEPT ![dependency] = ~@]
    /\ indexed' = IF ~ObserveChange(dependency) THEN indexed
                   ELSE IF ScopeInvalidation
                     THEN {container \in indexed: dependency \notin Dependencies(container)}
                     ELSE {}
    /\ queryChanged' = IF pending /\ ObserveChange(dependency)
                        THEN queryChanged \cup {dependency} ELSE queryChanged
    /\ cacheInvalidated' = (cacheInvalidated \/
         (cached /\ ObserveChange(dependency) /\
          dependency \in (IF cacheReadable THEN Dependencies("child") ELSE {"child"})))
    /\ UNCHANGED <<open, pending, queryAccess, unrelatedRetry,
                    cached, cacheReadable>>
    /\ UNCHANGED sessionVars

CloseSocket ==
    /\ open /\ open' = FALSE /\ indexed' = indexed \ {"child"}
    /\ UNCHANGED <<access, revision, pending, queryAccess, queryChanged, unrelatedRetry,
                    cached, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED sessionVars

\* A socket's session is checked once at upgrade. Revocation publishes
\* session_revoked at most once and expiry publishes nothing, so ending a
\* session may leave its socket open and indexed.
EndSession(delivered) ==
    /\ sessionLive /\ sessionLive' = FALSE
    /\ IF delivered /\ open
       THEN open' = FALSE /\ indexed' = indexed \ {"child"}
       ELSE UNCHANGED <<open, indexed>>
    /\ UNCHANGED <<servedEndedSession, observed, readAfterEnd, sinceConfirmed,
                   deadlineAge, servedUnconfirmed>>
    /\ UNCHANGED interestVars

\* A session tick or subscriber reconnect reads the session store. The read
\* may fail or time out; only a live answer confirms the session and re-arms
\* its deadline. Proof re-verification beside it is the boundary assumption
\* documented in the map.
ReadSession(answered) ==
    /\ open /\ observed = "none"
    /\ observed' = IF ~answered THEN "failed"
                   ELSE IF sessionLive THEN "live" ELSE "ended"
    /\ readAfterEnd' = (answered /\ ~sessionLive)
    /\ IF answered /\ sessionLive
       THEN sinceConfirmed' = 0 /\ deadlineAge' = 0
       ELSE /\ deadlineAge' = IF ~answered /\ ~ConfirmOnlyLiveReads
                              THEN 0 ELSE deadlineAge
            /\ UNCHANGED sinceConfirmed
    /\ UNCHANGED <<open, indexed, sessionLive, servedEndedSession,
                   servedUnconfirmed>>
    /\ UNCHANGED interestVars

\* The pass acts on its read. The session may end between the read and this
\* step; only a later read can see that.
CompletePass ==
    /\ observed # "none"
    /\ IF open /\ CheckSessionLiveness /\ observed = "ended"
       THEN open' = FALSE /\ indexed' = indexed \ {"child"}
       ELSE UNCHANGED <<open, indexed>>
    /\ servedEndedSession' = (servedEndedSession \/ (readAfterEnd /\ open'))
    /\ observed' = "none" /\ readAfterEnd' = FALSE
    /\ UNCHANGED <<sessionLive, sinceConfirmed, deadlineAge, servedUnconfirmed>>
    /\ UNCHANGED interestVars

\* Time passes while the socket is open. The deadline timer fires exactly when
\* due, so time cannot pass it while it would close the socket.
Elapse ==
    /\ open
    /\ ~(EnforceSessionDeadline /\ deadlineAge >= MaxUnconfirmed)
    /\ sinceConfirmed' = Min(sinceConfirmed + 1, MaxUnconfirmed + 1)
    /\ deadlineAge' = Min(deadlineAge + 1, MaxUnconfirmed + 1)
    /\ servedUnconfirmed' = (servedUnconfirmed \/ sinceConfirmed' > MaxUnconfirmed)
    /\ UNCHANGED <<open, indexed, sessionLive, servedEndedSession, observed,
                   readAfterEnd>>
    /\ UNCHANGED interestVars

\* A session left unconfirmed until its deadline closes its sockets.
SessionDeadline ==
    /\ open /\ EnforceSessionDeadline /\ deadlineAge >= MaxUnconfirmed
    /\ open' = FALSE /\ indexed' = indexed \ {"child"}
    /\ UNCHANGED sessionVars /\ UNCHANGED interestVars

Next == BeginAuthorization \/ ApplyAuthorization \/ RetryAuthorization
        \/ ReuseRestoredAuthorization
        \/ (\E dependency \in {"root", "child", "group", "outside"}: ChangeAccess(dependency))
        \/ CloseSocket \/ (\E delivered \in BOOLEAN: EndSession(delivered))
        \/ (\E answered \in BOOLEAN: ReadSession(answered)) \/ CompletePass
        \/ Elapse \/ SessionDeadline \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK == /\ access \in [{"root", "child", "group", "other"} -> BOOLEAN]
          /\ open \in BOOLEAN /\ pending \in BOOLEAN /\ queryAccess \in BOOLEAN
          /\ indexed \subseteq Containers /\ revision \in 0..2
          /\ queryChanged \subseteq {"root", "child", "group", "outside"}
          /\ unrelatedRetry \in BOOLEAN
          /\ cached \in BOOLEAN /\ cacheReadable \in BOOLEAN
          /\ cacheInvalidated \in BOOLEAN
          /\ sessionLive \in BOOLEAN /\ servedEndedSession \in BOOLEAN
          /\ observed \in {"none", "live", "ended", "failed"}
          /\ readAfterEnd \in BOOLEAN /\ servedUnconfirmed \in BOOLEAN
          /\ sinceConfirmed \in 0..(MaxUnconfirmed + 1)
          /\ deadlineAge \in 0..(MaxUnconfirmed + 1)
OnlyReadableInterests == "child" \in indexed => Readable("child")
ClosedSocketsNeverIndexed == "child" \in indexed => open
UnrelatedInterestsPreserved == "other" \in indexed
NoUnrelatedRetries == ~unrelatedRetry
\* An ended session's socket never survives a pass whose read answered after
\* the end: a lost revocation or silent expiry is served only until the next
\* read the store answers.
EndedSessionsCloseByNextPass == ~servedEndedSession
\* A socket is never served once the store has left its session unconfirmed
\* for longer than the deadline, however many reads fail meanwhile.
UnconfirmedSessionsLapse == ~servedUnconfirmed
=============================================================================
