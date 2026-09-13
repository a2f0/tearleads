------------------------ MODULE ContainerInterest ------------------------
EXTENDS Naturals, TLC

CONSTANTS AuthorizeInterest, InvalidateOnAccessChange, CheckSocketOpen
VARIABLES access, accessVersion, open, indexed, pending, queryAccess,
          queryVersion
vars == <<access, accessVersion, open, indexed, pending, queryAccess,
          queryVersion>>

Init == /\ access = FALSE
        /\ accessVersion = 0
        /\ open = TRUE
        /\ indexed = FALSE
        /\ pending = FALSE
        /\ queryAccess = FALSE
        /\ queryVersion = 0

BeginAuthorization ==
    /\ open /\ ~pending
    /\ pending' = TRUE
    /\ queryAccess' = access
    /\ queryVersion' = accessVersion
    /\ UNCHANGED <<access, accessVersion, open, indexed>>

ApplyAuthorization ==
    /\ pending
    /\ (~CheckSocketOpen \/ open)
    /\ (~InvalidateOnAccessChange \/ queryVersion = accessVersion)
    /\ indexed' = (~AuthorizeInterest \/ queryAccess)
    /\ pending' = FALSE
    /\ UNCHANGED <<access, accessVersion, open, queryAccess, queryVersion>>

RetryAuthorization ==
    /\ open /\ pending /\ queryVersion # accessVersion
    /\ queryAccess' = access
    /\ queryVersion' = accessVersion
    /\ UNCHANGED <<access, accessVersion, open, indexed, pending>>

ChangeAccess ==
    /\ accessVersion < 2
    /\ access' = ~access
    /\ accessVersion' = accessVersion + 1
    /\ indexed' = IF InvalidateOnAccessChange THEN FALSE ELSE indexed
    /\ UNCHANGED <<open, pending, queryAccess, queryVersion>>

CloseSocket ==
    /\ open
    /\ open' = FALSE
    /\ indexed' = FALSE
    /\ UNCHANGED <<access, accessVersion, pending, queryAccess, queryVersion>>

Next == BeginAuthorization \/ ApplyAuthorization \/ RetryAuthorization
        \/ ChangeAccess \/ CloseSocket \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars

TypeOK == /\ access \in BOOLEAN /\ open \in BOOLEAN /\ indexed \in BOOLEAN
          /\ pending \in BOOLEAN /\ queryAccess \in BOOLEAN
          /\ accessVersion \in 0..2 /\ queryVersion \in 0..2
OnlyReadableInterests == indexed => access
ClosedSocketsNeverIndexed == indexed => open
=============================================================================
