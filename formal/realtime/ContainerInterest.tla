------------------------ MODULE ContainerInterest ------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS AuthorizeInterest, InvalidateOnAccessChange, CheckSocketOpen,
          ScopeInvalidation, ScopeQueryChanges, NotifyPrincipalChanges
Containers == {"child", "other"}
Dependencies(container) == IF container = "child"
                          THEN {"root", "child", "group"} ELSE {"other"}
VARIABLES access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry
vars == <<access, revision, open, indexed, pending, queryAccess,
          queryChanged, unrelatedRetry>>
Readable(container) == \A dependency \in Dependencies(container): access[dependency]
QueryDependencies == IF queryAccess THEN Dependencies("child") ELSE {"child"}
RelevantQueryChange == queryChanged \cap QueryDependencies # {}
NeedsRetry == IF ScopeQueryChanges THEN RelevantQueryChange ELSE queryChanged # {}

Init == /\ access = [dependency \in {"root", "child", "group", "other"} |-> dependency # "root"]
        /\ revision = 0 /\ open = TRUE /\ indexed = {"other"}
        /\ pending = FALSE /\ queryAccess = FALSE
        /\ queryChanged = {} /\ unrelatedRetry = FALSE

BeginAuthorization ==
    /\ open /\ ~pending
    /\ pending' = TRUE /\ queryAccess' = Readable("child")
    /\ queryChanged' = {}
    /\ UNCHANGED <<access, revision, open, indexed, unrelatedRetry>>

ApplyAuthorization ==
    /\ pending /\ (~CheckSocketOpen \/ open)
    /\ ~NeedsRetry
    /\ indexed' = IF ~AuthorizeInterest \/ queryAccess
                   THEN indexed \cup {"child"} ELSE indexed \ {"child"}
    /\ pending' = FALSE
    /\ UNCHANGED <<access, revision, open, queryAccess, queryChanged, unrelatedRetry>>

RetryAuthorization ==
    /\ open /\ pending /\ NeedsRetry
    /\ unrelatedRetry' = (unrelatedRetry \/ ~RelevantQueryChange)
    /\ queryAccess' = Readable("child") /\ queryChanged' = {}
    /\ UNCHANGED <<access, revision, open, indexed, pending>>

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
    /\ UNCHANGED <<open, pending, queryAccess, unrelatedRetry>>

CloseSocket ==
    /\ open /\ open' = FALSE /\ indexed' = indexed \ {"child"}
    /\ UNCHANGED <<access, revision, pending, queryAccess, queryChanged, unrelatedRetry>>

Next == BeginAuthorization \/ ApplyAuthorization \/ RetryAuthorization
        \/ (\E dependency \in {"root", "child", "group", "outside"}: ChangeAccess(dependency))
        \/ CloseSocket \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK == /\ access \in [{"root", "child", "group", "other"} -> BOOLEAN]
          /\ open \in BOOLEAN /\ pending \in BOOLEAN /\ queryAccess \in BOOLEAN
          /\ indexed \subseteq Containers /\ revision \in 0..2
          /\ queryChanged \subseteq {"root", "child", "group", "outside"}
          /\ unrelatedRetry \in BOOLEAN
OnlyReadableInterests == "child" \in indexed => Readable("child")
ClosedSocketsNeverIndexed == "child" \in indexed => open
UnrelatedInterestsPreserved == "other" \in indexed
NoUnrelatedRetries == ~unrelatedRetry
=============================================================================
