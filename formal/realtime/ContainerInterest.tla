------------------------ MODULE ContainerInterest ------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS AuthorizeInterest, InvalidateOnAccessChange, CheckSocketOpen,
          ScopeInvalidation, ScopeQueryChanges, NotifyPrincipalChanges,
          CheckQueryOwner, CheckSessionLiveness,
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
\* declared: the open socket's own client has declared "child" since it opened.
\* queryOwned: the pending query was started by the socket open now, not by a
\*             socket of the same session that has since closed.
VARIABLES access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry, declared, queryOwned,
          sessionLive, servedEndedSession, observed, readAfterEnd,
          sinceConfirmed, deadlineAge, servedUnconfirmed
sessionVars == <<sessionLive, servedEndedSession, observed, readAfterEnd,
                 sinceConfirmed, deadlineAge, servedUnconfirmed>>
vars == <<access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry, declared, queryOwned, sessionVars>>
interestVars == <<access, revision, pending, queryAccess, queryChanged,
                  unrelatedRetry, declared, queryOwned>>
Readable(container) == \A dependency \in Dependencies(container): access[dependency]
QueryDependencies == IF queryAccess THEN Dependencies("child") ELSE {"child"}
RelevantQueryChange == queryChanged \cap QueryDependencies # {}
NeedsRetry == IF ScopeQueryChanges THEN RelevantQueryChange ELSE queryChanged # {}
\* Production checks the query's own socket object, not merely its session.
QuerySocketOpen == open /\ (~CheckQueryOwner \/ queryOwned)

Init == /\ access = [dependency \in {"root", "child", "group", "other"} |-> dependency # "root"]
        /\ revision = 0 /\ open = TRUE /\ indexed = {"other"}
        /\ pending = FALSE /\ queryAccess = FALSE
        /\ queryChanged = {} /\ unrelatedRetry = FALSE
        /\ declared = FALSE /\ queryOwned = FALSE
        /\ sessionLive = TRUE /\ servedEndedSession = FALSE
        /\ observed = "none" /\ readAfterEnd = FALSE
        /\ sinceConfirmed = 0 /\ deadlineAge = 0 /\ servedUnconfirmed = FALSE

\* The socket's own client declares "child". A declaration is the only way a
\* query starts: no server-side cache restores interest for a socket.
BeginAuthorization ==
    /\ open /\ ~pending
    /\ pending' = TRUE /\ queryAccess' = Readable("child")
    /\ queryChanged' = {} /\ declared' = TRUE /\ queryOwned' = TRUE
    /\ UNCHANGED <<access, revision, open, indexed, unrelatedRetry>>
    /\ UNCHANGED sessionVars

ApplyAuthorization ==
    /\ pending /\ (~CheckSocketOpen \/ QuerySocketOpen)
    /\ ~NeedsRetry
    /\ indexed' = IF ~AuthorizeInterest \/ queryAccess
                   THEN indexed \cup {"child"} ELSE indexed \ {"child"}
    /\ pending' = FALSE
    /\ UNCHANGED <<access, revision, open, queryAccess, queryChanged,
                    unrelatedRetry, declared, queryOwned>>
    /\ UNCHANGED sessionVars

\* A closed socket's query settles inert: its result indexes no socket.
SettleOrphanedAuthorization ==
    /\ pending /\ CheckSocketOpen /\ ~QuerySocketOpen
    /\ pending' = FALSE
    /\ UNCHANGED <<access, revision, open, indexed, queryAccess, queryChanged,
                    unrelatedRetry, declared, queryOwned>>
    /\ UNCHANGED sessionVars

RetryAuthorization ==
    /\ QuerySocketOpen /\ pending /\ NeedsRetry
    /\ unrelatedRetry' = (unrelatedRetry \/ ~RelevantQueryChange)
    /\ queryAccess' = Readable("child") /\ queryChanged' = {}
    /\ UNCHANGED <<access, revision, open, indexed, pending, declared,
                    queryOwned>>
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
    /\ UNCHANGED <<open, pending, queryAccess, unrelatedRetry, declared,
                    queryOwned>>
    /\ UNCHANGED sessionVars

CloseSocket ==
    /\ open /\ open' = FALSE /\ indexed' = indexed \ {"child"}
    /\ UNCHANGED <<access, revision, pending, queryAccess, queryChanged,
                    unrelatedRetry, declared, queryOwned>>
    /\ UNCHANGED sessionVars

\* The client reconnects on a fresh ticket for the same live session. The new
\* socket opens with no container interest: nothing restores the closed
\* socket's set, so its client declares again. A query the closed socket left
\* pending belongs to that socket. The ticket upgrade confirms the session.
ReopenSocket ==
    /\ ~open /\ sessionLive
    /\ open' = TRUE /\ declared' = FALSE /\ queryOwned' = FALSE
    /\ sinceConfirmed' = 0 /\ deadlineAge' = 0
    /\ UNCHANGED <<access, revision, indexed, pending, queryAccess,
                    queryChanged, unrelatedRetry>>
    /\ UNCHANGED <<sessionLive, servedEndedSession, observed, readAfterEnd,
                    servedUnconfirmed>>

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
        \/ SettleOrphanedAuthorization
        \/ (\E dependency \in {"root", "child", "group", "outside"}: ChangeAccess(dependency))
        \/ CloseSocket \/ ReopenSocket
        \/ (\E delivered \in BOOLEAN: EndSession(delivered))
        \/ (\E answered \in BOOLEAN: ReadSession(answered)) \/ CompletePass
        \/ Elapse \/ SessionDeadline \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK == /\ access \in [{"root", "child", "group", "other"} -> BOOLEAN]
          /\ open \in BOOLEAN /\ pending \in BOOLEAN /\ queryAccess \in BOOLEAN
          /\ indexed \subseteq Containers /\ revision \in 0..2
          /\ queryChanged \subseteq {"root", "child", "group", "outside"}
          /\ unrelatedRetry \in BOOLEAN
          /\ declared \in BOOLEAN /\ queryOwned \in BOOLEAN
          /\ sessionLive \in BOOLEAN /\ servedEndedSession \in BOOLEAN
          /\ observed \in {"none", "live", "ended", "failed"}
          /\ readAfterEnd \in BOOLEAN /\ servedUnconfirmed \in BOOLEAN
          /\ sinceConfirmed \in 0..(MaxUnconfirmed + 1)
          /\ deadlineAge \in 0..(MaxUnconfirmed + 1)
OnlyReadableInterests == "child" \in indexed => Readable("child")
ClosedSocketsNeverIndexed == "child" \in indexed => open
\* Container hints route only through indexed interest, so a socket whose own
\* client has not declared a container since it opened receives no hint for it,
\* including a reconnected socket of a session that held it before.
UndeclaredSocketsReceiveNoHints == "child" \in indexed => declared
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
