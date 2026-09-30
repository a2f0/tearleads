------------------------ MODULE ContainerInterest ------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS AuthorizeInterest, InvalidateOnAccessChange, CheckSocketOpen,
          ScopeInvalidation, ScopeQueryChanges, NotifyPrincipalChanges,
          CheckRestoreDependencies, CheckSessionLiveness
Containers == {"child", "other"}
Dependencies(container) == IF container = "child"
                          THEN {"root", "child", "group"} ELSE {"other"}
VARIABLES access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry, cached, cacheInvalidated, cacheReadable,
          sessionLive, servedEndedSession
vars == <<access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry, cached, cacheInvalidated, cacheReadable,
          sessionLive, servedEndedSession>>
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

BeginAuthorization ==
    /\ open /\ ~pending
    /\ pending' = TRUE /\ queryAccess' = Readable("child")
    /\ queryChanged' = {}
    /\ UNCHANGED <<access, revision, open, indexed, unrelatedRetry,
                    cached, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED <<sessionLive, servedEndedSession>>

ApplyAuthorization ==
    /\ pending /\ (~CheckSocketOpen \/ open)
    /\ ~NeedsRetry
    /\ indexed' = IF ~AuthorizeInterest \/ queryAccess
                   THEN indexed \cup {"child"} ELSE indexed \ {"child"}
    /\ pending' = FALSE
    /\ cached' = TRUE /\ cacheInvalidated' = FALSE /\ cacheReadable' = queryAccess
    /\ UNCHANGED <<access, revision, open, queryAccess, queryChanged, unrelatedRetry>>
    /\ UNCHANGED <<sessionLive, servedEndedSession>>

RetryAuthorization ==
    /\ open /\ pending /\ NeedsRetry
    /\ unrelatedRetry' = (unrelatedRetry \/ ~RelevantQueryChange)
    /\ queryAccess' = Readable("child") /\ queryChanged' = {}
    /\ UNCHANGED <<access, revision, open, indexed, pending,
                    cached, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED <<sessionLive, servedEndedSession>>

ReuseRestoredAuthorization ==
    /\ open /\ ~pending /\ cached
    /\ (~CheckRestoreDependencies \/ ~cacheInvalidated)
    /\ indexed' = IF cacheReadable THEN indexed \cup {"child"}
                   ELSE indexed \ {"child"}
    /\ cached' = FALSE
    /\ UNCHANGED <<access, revision, open, pending, queryAccess, queryChanged,
                    unrelatedRetry, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED <<sessionLive, servedEndedSession>>

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
    /\ UNCHANGED <<sessionLive, servedEndedSession>>

CloseSocket ==
    /\ open /\ open' = FALSE /\ indexed' = indexed \ {"child"}
    /\ UNCHANGED <<access, revision, pending, queryAccess, queryChanged, unrelatedRetry,
                    cached, cacheInvalidated, cacheReadable>>
    /\ UNCHANGED <<sessionLive, servedEndedSession>>

\* A socket's session is checked once at upgrade. Revocation publishes
\* session_revoked at most once and expiry publishes nothing, so ending a
\* session may leave its socket open and indexed.
EndSession(delivered) ==
    /\ sessionLive /\ sessionLive' = FALSE
    /\ IF delivered /\ open
       THEN open' = FALSE /\ indexed' = indexed \ {"child"}
       ELSE UNCHANGED <<open, indexed>>
    /\ UNCHANGED <<servedEndedSession>> /\ UNCHANGED interestVars

\* A revalidation tick or subscriber reconnect over an open socket. Proof
\* re-verification is the boundary assumption documented in the map; this
\* action models the session recheck that precedes it.
RevalidateSocket ==
    /\ open
    /\ IF CheckSessionLiveness /\ ~sessionLive
       THEN /\ open' = FALSE /\ indexed' = indexed \ {"child"}
            /\ UNCHANGED servedEndedSession
       ELSE /\ UNCHANGED <<open, indexed>>
            /\ servedEndedSession' = (servedEndedSession \/ ~sessionLive)
    /\ UNCHANGED <<sessionLive>> /\ UNCHANGED interestVars

Next == BeginAuthorization \/ ApplyAuthorization \/ RetryAuthorization
        \/ ReuseRestoredAuthorization
        \/ (\E dependency \in {"root", "child", "group", "outside"}: ChangeAccess(dependency))
        \/ CloseSocket \/ (\E delivered \in BOOLEAN: EndSession(delivered))
        \/ RevalidateSocket \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK == /\ access \in [{"root", "child", "group", "other"} -> BOOLEAN]
          /\ open \in BOOLEAN /\ pending \in BOOLEAN /\ queryAccess \in BOOLEAN
          /\ indexed \subseteq Containers /\ revision \in 0..2
          /\ queryChanged \subseteq {"root", "child", "group", "outside"}
          /\ unrelatedRetry \in BOOLEAN
          /\ cached \in BOOLEAN /\ cacheReadable \in BOOLEAN
          /\ cacheInvalidated \in BOOLEAN
          /\ sessionLive \in BOOLEAN /\ servedEndedSession \in BOOLEAN
OnlyReadableInterests == "child" \in indexed => Readable("child")
ClosedSocketsNeverIndexed == "child" \in indexed => open
UnrelatedInterestsPreserved == "other" \in indexed
NoUnrelatedRetries == ~unrelatedRetry
\* An ended session's socket never survives a revalidation pass: a lost
\* revocation or silent expiry is served for at most one interval.
EndedSessionsCloseByNextPass == ~servedEndedSession
=============================================================================
